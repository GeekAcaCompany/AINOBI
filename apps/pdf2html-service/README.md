# Ainobi PDF to HTML Service

Node/Express service that uploads PDF files to Aliyun OSS, converts each PDF page to a standalone HTML file with `pdf2htmlEX`, and uploads the generated HTML artifacts back to OSS.

## API

Start locally:

```sh
pnpm install
npm start
```

Upload a raw PDF to OSS:

```sh
curl -F "pdf=@document.pdf" http://localhost:3000/api/upload
```

The service stores raw PDF objects under `raw/pdf/{pdf_id}.pdf`, where `pdf_id` is the MD5 hash of the uploaded file. Uploading the same file again reuses the existing raw object.

Convert a PDF and store per-page HTML in OSS:

```sh
curl -F "pdf=@document.pdf" http://localhost:3000/api/pdf2html
```

Convert a previously uploaded PDF:

```sh
curl -X POST -H "Content-Type: application/json" \
  -d '{"pdf_id":"<md5>"}' \
  http://localhost:3000/api/pdf2html
```

Per-page HTML artifacts are stored under `artifact/pdf/{pdf_id}/html/page_{page}.html`.

Successful conversion responses have this shape:

```json
{
  "ok": true,
  "pdf_id": "d41d8cd98f00b204e9800998ecf8427e",
  "rawObjectKey": "raw/pdf/d41d8cd98f00b204e9800998ecf8427e.pdf",
  "rawObjectPath": "/raw/pdf/d41d8cd98f00b204e9800998ecf8427e.pdf",
  "pageCount": 2,
  "artifacts": [
    {
      "page": 1,
      "html_id": "page_1",
      "objectKey": "artifact/pdf/d41d8cd98f00b204e9800998ecf8427e/html/page_1.html",
      "objectPath": "/artifact/pdf/d41d8cd98f00b204e9800998ecf8427e/html/page_1.html",
      "bytes": 123456
    }
  ],
  "elapsedMs": 1234,
  "bytes": 123456
}
```

## Docker

```sh
docker build --platform linux/amd64 -t ainobi-pdf2html-service .
docker run --rm -p 3000:3000 --env-file .env ainobi-pdf2html-service
```

The image uses Ubuntu 20.04, installs Node.js, and installs the official `x86_64` `pdf2htmlEX` Debian archive with `apt`. Build and deploy it as `linux/amd64`; this also works on Apple Silicon Docker Desktop through emulation. This avoids Alpine `iconv` limitations that can break PDFs using encodings such as `Mac Roman`.

## Configuration

Copy `.env.example` to `.env` for local overrides.

- `PORT` defaults to `3000`.
- `MAX_FILE_SIZE_MB` defaults to `100`.
- `WORK_DIR` controls temporary conversion files.
- `PDF2HTMLEX_PATH` defaults to `pdf2htmlEX`.
- `PDFINFO_PATH` defaults to `pdfinfo`.
- `PDF2HTML_TIMEOUT_MS` defaults to `600000`.
- `PDF2HTMLEX_ZOOM` defaults to `1.5`.
- `PDF2HTMLEX_EMBED_*` controls standalone asset embedding.
- `HTML_MINIFY` defaults to `true`.
- `OSS_REGION` / `OSS_ENDPOINT` configure the Aliyun OSS region or endpoint.
- `OSS_BUCKET`, `ALIYUN_ACCESS_KEY_ID`, and `ALIYUN_ACCESS_KEY_SECRET` are required for OSS upload/download.
- `OSS_STS_TOKEN` is optional for temporary credentials.
- `OSS_MULTIPART_*` controls large object upload behavior.
