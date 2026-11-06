// SPDX-License-Identifier: AGPL-3.0-only
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { createServiceConfig } = require('./src/config');
const { renderHtmlOutput } = require('./src/html-output');
const { createOssStorage } = require('./src/oss-storage');
const { createPdfConverter } = require('./src/pdf-converter');

const config = createServiceConfig();
console.log('pdf tools resolved', {
  pdf2htmlEX: config.pdf2htmlEXPath,
  pdfinfo: config.pdfInfoPath,
  dataDir: config.pdf2html.dataDir,
  popplerDataDir: config.pdf2html.popplerDataDir,
});

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (raw == null || raw.trim() === '') {
    return { allowAll: false, list: ['http://localhost:5173', 'http://127.0.0.1:5173'] };
  }
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return { allowAll: parts.includes('*'), list: parts };
}

const corsOptions = parseCorsOrigins();

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (corsOptions.allowAll) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && corsOptions.list.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    const requestedHeaders = req.headers['access-control-request-headers'];
    res.setHeader(
      'Access-Control-Allow-Headers',
      requestedHeaders || 'Content-Type, Authorization, X-Requested-With'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
    res.sendStatus(204);
    return;
  }

  next();
}

const app = express();
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024,
  },
});
const ossStorage = createOssStorage(config);
const pdfConverter = createPdfConverter(config);

function objectPath(objectKey) {
  return `/${objectKey}`;
}

function getPdfIdInput(req) {
  return (req.body && req.body.pdfId) || req.query.pdfId;
}

function parsePdfIdParam(req) {
  const value = getPdfIdInput(req);
  if (value == null || value === '') {
    return null;
  }
  return ossStorage.normalizePdfId(value, 'pdfId');
}

function parsePageParam(req) {
  const raw = (req.body && req.body.page) || req.query.page;
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
    console.log(`[oss upload] ${label} ${percent}% ${mode} ${formatBytes(progress.size)} ${progress.objectKey}${parts}`);
  };
}

async function uploadArtifacts(pdfId, pages) {
  return Promise.all(
    pages.map(async (page) => {
      const html = await renderHtmlOutput(page.html);
      const objectKey = await ossStorage.uploadHtmlArtifact(pdfId, page.htmlId, html, {
        onProgress: createUploadProgressLogger(`html ${page.htmlId}`),
      });
      return {
        html_id: page.htmlId,
        object_key: objectKey,
        object_path: objectPath(objectKey),
        bytes: Buffer.byteLength(html, 'utf8'),
      };
    })
  );
}

// Container/ALB health probe (oci-migration)
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ ok: false, error: 'Missing `pdf` file field' });
      return;
    }

    const started = Date.now();
    const pdfId = ossStorage.createPdfId(req.file.buffer);
    const objectKey = await ossStorage.uploadRawPdf(pdfId, req.file.buffer, {
      onProgress: createUploadProgressLogger('raw pdf'),
    });
    res.json({
      pdf_id: pdfId,
      object_key: objectKey,
      object_path: objectPath(objectKey),
      elapsed_ms: Date.now() - started,
      bytes: req.file.size,
    });
  } catch (error) {
    sendError(res, 'pdf upload failed', error);
  }
});

app.post('/api/pdf2html', upload.single('pdf'), async (req, res) => {
  try {
    const started = Date.now();
    let pdfId = parsePdfIdParam(req);
    let pdfBuffer;
    let rawObjectKey;

    if (pdfId) {
      rawObjectKey = ossStorage.rawPdfObjectKey(pdfId);
      pdfBuffer = await ossStorage.downloadRawPdf(pdfId);
    } else {
      if (!req.file || !req.file.buffer) {
        res.status(400).json({ ok: false, error: 'Missing `pdfId` or `pdf` file field' });
        return;
      }
      pdfBuffer = req.file.buffer;
      pdfId = ossStorage.createPdfId(pdfBuffer);
      rawObjectKey = await ossStorage.uploadRawPdf(pdfId, pdfBuffer, {
        onProgress: createUploadProgressLogger('raw pdf'),
      });
    }

    const page = parsePageParam(req);
    const result = await pdfConverter.convert(pdfBuffer, { pdfId, page });
    const artifacts = await uploadArtifacts(pdfId, result.pages);

    res.json({
      pdf_id: pdfId,
      raw_object_key: rawObjectKey,
      raw_object_path: objectPath(rawObjectKey),
      slide_count: result.pageCount,
      artifacts,
      elapsedMs: Date.now() - started,
      bytes: pdfBuffer.length,
    });
  } catch (error) {
    sendError(res, 'pdf conversion failed', error);
  }
});

app.listen(config.port, () => {
  console.log(`pdf2html service started on http://localhost:${config.port}`);
});
