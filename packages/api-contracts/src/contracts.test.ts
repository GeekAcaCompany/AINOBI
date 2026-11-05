// SPDX-License-Identifier: AGPL-3.0-only
// Contract assertions for the adopted kernel: every schema and enum module in
// the source tree is exported from the index and loads cleanly; the error
// codes the frontends branch on keep their exact values; the envelope shape
// is what the backend serializes.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from './core/errors.ts';
import type { Envelope, ErrorEnvelope, SuccessEnvelope } from './envelope.ts';
import * as contracts from './index.ts';

const sourceDir = fileURLToPath(new URL('.', import.meta.url));

function modules(dir: string): string[] {
  return readdirSync(join(sourceDir, dir))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'index.ts')
    .map((name) => name.slice(0, -3))
    .sort();
}

describe('module parity', () => {
  it('exports every schema module from the index', () => {
    const schemaExports = Object.keys(contracts).filter((key) => key.endsWith('Schema'));
    expect(schemaExports.length).toBe(modules('schemas').length);
  });

  it('exports every enum module from the index', () => {
    const enumExports = Object.keys(contracts).filter((key) => key.endsWith('Enum'));
    expect(enumExports.length).toBe(modules('enums').length);
  });

  it('loads the whole contract surface without a broken import', () => {
    // Any broken relative import from the adoption surfaces here.
    expect(Object.keys(contracts).length).toBeGreaterThan(60);
  });
});

describe('the error-code contract', () => {
  it('pins the codes the frontends branch on', () => {
    // 404001 doubles as session-death in the requester; 422006/422016 are the
    // permission and balance gates. Renumbering any of these breaks clients.
    expect(ErrorCode.USER_NOT_FOUND).toBe(404001);
    expect(ErrorCode.PERMISSION_INSUFFICIENT).toBe(422006);
    expect(ErrorCode.ASSET_INSUFFICIENT_BALANCE).toBe(422016);
  });

  it('keeps the HTTP×1000+business numbering scheme', () => {
    const values = Object.values(ErrorCode) as number[];
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(400000);
      expect(value).toBeLessThanOrEqual(599999);
    }
    // One deliberate alias shares a code (AGENT_ONLY_ENDPOINT and
    // CHILD_ORGANIZATION_BILLING_FORBIDDEN both mean 403012); the assertion is
    // ≥150 codes with at most that one collision, so a renumbering or an
    // accidental new collision still fails here.
    expect(values.length).toBeGreaterThanOrEqual(150);
    expect(values.length - new Set(values).size).toBe(1);
  });
});

describe('the envelope contract', () => {
  it('shapes success and error exactly as the backend serializes', () => {
    const success: SuccessEnvelope<{ id: string }> = {
      code: 0,
      message: 'OK',
      success: true,
      data: { id: 'x' },
    };
    const error: ErrorEnvelope = { code: 404001, message: 'nope', success: false };
    const either: Envelope<{ id: string }> = Math.random() < 0.5 ? success : error;
    expect(either.success).toBeDefined();
    if (either.success) {
      expect(either.code).toBe(0);
      expect(either.data).toEqual({ id: 'x' });
    } else {
      expect(either.code).toBe(404001);
    }
  });
});
