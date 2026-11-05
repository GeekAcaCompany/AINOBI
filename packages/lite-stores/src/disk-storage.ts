// SPDX-License-Identifier: AGPL-3.0-only
// Object storage on the local disk behind the S3 HTTP API, for clients that already speak S3: the AWS
// SDK, presigned GET and PUT URLs, and browser form uploads through presigned POST. Objects are plain
// files at <dir>/<bucket>/<key>, so they can be inspected and backed up with ordinary tools.
//
// Like the other lite stores there is no authentication: signatures are not checked, only expiry and
// POST policy conditions, so a stale or malformed link fails here as it would in production.
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface DiskStorageOptions {
  /** Root directory of the buckets; created when missing. */
  dir: string;
  /** Defaults to loopback: the server has no authentication. */
  host?: string;
  /** 0 or omitted picks a free port. */
  port?: number;
}

export interface DiskStorageServer {
  dir: string;
  host: string;
  port: number;
  /** The S3 endpoint, for example http://127.0.0.1:56390. */
  endpoint: string;
  close(): Promise<void>;
}

interface ObjectMeta {
  etag: string;
  contentType?: string;
  contentDisposition?: string;
}

class S3Error extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Bookkeeping lives beside the buckets; a leading dot is not a valid bucket name. */
const INTERNAL_DIR = '.lite';
const LIST_MAX_KEYS = 1000;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const percent = (char: string): string => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

