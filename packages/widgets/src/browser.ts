// SPDX-License-Identifier: AGPL-3.0-only
// Script-tag entry: <script src="ainobi-widgets.js"></script> defines the elements and
// exposes the loader as window.AinobiWidgets.
import * as widgets from './index.ts';

widgets.defineAinobiElements();
(globalThis as { AinobiWidgets?: typeof widgets }).AinobiWidgets = widgets;
