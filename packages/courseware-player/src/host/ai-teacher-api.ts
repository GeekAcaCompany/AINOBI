// SPDX-License-Identifier: AGPL-3.0-only
import { currentHost, lazyService } from './host.ts';

export default lazyService(() => currentHost().aiTeacherApi);
