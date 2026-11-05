// SPDX-License-Identifier: AGPL-3.0-only
import { currentHost } from './host.ts';

export const useAuth = () => currentHost().useAuth();
