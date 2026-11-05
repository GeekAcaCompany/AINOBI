// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, type ReactNode } from 'react';
import { currentHost } from './host.ts';

export const ProtectedRoute = (props: { children: ReactNode; redirectTo?: string }) =>
  createElement(currentHost().ProtectedRoute, props);
