// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveImageGeneratePreauthTokens,
  resolvePromptOptimizePreauthTokens,
  settleRemainderUsage,
} from './courseware-image-ai-credits.ts';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('resolveImageGeneratePreauthTokens defaults to 200 and honors the env override', () => {
  withEnv({ AINOBI_IMAGE_GENERATE_PREAUTH_TOKENS: undefined }, () => {
    // At or below the observed gpt-image-2 totals (236-370) so the settlement bills the
    // actual usage instead of the reservation.
    assert.equal(resolveImageGeneratePreauthTokens(), 200);
  });
  withEnv({ AINOBI_IMAGE_GENERATE_PREAUTH_TOKENS: '900' }, () => {
    assert.equal(resolveImageGeneratePreauthTokens(), 900);
  });
  withEnv({ AINOBI_IMAGE_GENERATE_PREAUTH_TOKENS: 'not-a-number' }, () => {
    assert.equal(resolveImageGeneratePreauthTokens(), 200);
  });
});

test('resolvePromptOptimizePreauthTokens defaults to 500 and honors the env override', () => {
  withEnv({ AINOBI_PROMPT_OPTIMIZE_PREAUTH_TOKENS: undefined }, () => {
    assert.equal(resolvePromptOptimizePreauthTokens(), 500);
  });
  withEnv({ AINOBI_PROMPT_OPTIMIZE_PREAUTH_TOKENS: '800' }, () => {
    assert.equal(resolvePromptOptimizePreauthTokens(), 800);
  });
  withEnv({ AINOBI_PROMPT_OPTIMIZE_PREAUTH_TOKENS: '0' }, () => {
    assert.equal(resolvePromptOptimizePreauthTokens(), 500);
  });
});

test('settleRemainderUsage charges max(0, total - preauth) with the input reduced by the preauth', () => {
  // Typical image turn: usage above the preauth → settle the remainder.
  assert.deepEqual(
    settleRemainderUsage({ inputTokens: 300, outputTokens: 70, totalTokens: 370 }, 200),
    { inputTokens: 100, outputTokens: 70, totalTokens: 170 },
  );
  // Preauth covers the whole usage → nothing to settle.
  assert.equal(
    settleRemainderUsage({ inputTokens: 150, outputTokens: 30, totalTokens: 180 }, 200),
    null,
  );
  // Zero preauth (preauth skipped, e.g. no billing org) → settle the full usage.
  assert.deepEqual(
    settleRemainderUsage({ inputTokens: 240, outputTokens: 8, totalTokens: 248 }, 0),
    { inputTokens: 240, outputTokens: 8, totalTokens: 248 },
  );
  // Missing totalTokens falls back to input + output.
  assert.deepEqual(
    settleRemainderUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 0 }, 100),
    { inputTokens: 0, outputTokens: 50, totalTokens: 50 },
  );
  // The preauth never sends the settled input negative.
  assert.deepEqual(
    settleRemainderUsage({ inputTokens: 50, outputTokens: 300, totalTokens: 350 }, 200),
    { inputTokens: 0, outputTokens: 300, totalTokens: 150 },
  );
});
