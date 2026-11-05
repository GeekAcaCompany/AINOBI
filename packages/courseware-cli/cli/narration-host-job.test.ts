// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { AinobiCliError } from './errors.ts';
import {
  PENDING_NARRATION_SUBDIR,
  ainobiCliErrorFromHostNarrationFailure,
  workspaceDirFromStateDir,
} from './narration-host-job.ts';

test('legacy pending-narration subdir constant is retained for compatibility', () => {
  assert.equal(PENDING_NARRATION_SUBDIR, 'pending-narration');
  assert.ok(join('.ainobi-cli', PENDING_NARRATION_SUBDIR).includes('pending-narration'));
});

test('workspaceDirFromStateDir preserves absolute paths on Unix', () => {
  const stateDir = '/tmp/agent-workspaces/chat-1/.ainobi-cli';
  assert.equal(workspaceDirFromStateDir(stateDir), '/tmp/agent-workspaces/chat-1');
});

test('ainobiCliErrorFromHostNarrationFailure recovers NOT_LOADED from stderr envelope', () => {
  const error = ainobiCliErrorFromHostNarrationFailure({
    ok: false,
    exit_code: 7,
    stdout: '',
    stderr: JSON.stringify({
      ok: false,
      error: {
        code: 'NOT_LOADED',
        message: 'No AI teacher catalog is loaded for this session.',
        hint: 'Run ainobi ai-teachers list --save',
        issues: [],
      },
    }),
  });
  assert.ok(error instanceof AinobiCliError);
  assert.equal(error.code, 'NOT_LOADED');
  assert.match(error.message, /No AI teacher catalog/);
  assert.match(error.hint ?? '', /ai-teachers list/);
});

test('ainobiCliErrorFromHostNarrationFailure recovers the envelope behind stderr diagnostics', () => {
  const diag =
    '[tts] japanese kana rewrite {"provider":"minimax","source":"host-auto-kana","from":"東京"}\n';
  const envelope = {
    ok: false,
    error: { code: 'NOT_FOUND', message: 'Slide 9 not found.', hint: 'Check the slide index.', issues: [] },
  };
  for (const pretty of [false, true]) {
    const stderr = diag + diag + (pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope));
    const error = ainobiCliErrorFromHostNarrationFailure({ ok: false, exit_code: 4, stdout: '', stderr });
    assert.equal(error.code, 'NOT_FOUND', `pretty=${pretty}`);
    assert.equal(error.message, 'Slide 9 not found.');
    assert.equal(error.hint, 'Check the slide index.');
  }
});

test('ainobiCliErrorFromHostNarrationFailure maps exit code when envelope missing', () => {
  const error = ainobiCliErrorFromHostNarrationFailure({
    ok: false,
    exit_code: 3,
    stdout: '',
    stderr: 'host failed without json',
  });
  assert.equal(error.code, 'NOT_LOADED');
  assert.match(error.message, /host failed without json/);
});

test('ainobiCliErrorFromHostNarrationFailure falls back to IO_ERROR for unknown exit', () => {
  const error = ainobiCliErrorFromHostNarrationFailure({
    ok: false,
    exit_code: 99,
    stdout: '',
    stderr: '',
  });
  assert.equal(error.code, 'IO_ERROR');
  assert.match(error.message, /exit 99/);
});
