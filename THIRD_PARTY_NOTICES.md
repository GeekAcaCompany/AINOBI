# Third-party notices

This file lists third-party code and assets included in this repository, with their licenses. Update it whenever such material is added. They are not covered by the AGPL unless stated.

## Live2D Cubism Core

`apps/studio/public/live2dcubismcore.min.js` is the proprietary Live2D Cubism Core runtime, © Live2D Inc., used under GeekAca Ltd.'s license from Live2D Inc. It is not open source and is not covered by this repository's license. Only Live2D avatars load it; Inochi2D avatars and the rest of AINOBI do not use it. If you redistribute AINOBI or use this runtime in your own product, you need your own agreement with Live2D Inc.: see <https://www.live2d.com/en/sdk/license/>.

## geekaca-teacher avatar model

`apps/studio/public/models/geekaca-teacher/` and `apps/studio/public/geekaca-teacher.png` are an avatar model and portrait owned by GeekAca Ltd. and are not covered by this repository's license. All rights reserved, except that you may use them unmodified to evaluate AINOBI.

## Inochi2D

`packages/inochi2d` is a build of [Inochi2D/inochi2d-ts](https://github.com/Inochi2D/inochi2d-ts), distributed under the BSD 2-Clause license text in `packages/inochi2d/LICENSE`.

## Policy

- Preserve the original copyright and license notices of any third-party code and add an entry here. Vendored files keep their upstream headers and license fields and do not receive the AGPL SPDX line.
- Apart from the entries above, only licenses compatible with AGPL-3.0-only may be included in the code.
- Dependencies installed from npm stay under their own licenses and are not part of this repository.
