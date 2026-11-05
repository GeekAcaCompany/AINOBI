// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertSafeAinobiExecArgv } from './codex-mcp-ainobi-policy.ts';

describe('assertSafeAinobiExecArgv', () => {
  it('accepts allowlisted argv', () => {
    const result = assertSafeAinobiExecArgv(['slide', 'list', '--verbose']);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.argv, ['slide', 'list', '--verbose']);
    }
  });

  it('rejects shell operator tokens but allows punctuation in content', () => {
    const chained = assertSafeAinobiExecArgv(['slide', 'list', '&&', 'rm', '-rf', '/']);
    assert.equal(chained.ok, false);

    const content = assertSafeAinobiExecArgv([
      'element',
      'insert',
      '0',
      '--type',
      'text',
      '--set',
      'text=f(x) > 0 && y < 1',
    ]);
    assert.equal(content.ok, true);
  });

  it('rejects ainobi binary prefix', () => {
    const result = assertSafeAinobiExecArgv(['ainobi', 'status']);
    assert.equal(result.ok, false);
  });

  it('blocks load after preload', () => {
    const result = assertSafeAinobiExecArgv(['load', 'scene.json'], { scenePreloaded: true });
    assert.equal(result.ok, false);
  });

  it('allows the timing commands the skill teaches', () => {
    assert.equal(assertSafeAinobiExecArgv(['highlight', 'add', '2', 'el_1']).ok, true);
    assert.equal(assertSafeAinobiExecArgv(['flow-pause', 'list', '2']).ok, true);
  });

  it('rejects unknown roots', () => {
    const result = assertSafeAinobiExecArgv(['curl', 'https://evil.example']);
    assert.equal(result.ok, false);
  });

  it('rejects empty argv', () => {
    const result = assertSafeAinobiExecArgv([]);
    assert.equal(result.ok, false);
  });

  it('rejects privileged commands that need dedicated MCP tools', () => {
    const cases: Array<[string, RegExp]> = [
      ['save', /courseware_save/],
      ['narration', /courseware_narration/],
      ['search', /courseware_search/],
      ['image', /courseware_image_generate|courseware_asset_upload/],
      ['doc', /courseware_doc_read/],
      ['tts', /courseware_tts_list/],
      ['ai-teachers', /courseware_ai_teachers/],
      ['asset', /courseware_asset/],
    ];
    for (const [root, name] of cases) {
      const result = assertSafeAinobiExecArgv([root, 'x']);
      assert.equal(result.ok, false, root);
      if (!result.ok) {
        assert.match(result.reason, /not allowed via ainobi_exec/i);
        assert.match(result.reason, name);
      }
    }
  });

  it('rejects absolute filesystem paths and parent traversal', () => {
    for (const argv of [
      ['element', 'insert', '0', '--asset', '/etc/passwd.png'],
      ['batch', 'apply', '--file', '../secret.json'],
      ['element', 'insert', '0', '--set', 'source=/tmp/x.png'],
    ]) {
      const result = assertSafeAinobiExecArgv(argv);
      assert.equal(result.ok, false, argv.join(' '));
    }
  });

  it('allows https source values', () => {
    const result = assertSafeAinobiExecArgv([
      'element',
      'insert',
      '0',
      '--type',
      'image',
      '--set',
      'source=https://cdn.example/a.png',
    ]);
    assert.equal(result.ok, true);
  });
});