/** One key segment as a file name that is valid and distinct on every platform. */
function encodeSegment(segment: string): string {
  // [^ -￿] is everything below the space character: the control characters.
  let name = segment.replace(/[%<>:"\\|?*]|[^ -￿]/g, percent).replace(/[. ]$/, percent);
  if (WINDOWS_RESERVED.test(name)) name = percent(name[0] as string) + name.slice(1);
  return name;
}

function decodeSegment(name: string): string {
  return name.replace(/%([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function encodeKey(key: string): string[] {
  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new S3Error(400, 'InvalidArgument', `Object key not supported by disk storage: ${key}`);
  }
  return segments.map(encodeSegment);
}

function assertBucket(bucket: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(bucket)) {
    throw new S3Error(400, 'InvalidBucketName', `Invalid bucket name: ${bucket}`);
  }
}

const xmlEscape = (value: string): string =>
  value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);

const xml = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;

/** Decodes the aws-chunked framing SDK clients use for streamed bodies. */
class AwsChunkedDecoder extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private remaining = 0;
  private done = false;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (!this.done && this.buffer.length > 0) {
      if (this.remaining > 0) {
        const data = this.buffer.subarray(0, this.remaining);
        this.push(data);
        this.remaining -= data.length;
        this.buffer = this.buffer.subarray(data.length);
        continue;
      }
      const lineEnd = this.buffer.indexOf('\r\n');
      if (lineEnd === -1) break;
      const line = this.buffer.toString('latin1', 0, lineEnd);
      this.buffer = this.buffer.subarray(lineEnd + 2);
      // The CRLF ending the previous chunk's data reads as an empty line.
      if (line === '') continue;
      const size = Number.parseInt(line.split(';')[0] as string, 16);
      if (Number.isNaN(size)) {
        callback(new S3Error(400, 'IncompleteBody', 'Malformed aws-chunked body'));
        return;
      }
      if (size === 0) this.done = true;
      this.remaining = size;
    }
    callback();
  }
}

/** Passes bytes through, adding them to a hash. */
function hashing(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

function assertNotExpired(url: URL): void {
  const date = url.searchParams.get('X-Amz-Date');
  const expires = url.searchParams.get('X-Amz-Expires');
  if (!date || !expires) return;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
  if (!match) throw new S3Error(400, 'AuthorizationQueryParametersError', 'Invalid X-Amz-Date');
  const [, year, month, day, hour, minute, second] = match;
  const signedAt = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (Date.now() > signedAt + Number(expires) * 1000) {
    throw new S3Error(403, 'AccessDenied', 'Request has expired');
  }
}

class Storage {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  private objectPath(bucket: string, key: string): string {
    assertBucket(bucket);
    const path = join(this.dir, bucket, ...encodeKey(key));
    if (!path.startsWith(join(this.dir, bucket) + sep)) {
      throw new S3Error(400, 'InvalidArgument', `Object key escapes the bucket: ${key}`);
    }
    return path;
  }

  private metaPath(bucket: string, key: string): string {
    return `${join(this.dir, INTERNAL_DIR, 'meta', bucket, ...encodeKey(key))}.json`;
  }

  private tempPath(): string {
    return join(this.dir, INTERNAL_DIR, 'tmp', randomUUID());
  }

  private multipartDir(uploadId: string): string {
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new S3Error(404, 'NoSuchUpload', 'No such upload');
    return join(this.dir, INTERNAL_DIR, 'multipart', uploadId);
  }

  /** Streams a body to a temporary file, so a failed upload never touches the object. */
  private async receive(body: Readable): Promise<{ path: string; md5: string }> {
    const path = this.tempPath();
    await mkdir(dirname(path), { recursive: true });
    const hash = createHash('md5');
    try {
      await pipeline(body, hashing(hash), createWriteStream(path));
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    return { path, md5: hash.digest('hex') };
  }

  private async commit(bucket: string, key: string, tempPath: string, meta: ObjectMeta): Promise<void> {
    const target = this.objectPath(bucket, key);
    const metaTarget = this.metaPath(bucket, key);
    try {
      await mkdir(dirname(target), { recursive: true });
      await mkdir(dirname(metaTarget), { recursive: true });
      await rename(tempPath, target);
      await writeFile(metaTarget, JSON.stringify(meta));
    } catch (error) {
      await rm(tempPath, { force: true });
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOTDIR' || code === 'EEXIST' || code === 'EISDIR' || code === 'EPERM') {
        // S3 allows both "a" and "a/b"; a file system does not.
        throw new S3Error(409, 'InvalidObjectState', `Key conflicts with an existing object: ${key}`);
      }
      throw error;
    }
  }

  private async readMeta(bucket: string, key: string): Promise<ObjectMeta | null> {
    try {
      return JSON.parse(await readFile(this.metaPath(bucket, key), 'utf8')) as ObjectMeta;
    } catch {
      return null;
    }
  }

  private async statObject(bucket: string, key: string): Promise<{ path: string; size: number; mtime: Date }> {
    const path = this.objectPath(bucket, key);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new S3Error(404, 'NoSuchKey', 'The specified key does not exist.');
    return { path, size: info.size, mtime: info.mtime };
  }

  async putObject(bucket: string, key: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = isAwsChunked(req) ? req.pipe(new AwsChunkedDecoder()) : req;
    const { path, md5 } = await this.receive(body);
    await this.commit(bucket, key, path, {
      etag: md5,
      ...contentHeaders(req),
    });
    res.writeHead(200, { ETag: `"${md5}"` }).end();
  }

  async copyObject(bucket: string, key: string, source: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const [sourceBucket, sourceKey] = parseCopySource(source);
    const from = await this.statObject(sourceBucket, sourceKey);
    const meta = (await this.readMeta(sourceBucket, sourceKey)) ?? { etag: await fileMd5(from.path) };
    const temp = this.tempPath();
    await mkdir(dirname(temp), { recursive: true });
    await copyFile(from.path, temp);
    const replace = String(req.headers['x-amz-metadata-directive'] ?? '').toUpperCase() === 'REPLACE';
    await this.commit(bucket, key, temp, replace ? { etag: meta.etag, ...contentHeaders(req) } : meta);
    const lastModified = new Date().toISOString();
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(
      xml(`<CopyObjectResult><LastModified>${lastModified}</LastModified><ETag>"${meta.etag}"</ETag></CopyObjectResult>`),
    );
  }

  async getObject(bucket: string, key: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const object = await this.statObject(bucket, key);
    const meta = await this.readMeta(bucket, key);
    const headers: Record<string, string | number> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': url.searchParams.get('response-content-type') ?? meta?.contentType ?? 'binary/octet-stream',
      'Last-Modified': object.mtime.toUTCString(),
    };
    if (meta?.etag) headers.ETag = `"${meta.etag}"`;
    const disposition = url.searchParams.get('response-content-disposition') ?? meta?.contentDisposition;
    if (disposition) headers['Content-Disposition'] = disposition;

    const range = parseRange(req.headers.range, object.size);
    if (range === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${object.size}` }).end();
      return;
    }
    let status = 200;
    let length = object.size;
    if (range) {
      status = 206;
      length = range.end - range.start + 1;
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${object.size}`;
    }
    headers['Content-Length'] = length;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || length === 0) {
      res.end();
      return;
    }
    await pipeline(createReadStream(object.path, range ?? {}), res);
  }

  async deleteObject(bucket: string, key: string, res: ServerResponse): Promise<void> {
    const path = this.objectPath(bucket, key);
    const info = await stat(path).catch(() => null);
    // Deleting a missing key succeeds on S3; a "directory" here is only a shared key prefix.
    if (info?.isFile()) {
      await rm(path, { force: true });
      await rm(this.metaPath(bucket, key), { force: true });
    }
    res.writeHead(204).end();
  }

  async listObjects(bucket: string, url: URL, res: ServerResponse): Promise<void> {
    assertBucket(bucket);
    if (url.searchParams.get('delimiter')) {
      throw new S3Error(501, 'NotImplemented', 'Listing with a delimiter is not implemented by disk storage');
    }
    const prefix = url.searchParams.get('prefix') ?? '';
    const after = url.searchParams.get('continuation-token') ?? url.searchParams.get('start-after') ?? '';
    const requested = Number(url.searchParams.get('max-keys') ?? LIST_MAX_KEYS);
    const maxKeys = Number.isInteger(requested) && requested >= 0 ? Math.min(requested, LIST_MAX_KEYS) : LIST_MAX_KEYS;

    const keys = (await this.walk(join(this.dir, bucket), []))
      .filter((key) => key.startsWith(prefix) && key > after)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const page = keys.slice(0, maxKeys);
    const truncated = keys.length > page.length;
    const contents = await Promise.all(
      page.map(async (key) => {
        const object = await this.statObject(bucket, key);
        const meta = await this.readMeta(bucket, key);
        return (
          `<Contents><Key>${xmlEscape(key)}</Key><LastModified>${object.mtime.toISOString()}</LastModified>` +
          `<ETag>"${meta?.etag ?? ''}"</ETag><Size>${object.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`
        );
      }),
    );
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(
      xml(
        `<ListBucketResult><Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix>` +
          `<KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${truncated}</IsTruncated>` +
          (truncated ? `<NextContinuationToken>${xmlEscape(page.at(-1) as string)}</NextContinuationToken>` : '') +
          `${contents.join('')}</ListBucketResult>`,
      ),
    );
  }

  private async walk(dir: string, parents: string[]): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const keys = await Promise.all(
      entries.map(async (entry) => {
        const segments = [...parents, decodeSegment(entry.name)];
        return entry.isDirectory() ? this.walk(join(dir, entry.name), segments) : [segments.join('/')];
      }),
    );
    return keys.flat();
  }

  async createMultipart(bucket: string, key: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.objectPath(bucket, key);
    const uploadId = randomUUID();
    const dir = this.multipartDir(uploadId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'upload.json'), JSON.stringify(contentHeaders(req)));
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(
      xml(
        `<InitiateMultipartUploadResult><Bucket>${xmlEscape(bucket)}</Bucket><Key>${xmlEscape(key)}</Key>` +
          `<UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
      ),
    );
  }

  async uploadPart(uploadId: string, partNumber: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const dir = this.multipartDir(uploadId);
    if (!(await stat(dir).catch(() => null))) throw new S3Error(404, 'NoSuchUpload', 'No such upload');
    if (!/^\d+$/.test(partNumber)) throw new S3Error(400, 'InvalidArgument', 'Invalid partNumber');
    const body = isAwsChunked(req) ? req.pipe(new AwsChunkedDecoder()) : req;
    const { path, md5 } = await this.receive(body);
    await rename(path, join(dir, `${partNumber}.part`));
    await writeFile(join(dir, `${partNumber}.etag`), md5);
    res.writeHead(200, { ETag: `"${md5}"` }).end();
  }

  async completeMultipart(bucket: string, key: string, uploadId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const dir = this.multipartDir(uploadId);
    if (!(await stat(dir).catch(() => null))) throw new S3Error(404, 'NoSuchUpload', 'No such upload');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const numbers = [...Buffer.concat(chunks).toString('utf8').matchAll(/<PartNumber>\s*(\d+)\s*<\/PartNumber>/g)].map(
      (match) => match[1] as string,
    );
    if (numbers.length === 0) throw new S3Error(400, 'MalformedXML', 'No parts listed');

    const temp = this.tempPath();
    await mkdir(dirname(temp), { recursive: true });
    const out = createWriteStream(temp);
    const etags = createHash('md5');
    try {
      for (const number of numbers) {
        const etag = await readFile(join(dir, `${number}.etag`), 'utf8').catch(() => null);
        if (etag === null) throw new S3Error(400, 'InvalidPart', `Part ${number} was not uploaded`);
        etags.update(Buffer.from(etag, 'hex'));
        await appendFile(out, join(dir, `${number}.part`));
      }
      await new Promise<void>((resolveEnd, rejectEnd) => out.end((error?: Error | null) => (error ? rejectEnd(error) : resolveEnd())));
    } catch (error) {
      out.destroy();
      await rm(temp, { force: true });
      throw error;
    }
    const etag = `${etags.digest('hex')}-${numbers.length}`;
    const headers = JSON.parse(await readFile(join(dir, 'upload.json'), 'utf8')) as Omit<ObjectMeta, 'etag'>;
    await this.commit(bucket, key, temp, { etag, ...headers });
    await rm(dir, { recursive: true, force: true });
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(
      xml(
        `<CompleteMultipartUploadResult><Bucket>${xmlEscape(bucket)}</Bucket><Key>${xmlEscape(key)}</Key>` +
          `<ETag>"${etag}"</ETag></CompleteMultipartUploadResult>`,
      ),
    );
  }

  async abortMultipart(uploadId: string, res: ServerResponse): Promise<void> {
    await rm(this.multipartDir(uploadId), { recursive: true, force: true });
    res.writeHead(204).end();
  }

  /** Browser upload through a presigned POST. */
  async postObject(bucket: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const boundary = /boundary="?([^";]+)"?/.exec(String(req.headers['content-type'] ?? ''))?.[1];
    if (!boundary) throw new S3Error(400, 'MalformedPOSTRequest', 'Missing multipart boundary');
    const temp = this.tempPath();
    await mkdir(dirname(temp), { recursive: true });
    try {
      const form = await receiveForm(req, boundary, temp);
      if (!form.hasFile) throw new S3Error(400, 'MalformedPOSTRequest', 'The body contains no file');
      const key = (form.fields.key ?? '').replace('${filename}', form.filename ?? '');
      if (!key) throw new S3Error(400, 'InvalidArgument', 'Missing key field');
      assertPolicy(form.fields, bucket, key);
      await this.commit(bucket, key, temp, {
        etag: form.md5,
        ...(form.fields['content-type'] ? { contentType: form.fields['content-type'] } : {}),
        ...(form.fields['content-disposition'] ? { contentDisposition: form.fields['content-disposition'] } : {}),
      });
      const status = Number(form.fields.success_action_status);
      res.writeHead(status === 200 || status === 201 ? status : 204, { ETag: `"${form.md5}"` }).end();
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
}

function isAwsChunked(req: IncomingMessage): boolean {
  return (
    String(req.headers['content-encoding'] ?? '').includes('aws-chunked') ||
    String(req.headers['x-amz-content-sha256'] ?? '').startsWith('STREAMING-')
  );
}

function contentHeaders(req: IncomingMessage): Omit<ObjectMeta, 'etag'> {
  const contentType = req.headers['content-type'];
  const contentDisposition = req.headers['content-disposition'];
  return {
    ...(contentType ? { contentType } : {}),
    ...(contentDisposition ? { contentDisposition } : {}),
  };
}

function parseCopySource(source: string): [string, string] {
  const path = decodeURIComponent(source.split('?')[0] as string).replace(/^\/+/, '');
  const slash = path.indexOf('/');
  if (slash <= 0 || slash === path.length - 1) {
    throw new S3Error(400, 'InvalidArgument', 'Invalid x-amz-copy-source');
  }
  return [path.slice(0, slash), path.slice(slash + 1)];
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match) return null;
  const [, rawStart, rawEnd] = match as unknown as [string, string, string];
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix === 0 || size === 0) return 'invalid';
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(rawStart);
  if (start >= size) return 'invalid';
  return { start, end: rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1) };
}

async function fileMd5(path: string): Promise<string> {
  const hash = createHash('md5');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function appendFile(out: WriteStream, path: string): Promise<void> {
  await pipeline(createReadStream(path), out, { end: false });
}

/** Enforces what the presigned POST promised: S3 rejects an upload that breaks its policy. */
function assertPolicy(fields: Record<string, string>, bucket: string, key: string): void {
  if (!fields.policy) return;
  let policy: { expiration?: string; conditions?: unknown[] };
  try {
    policy = JSON.parse(Buffer.from(fields.policy, 'base64').toString('utf8')) as typeof policy;
  } catch {
    throw new S3Error(400, 'InvalidPolicyDocument', 'Invalid policy');
  }
  if (policy.expiration && Date.now() > Date.parse(policy.expiration)) {
    throw new S3Error(403, 'AccessDenied', 'Invalid according to Policy: Policy expired.');
  }
  const value = (name: string): string =>
    name === 'bucket' ? bucket : name === 'key' ? key : (fields[name.toLowerCase()] ?? '');
  const denied = (name: string): S3Error =>
    new S3Error(403, 'AccessDenied', `Invalid according to Policy: Policy Condition failed: ${name}`);
  for (const condition of policy.conditions ?? []) {
    if (Array.isArray(condition)) {
      const [operator, rawName, expected] = condition as [string, string, string];
      const name = String(rawName).replace(/^\$/, '');
      if (operator === 'eq' && value(name) !== expected) throw denied(name);
      if (operator === 'starts-with' && !value(name).startsWith(expected)) throw denied(name);
    } else if (condition && typeof condition === 'object') {
      for (const [name, expected] of Object.entries(condition)) {
        if (value(name) !== expected) throw denied(name);
      }
    }
  }
}

/** Parses a multipart/form-data body, streaming the `file` part to disk. */
async function receiveForm(
  body: Readable,
  boundary: string,
  filePath: string,
): Promise<{ fields: Record<string, string>; filename?: string; hasFile: boolean; md5: string }> {
  const fields: Record<string, string> = {};
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const hash = createHash('md5');
  const out = createWriteStream(filePath);
  let filename: string | undefined;
  let hasFile = false;
  // Prefixed so the first boundary looks like all the others.
  let buffer: Buffer = Buffer.from('\r\n');
  let state = 'boundary' as 'boundary' | 'headers' | 'body' | 'end';
  let current: { name: string; isFile: boolean; chunks: Buffer[] } | null = null;

  const writeFilePart = async (data: Buffer): Promise<void> => {
    hash.update(data);
    if (!out.write(data)) await once(out, 'drain');
  };

  const consume = async (): Promise<boolean> => {
    if (state === 'boundary') {
      const at = buffer.indexOf(delimiter);
      if (at === -1 || buffer.length < at + delimiter.length + 2) return false;
      const tail = buffer.toString('latin1', at + delimiter.length, at + delimiter.length + 2);
      buffer = buffer.subarray(at + delimiter.length + 2);
      state = tail === '--' ? 'end' : 'headers';
      return true;
    }
    if (state === 'headers') {
      const at = buffer.indexOf('\r\n\r\n');
      if (at === -1) return false;
      const headers = buffer.toString('utf8', 0, at);
      buffer = buffer.subarray(at + 4);
      const name = /\bname="([^"]*)"/i.exec(headers)?.[1] ?? '';
      const isFile = name.toLowerCase() === 'file';
      if (isFile) {
        hasFile = true;
        filename = /\bfilename="([^"]*)"/i.exec(headers)?.[1];
        // A browser's Content-Type part header is not the object's: S3 takes it from the form field.
      }
      current = { name: name.toLowerCase(), isFile, chunks: [] };
      state = 'body';
      return true;
    }
    if (state === 'body' && current) {
      const at = buffer.indexOf(delimiter);
      if (at === -1) {
        // Everything except a possible partial delimiter at the end is data.
        const safe = buffer.length - delimiter.length;
        if (safe <= 0) return false;
        const data = buffer.subarray(0, safe);
        buffer = buffer.subarray(safe);
        if (current.isFile) await writeFilePart(data);
        else current.chunks.push(data);
        return false;
      }
      const data = buffer.subarray(0, at);
      buffer = buffer.subarray(at);
      if (current.isFile) await writeFilePart(data);
      else fields[current.name] = Buffer.concat([...current.chunks, data]).toString('utf8');
      current = null;
      state = 'boundary';
      return true;
    }
    return false;
  };

  try {
    for await (const chunk of body) {
      buffer = Buffer.concat([buffer, chunk as Buffer]);
      while (await consume());
    }
  } finally {
    await new Promise<void>((closed) => out.end(() => closed()));
  }
  if (state !== 'end') throw new S3Error(400, 'IncompleteBody', 'Truncated multipart body');
  return { fields, ...(filename === undefined ? {} : { filename }), hasFile, md5: hash.digest('hex') };
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, POST, DELETE');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Content-Length, Content-Range, Accept-Ranges, x-amz-request-id');
  // Chrome's check for a public page calling into a loopback address.
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

async function route(storage: Storage, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://storage.local');
  const method = req.method ?? 'GET';
  setCors(req, res);
  if (method === 'OPTIONS') {
    res.writeHead(200).end();
    return;
  }
  // Path-style addressing: /<bucket>/<key>.
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const slash = path.indexOf('/');
  const bucket = slash === -1 ? path : path.slice(0, slash);
  const key = slash === -1 ? '' : path.slice(slash + 1);
  if (!bucket) throw new S3Error(501, 'NotImplemented', 'Listing buckets is not implemented by disk storage');
  assertNotExpired(url);

  const query = url.searchParams;
  const uploadId = query.get('uploadId');
  if (!key) {
    if (method === 'POST') return storage.postObject(bucket, req, res);
    if (method === 'GET') return storage.listObjects(bucket, url, res);
    // Buckets exist implicitly: HEAD and create succeed, like an already existing bucket.
    if (method === 'HEAD' || method === 'PUT') {
      res.writeHead(200).end();
      return;
    }
  } else if (method === 'GET' || method === 'HEAD') {
    return storage.getObject(bucket, key, url, req, res);
  } else if (method === 'DELETE') {
    return uploadId ? storage.abortMultipart(uploadId, res) : storage.deleteObject(bucket, key, res);
  } else if (method === 'POST') {
    if (query.has('uploads')) return storage.createMultipart(bucket, key, req, res);
    if (uploadId) return storage.completeMultipart(bucket, key, uploadId, req, res);
  } else if (method === 'PUT') {
    // Object ACLs have no meaning here: everything is reachable on loopback already.
    if (query.has('acl')) {
      res.writeHead(200).end();
      return;
    }
    if (uploadId) return storage.uploadPart(uploadId, query.get('partNumber') ?? '', req, res);
    const source = req.headers['x-amz-copy-source'];
    if (typeof source === 'string') return storage.copyObject(bucket, key, source, req, res);
    return storage.putObject(bucket, key, req, res);
  }
  throw new S3Error(405, 'MethodNotAllowed', `${method} is not supported on this resource`);
}

function sendError(req: IncomingMessage, res: ServerResponse, error: unknown): void {
  const s3 = error instanceof S3Error ? error : new S3Error(500, 'InternalError', String(error));
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // Whatever is left of the request body would otherwise stall the connection.
  req.resume();
  res.writeHead(s3.status, { 'Content-Type': 'application/xml' });
  res.end(
    req.method === 'HEAD'
      ? undefined
      : xml(`<Error><Code>${s3.code}</Code><Message>${xmlEscape(s3.message)}</Message></Error>`),
  );
}

export async function startDiskStorage(options: DiskStorageOptions): Promise<DiskStorageServer> {
  const storage = new Storage(options.dir);
  await mkdir(storage.dir, { recursive: true });
  // Interrupted uploads leave only temporary files; nothing refers to them after a restart.
  await rm(join(storage.dir, INTERNAL_DIR, 'tmp'), { recursive: true, force: true });

  const host = options.host ?? '127.0.0.1';
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    route(storage, req, res).catch((error: unknown) => sendError(req, res, error));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('disk storage has no TCP address');
  return {
    dir: storage.dir,
    host,
    port: address.port,
    endpoint: `http://${host}:${address.port}`,
    close: () =>
      new Promise((resolveClose) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolveClose());
      }),
  };
}
