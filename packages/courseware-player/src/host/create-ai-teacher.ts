// SPDX-License-Identifier: AGPL-3.0-only
import { currentHost } from './host.ts';

export const createAiTeacherAction = (): (() => void) | undefined => currentHost().onCreateAiTeacher;
