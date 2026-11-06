# Document conversion

Uploading a PDF or a PowerPoint (`.pptx`) file to a courseware converts each page into an HTML page, so the editor can show the document on a slide, page by page. Two optional services do the converting, each in a Docker container:

| Service | Converts | Uses | Default address |
| --- | --- | --- | --- |
| `apps/pdf2html-service` | PDF | [pdf2htmlEX](https://github.com/pdf2htmlEX/pdf2htmlEX) | `http://127.0.0.1:5636` |
| `apps/pptx2html-service` | PowerPoint | Chromium with [pptx-preview](https://www.npmjs.com/package/pptx-preview) | `http://127.0.0.1:5637` |

Without them everything else works, but uploading a PDF or PowerPoint file reports that the converter is unreachable. You need [Docker](https://docs.docker.com/get-docker/).

## Build

From the repository root:

```sh
docker build -f apps/pdf2html-service/Dockerfile -t ainobi-pdf2html .
docker build -f apps/pptx2html-service/Dockerfile -t ainobi-pptx2html .
```

The first build takes several minutes; the PowerPoint image downloads Chromium and CJK fonts. Packages come from the official Ubuntu, Debian, and npm sources. Where those are slow, pass a mirror: `--build-arg APT_MIRROR=mirrors.aliyun.com --build-arg NPM_REGISTRY=https://registry.npmmirror.com`.

The PDF image downloads pdf2htmlEX 0.18.8.rc1 from the project's GitHub release and checks its SHA-256; see `apps/pdf2html-service/pdf2htmlEX/README.md`.

## Run

The converters read the uploaded file from Studio's storage and write the pages back, so they need its address. Studio's storage listens on port 56390 (plus `AINOBI_PORT_OFFSET`, if you set one).

**Docker Desktop (Windows and macOS):**

```sh
docker run -d --name ainobi-pdf2html -p 5636:3000 \
  -e STORAGE_BACKEND=oci_s3 -e OCI_S3_ENDPOINT=http://host.docker.internal:56390 \
  -e OCI_S3_BUCKET=ainobi-local -e OCI_S3_ACCESS_KEY_ID=lite -e OCI_S3_SECRET_KEY=lite -e OCI_S3_REGION=local \
  ainobi-pdf2html

docker run -d --name ainobi-pptx2html -p 5637:3000 \
  -e STORAGE_BACKEND=oci_s3 -e OCI_S3_ENDPOINT=http://host.docker.internal:56390 \
  -e OCI_S3_BUCKET=ainobi-local -e OCI_S3_ACCESS_KEY_ID=lite -e OCI_S3_SECRET_KEY=lite -e OCI_S3_REGION=local \
  ainobi-pptx2html
```

**Linux:** Studio's storage listens only on `127.0.0.1`, which a container on the default network cannot reach. Share the host's network instead, and give each converter its port:

```sh
docker run -d --name ainobi-pdf2html --network host -e PORT=5636 \
  -e STORAGE_BACKEND=oci_s3 -e OCI_S3_ENDPOINT=http://127.0.0.1:56390 \
  -e OCI_S3_BUCKET=ainobi-local -e OCI_S3_ACCESS_KEY_ID=lite -e OCI_S3_SECRET_KEY=lite -e OCI_S3_REGION=local \
  ainobi-pdf2html
```

and the same for `ainobi-pptx2html` with `-e PORT=5637`.

The values `lite` and `ainobi-local` are Studio's fixed local storage settings, not secrets.

## Check

Restart Studio after starting the containers. Its startup lines show:

```
  Documents       PDF on, PowerPoint on
```

Studio looks for the converters at the addresses above; if they run elsewhere, set `PDF2HTML_SERVICE_URL` and `PPTX2HTML_SERVICE_URL` in `.env.local`.

## Licenses

pdf2htmlEX is licensed under the GNU General Public License v3, and its source is available from its release. pptx-preview is ISC licensed, and the bundled JSZip is MIT or GPLv3.
