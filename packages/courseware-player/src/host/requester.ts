// SPDX-License-Identifier: AGPL-3.0-only
import { currentHost, lazyService } from './host.ts';

export const coursewareApi = lazyService(() => currentHost().coursewareApi);
export const api = lazyService(() => currentHost().api);
