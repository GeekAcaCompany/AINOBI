// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AINOBI_BACKEND_API_BASE,
  joinAinobiBackendApiUrl,
  resolveAinobiBackendApiBase,
} from './api-base.ts';

describe('backend API base', () => {
  it('falls back to the hosted platform when unset or blank', () => {
    expect(resolveAinobiBackendApiBase(undefined)).toBe(DEFAULT_AINOBI_BACKEND_API_BASE);
    expect(resolveAinobiBackendApiBase('  ')).toBe(DEFAULT_AINOBI_BACKEND_API_BASE);
    expect(resolveAinobiBackendApiBase(' http://127.0.0.1:8000/v1 ')).toBe('http://127.0.0.1:8000/v1');
  });

  it('joins with exactly one slash', () => {
    expect(joinAinobiBackendApiUrl('http://h/v1/', 'user/check_session')).toBe('http://h/v1/user/check_session');
    expect(joinAinobiBackendApiUrl('http://h/v1', '/user')).toBe('http://h/v1/user');
  });
});
