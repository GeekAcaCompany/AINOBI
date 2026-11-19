# Third-party notices

This file lists the third-party code and assets in this repository, and the dependencies whose terms need attention. None of it is covered by the AGPL unless stated. Update this file whenever such material is added.

## Code included in this repository

### Inochi2D

`packages/inochi2d` is a build of [Inochi2D/inochi2d-ts](https://github.com/Inochi2D/inochi2d-ts), under the BSD 2-Clause license in `packages/inochi2d/LICENSE`. The build contains [pako](https://github.com/nodeca/pako) 2.1.0 (MIT and Zlib), whose notice is kept in the file, and [fast-png](https://github.com/image-js/fast-png), [iobuffer](https://github.com/image-js/iobuffer), [@lunapaint/tga-codec](https://github.com/lunapaint/tga-codec), and [binary-parser](https://github.com/keichi/binary-parser), all under the MIT license. Their license texts are in `packages/inochi2d/licenses/`.

### JSZip

`apps/pptx2html-service/runtime/vendor/jszip.min.js` is [JSZip](https://github.com/Stuk/jszip) 3.8.0, unmodified. JSZip is offered under the MIT license or the GPL version 3; this repository uses it under the MIT license. The file also contains pako (MIT and Zlib), lie (MIT), immediate (MIT), and set-immediate-shim (MIT). Their license texts are in `apps/pptx2html-service/runtime/vendor/licenses/`, copied from the installed packages by `apps/pptx2html-service/scripts/sync-runtime-vendor.js`; set-immediate-shim ships no license file, so its readme, which states the license, is copied instead.

### Code adapted in the avatar generator

`packages/avatar-generator` is written for AINOBI, except for the parts below. They are translated to TypeScript from other projects and remain under those projects' licenses. Each is marked where it starts in the source, and the license texts are in `packages/avatar-generator/licenses/`.

| Code | Adapted from | License |
| --- | --- | --- |
| `fmSolve`, `inpaintTelea`, and `eccTranslation` in `src/cvops.ts` | [OpenCV](https://github.com/opencv/opencv), `modules/photo/src/inpaint.cpp` and `modules/video/src/ecc.cpp`, © 2000 Intel Corporation | Apache-2.0; both files also carry the Intel License Agreement, a 3-clause BSD license |
| `gaussianBlurBoxRadius` and `boxBlurLine` in `src/image.ts` | [Pillow](https://github.com/python-pillow/Pillow), `src/libImaging/BoxBlur.c`, © Secret Labs AB, Fredrik Lundh, Jeffrey 'Alex' Clark, and contributors | MIT-CMU |
| `Mt19937` in `src/inx.ts` | The MT19937 reference implementation `mt19937ar.c`, © 1997-2002 Makoto Matsumoto and Takuji Nishimura | BSD-3-Clause |

## Dependencies with terms to note

Dependencies are installed from npm under their own licenses and are not part of this repository. Most are under permissive licenses (MIT, ISC, BSD, Apache-2.0). `npx pnpm@10.5.0 licenses list` prints the license of every one. These need attention if you redistribute a build, an installation directory, or a container image that includes them:

- **`@anthropic-ai/claude-agent-sdk`** is not open source. It is © Anthropic PBC, all rights reserved, and its use is subject to Anthropic's [legal agreements](https://code.claude.com/docs/en/legal-and-compliance). The courseware service imports it for the editor's AI assistant, which stays off until an Anthropic compatible key is configured. The AGPL does not apply to it, and this project grants no right to redistribute it: check Anthropic's terms before you ship it inside an image or installer.
- **`@breezystack/lamejs`** is under the LGPL-3.0. `@ainobi/tts-google` uses it to encode narration as MP3. It stays a separate package that anyone can replace; if you distribute a bundle that includes it, keep its license and copyright notice and meet the LGPL's terms for the library.
- **`pptx-preview`** is used by the PowerPoint converter as its npm package publishes it. This repository contains no copy of it and changes none of its code: the converter loads the installed file and corrects the output from its own code (`apps/pptx2html-service/runtime/preview-render-hooks.js`). The package declares the ISC license and ships no license file. The `LICENSE` in the [author's repository](https://github.com/501351981/pptx-preview) states that the npm package is free to use, privately and commercially, and that its source is for personal study only, may not be published to internet platforms, and may not be modified and turned into another open-source project. Do not copy the library into a repository or publish a modified copy. Its published file contains Apache ECharts (Apache-2.0, with code from d3 under BSD-3-Clause), ZRender (BSD-3-Clause), lodash, uuid, JSZip, and readable-stream with its dependencies (MIT), inherits (ISC), and tslib (0BSD).
- **`@fontsource/*`** fonts, installed with the video renderer, are under the SIL Open Font License 1.1.
- **`lightningcss`**, a build tool, is under the MPL-2.0.

## Container images

The optional images are built on your machine from the Dockerfiles in `apps/`; this project publishes none. The PDF converter image installs [pdf2htmlEX](https://github.com/pdf2htmlEX/pdf2htmlEX), which is under the GPL version 3, from its upstream release. The images also install packages from the base distribution, each under its own license.

## Policy

- Keep the original copyright and license notices of any third-party code and add an entry here. Vendored files keep their upstream headers and license fields and do not receive the AGPL SPDX line. Code adapted into an AINOBI source file is marked where it starts, and that file keeps the AGPL SPDX line.
- Apart from the entries above, only licenses compatible with AGPL-3.0-only may be included in the code.
