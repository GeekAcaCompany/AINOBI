// SPDX-License-Identifier: AGPL-3.0-only
import { createElement, type ReactNode } from 'react';
import { currentHost } from './host.ts';

export const FeatureGate = (props: { capability: string; mode?: any; children: ReactNode; [prop: string]: any }) =>
  createElement(currentHost().FeatureGate, props);
