// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';

test('resolveCoursewarePlatformOrgId rejects missing org context', async () => {
  const { resolveCoursewarePlatformOrgId } = await import('./courseware-platform-org.ts');
  await assert.rejects(
    () =>
      resolveCoursewarePlatformOrgId(
        {
          accessToken: 'token',
          userId: 'u',
          currentOrgId: 'wrong-org',
          user: { account_name: 'a' },
          organization: { org_id: 'wrong-org', org_name: 'x' },
          expireAt: new Date().toISOString(),
        } as unknown as Parameters<typeof resolveCoursewarePlatformOrgId>[0],
        {},
      ),
    (error: unknown) => {
      assert.ok(error instanceof AinobiCliError);
      assert.equal(error.code, 'USAGE');
      assert.match(error.message, /current_org_id is not used/i);
      return true;
    },
  );
});
