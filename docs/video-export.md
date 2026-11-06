# Video export

Exporting courseware as video is optional, and one of two features that need more than Node.js (the other is [document conversion](document-conversion.md)). It renders in a headless browser with ffmpeg, which is why it runs in a Docker container. Without it, everything else works and the export button stays disabled.

You need [Docker](https://docs.docker.com/get-docker/).

```sh
docker build -f apps/video-render-service/Dockerfile -t ainobi-video-render .
docker run --rm -p 5635:5635 --add-host=host.docker.internal:host-gateway ainobi-video-render
```

The first build takes several minutes. Studio checks for the service every 15 seconds at `http://127.0.0.1:5635`, and enables the button once it answers; set `AINOBI_VIDEO_RENDER_SERVICE_URL` in `.env.local` if it runs elsewhere.

The container reads courseware pages and assets from Studio on your machine, so it must be able to reach the host. On Linux, the `--add-host` flag above provides that.
