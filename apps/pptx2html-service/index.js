// SPDX-License-Identifier: AGPL-3.0-only
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { createServiceConfig } = require('./src/config');
const { mapWithConcurrency } = require('./src/concurrency');
const { createConverterPool } = require('./src/converter-pool');
const { renderHtmlOutput } = require('./src/html-output');
const { createOssStorage } = require('./src/oss-storage');
const { mountRuntimeStatic } = require('./src/static-runtime');

const config = createServiceConfig();

function createCorsMiddleware(origins) {
  if (!origins || origins.length === 0) {
    return (req, res, next) => next();
  }
  const allowAny = origins.includes('*');
  const originSet = new Set(origins.filter((o) => o !== '*'));

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    const allowed = allowAny || originSet.has(origin);
    if (!allowed) {
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      const reqHeaders = req.headers['access-control-request-headers'];
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        reqHeaders || 'Content-Type, Authorization'
      );
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }
    next();
  };
}

const app = express();
app.use(createCorsMiddleware(config.corsOrigins));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024,
  },
});
const converterPool = createConverterPool(config);
const ossStorage = createOssStorage(config);

mountRuntimeStatic(app, config.rootDir);

function objectPath(objectKey) {
  return `/${objectKey}`;
}

function getPptxIdInput(req) {
  return (req.body && req.body.pptx_id) || req.query.pptx_id;
}

function parsePptxIdParam(req) {
  const value = getPptxIdInput(req);
  if (value == null || value === '') {
    return null;
  }
  return ossStorage.normalizeUuid(value, 'pptx_id');
}

function parsePageParam(req) {
  const raw = (req.body && (req.body.page || req.body.slide)) || req.query.page || req.query.slide;
  if (raw == null || raw === '') {
    return null;
  }
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) {
    const error = new Error('`page` must be a positive integer starting from 1');
    error.statusCode = 400;
    throw error;
  }
  return page;
}

function sendError(res, logPrefix, error) {
  const statusCode = error && error.statusCode ? error.statusCode : 500;
  if (statusCode >= 500) {
    console.error(`${logPrefix}:`, error);
  }
  res.status(statusCode).json({
    ok: false,
    error: error && error.message ? error.message : String(error),
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function createUploadProgressLogger(label) {
  let lastLoggedPercent = -1;
  return (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percentage * 100)));
    if (percent !== 100 && percent !== 0 && percent - lastLoggedPercent < 5) {
      return;
    }
    if (percent === lastLoggedPercent) {
      return;
    }
    lastLoggedPercent = percent;
    const mode = progress.multipart ? 'multipart' : 'put';
    const parts = progress.doneParts != null ? ` parts=${progress.doneParts}` : '';
    console.log(
      `[oss upload] ${label} ${percent}% ${mode} ${formatBytes(progress.size)} ${progress.objectKey}${parts}`
    );
  };
}

// Container/LB health probe (oci-migration)
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.post('/api/upload', upload.single('pptx'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ ok: false, error: 'Missing `pptx` file field' });
      return;
    }

    const started = Date.now();
    const pptxId = ossStorage.createPptxId(getPptxIdInput(req), req.file.buffer);
    const objectKey = await ossStorage.uploadRawPptx(pptxId, req.file.buffer, {
      onProgress: createUploadProgressLogger('raw pptx'),
    });
    res.json({
      pptx_id: pptxId,
      object_key: objectKey,
      object_path: objectPath(objectKey),
      elapsed_ms: Date.now() - started,
      bytes: req.file.size,
    });
  } catch (error) {
    sendError(res, 'pptx upload failed', error);
  }
});

app.post('/api/pptx2html', upload.single('pptx'), async (req, res) => {
  try {
    const started = Date.now();
    const pptxId = parsePptxIdParam(req);
    if (pptxId) {
      console.log(`downloading raw pptx: ${pptxId}`);
      const pptxBuffer = await ossStorage.downloadRawPptx(pptxId);
      console.log(`raw pptx downloaded: ${pptxId}`);
      const result = await converterPool.convert(pptxBuffer, { allPages: true });
      console.log(`conversion completed: ${pptxId}`);
      // Bounded: uploading every slide at once opened 100+ sockets and OSS hung some of them up
      const artifacts = await mapWithConcurrency(
        result.pages,
        config.artifactUploadConcurrency,
        async (slide) => {
          const html = await renderHtmlOutput(slide.fragment);
          console.log(`slide rendered: ${slide.htmlId}`);
          const objectKey = await ossStorage.uploadHtmlArtifact(pptxId, slide.htmlId, html, {
            onProgress: createUploadProgressLogger(`html ${slide.htmlId}`),
          });
          return {
            html_id: slide.htmlId,
            object_key: objectKey,
            object_path: objectPath(objectKey),
            bytes: Buffer.byteLength(html, 'utf8'),
          };
        }
      );

      res.json({
        pptx_id: pptxId,
        raw_object_key: ossStorage.rawPptxObjectKey(pptxId),
        raw_object_path: objectPath(ossStorage.rawPptxObjectKey(pptxId)),
        slide_count: result.slideCount,
        artifacts,
        elapsed_ms: Date.now() - started,
        bytes: pptxBuffer.length,
      });
      return;
    }

    if (!req.file || !req.file.buffer) {
      res.status(400).json({ ok: false, error: 'Missing `pptx_id` or `pptx` file field' });
      return;
    }

    const page = parsePageParam(req);
    const fragment = await converterPool.convert(req.file.buffer, { page });
    const html = await renderHtmlOutput(fragment);
    res.json({
      ok: true,
      html,
      page,
      elapsed_ms: Date.now() - started,
      bytes: req.file.size,
    });
  } catch (error) {
    sendError(res, 'pptx conversion failed', error);
  }
});

app.listen(config.port, () => {
  console.log(`pptx preview service started on http://localhost:${config.port}`);
  converterPool.init().catch((error) => {
    console.error('Failed to initialize converter page pool:', error);
  });
});

async function shutdown() {
  await converterPool.close();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
