// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { resolveLocalUploadPath } from './codex-mcp-media-tools.ts';

const on = { AINOBI_MCP_LOCAL_FILES: 'true' };
const image = resolve('/tmp/agent/cell.png');

describe('resolveLocalUploadPath', () => {
  it('is off unless the host turns it on', () => {
    assert.ok('error' in resolveLocalUploadPath(image, {}));
    assert.ok('error' in resolveLocalUploadPath(image, { AINOBI_MCP_LOCAL_FILES: 'false' }));
  });

  it('accepts an absolute path to a courseware asset', () => {
    assert.deepEqual(resolveLocalUploadPath(image, on), { path: image });
  });

  it('refuses relative paths', () => {
    assert.ok('error' in resolveLocalUploadPath('agent/cell.png', on));
  });

  it('reads only media, never documents, settings, or key files', () => {
    for (const name of ['.env', '.env.local', 'secrets.json', 'id_rsa', 'server.key', 'notes', 'notes.md', 'plan.txt', 'page.html', 'icon.svg', 'report.docx']) {
      assert.ok('error' in resolveLocalUploadPath(resolve('/home/user', name), on), name);
    }
  });
});
