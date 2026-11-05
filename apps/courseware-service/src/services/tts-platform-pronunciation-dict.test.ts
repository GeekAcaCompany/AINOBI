// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNarrationPronunciationDictJson } from './narration-pronunciation-dict-env.ts';
import {
  __resetPlatformDictCacheForTests,
  listEnabledPlatformPronunciationDictEntries,
  loadMergedPronunciationDictEntries,
  mergePlatformIntoOrgEntries,
  type PlatformPronunciationDictQuery,
} from './tts-platform-pronunciation-dict.ts';
import type { PronunciationDictEntry } from './tts-pronunciation-apply.ts';

const ja = (sourceText: string, pronunciation: string): PronunciationDictEntry => ({
  sourceText,
  language: 'ja',
  pronunciation,
  enabled: true,
});

async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('mergePlatformIntoOrgEntries: org wins on the normalized key, the rest is appended after org', () => {
  const org = [ja(' ９月 ', 'くがつ'), ja('東京', 'とうきょう')];
  const platform: PronunciationDictEntry[] = [
    ja('9月', 'platform-reading'),
    ja('1人', 'ひとり'),
    { sourceText: '9月', language: 'zh', pronunciation: 'jiu3 yue4', enabled: true },
  ];
  const merged = mergePlatformIntoOrgEntries(org, platform);
  assert.deepEqual(
    merged.map((e) => [e.language, e.sourceText, e.pronunciation]),
    [
      ['ja', ' ９月 ', 'くがつ'],
      ['ja', '東京', 'とうきょう'],
      ['ja', '1人', 'ひとり'],
      ['zh', '9月', 'jiu3 yue4'],
    ],
  );
});

test('mergePlatformIntoOrgEntries: the key is case-sensitive like the trie (org API does not shadow platform api)', () => {
  const merged = mergePlatformIntoOrgEntries(
    [ja('API', 'えーぴーあい')],
    [ja('api', 'えいぴーあい'), ja('API', 'shadowed')],
  );
  assert.deepEqual(
    merged.map((e) => [e.sourceText, e.pronunciation]),
    [
      ['API', 'えーぴーあい'],
      ['api', 'えいぴーあい'],
    ],
  );
});

// The module loads the repo .env through db.ts; pin both knobs so a developer's local
// values (kill switch on, short TTL) cannot turn these tests red.
const DEFAULT_KNOBS = {
  AINOBI_TTS_PLATFORM_DICT_DISABLED: undefined,
  AINOBI_TTS_PLATFORM_DICT_CACHE_TTL_SECONDS: undefined,
};

test('listEnabledPlatformPronunciationDictEntries: caches within the TTL and single-flights', async () => {
  await withEnv(DEFAULT_KNOBS, async () => {
    __resetPlatformDictCacheForTests();
    let calls = 0;
    let clock = 1_000;
    const now = () => clock;
    const query = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [ja('9月', 'くがつ')];
    };
    const [a, b] = await Promise.all([
      listEnabledPlatformPronunciationDictEntries({ query, now }),
      listEnabledPlatformPronunciationDictEntries({ query, now }),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    clock += 10_000;
    await listEnabledPlatformPronunciationDictEntries({ query, now });
    assert.equal(calls, 1);
    clock += 60_000;
    await listEnabledPlatformPronunciationDictEntries({ query, now });
    assert.equal(calls, 2);
  });
});

test('listEnabledPlatformPronunciationDictEntries: failures keep the previous copy, [] without one', async () => {
  await withEnv(DEFAULT_KNOBS, async () => {
    __resetPlatformDictCacheForTests();
    let clock = 0;
    const now = () => clock;
    const good = async () => [ja('9月', 'くがつ')];
    const bad = async () => {
      throw new Error('relation "tts_pronunciation" does not exist');
    };
    assert.deepEqual(await listEnabledPlatformPronunciationDictEntries({ query: bad, now }), []);
    clock += 61_000;
    assert.equal((await listEnabledPlatformPronunciationDictEntries({ query: good, now })).length, 1);
    clock += 61_000;
    const stale = await listEnabledPlatformPronunciationDictEntries({ query: bad, now });
    assert.deepEqual(
      stale.map((e) => e.pronunciation),
      ['くがつ'],
    );
  });
});

test('listEnabledPlatformPronunciationDictEntries: an empty TTL variable means the default, not 0', async () => {
  await withEnv(
    { ...DEFAULT_KNOBS, AINOBI_TTS_PLATFORM_DICT_CACHE_TTL_SECONDS: '   ' },
    async () => {
      __resetPlatformDictCacheForTests();
      let calls = 0;
      let clock = 0;
      const now = () => clock;
      const query = async () => {
        calls += 1;
        return [ja('9月', 'くがつ')];
      };
      await listEnabledPlatformPronunciationDictEntries({ query, now });
      clock += 30_000;
      await listEnabledPlatformPronunciationDictEntries({ query, now });
      assert.equal(calls, 1);
    },
  );
});

test('listEnabledPlatformPronunciationDictEntries: disabled by env returns [] without querying', async () => {
  __resetPlatformDictCacheForTests();
  await withEnv({ AINOBI_TTS_PLATFORM_DICT_DISABLED: '1' }, async () => {
    let calls = 0;
    const result = await listEnabledPlatformPronunciationDictEntries({
      query: async () => {
        calls += 1;
        return [ja('9月', 'x')];
      },
    });
    assert.deepEqual(result, []);
    assert.equal(calls, 0);
  });
});

test('loadMergedPronunciationDictEntries: org first, platform rest', async () => {
  const result = await loadMergedPronunciationDictEntries('org-1', {
    includePlatform: true,
    listOrg: async () => [ja('9月', 'くがつ')],
    listPlatform: async () => [ja('9月', 'p'), ja('1人', 'ひとり')],
  });
  assert.deepEqual(
    result.map((e) => e.pronunciation),
    ['くがつ', 'ひとり'],
  );
});

test('loadMergedPronunciationDictEntries: a platform failure still returns the org entries', async () => {
  const result = await loadMergedPronunciationDictEntries('org-1', {
    includePlatform: true,
    listOrg: async () => [ja('東京', 'とうきょう')],
    listPlatform: async () => {
      throw new Error('boom');
    },
  });
  assert.deepEqual(
    result.map((e) => e.sourceText),
    ['東京'],
  );
});

test('loadMergedPronunciationDictEntries: includePlatform=false keeps the org dict only and never queries the platform', async () => {
  let platformCalls = 0;
  const result = await loadMergedPronunciationDictEntries('org-1', {
    includePlatform: false,
    listOrg: async () => [ja('東京', 'とうきょう')],
    listPlatform: async () => {
      platformCalls += 1;
      return [ja('9月', 'くがつ')];
    },
  });
  assert.equal(platformCalls, 0);
  assert.deepEqual(
    result.map((e) => e.sourceText),
    ['東京'],
  );
});

test('resolveNarrationPronunciationDictJson: forwards includePlatform to the merged loader', async () => {
  const seen: boolean[] = [];
  const loadMerged = async (_orgId: string, options: { includePlatform: boolean }) => {
    seen.push(options.includePlatform);
    return [ja('東京', 'とうきょう')];
  };
  await resolveNarrationPronunciationDictJson({
    orgId: 'org-1',
    ttsProvider: 'minimax',
    includePlatform: false,
    loadMerged,
  });
  await resolveNarrationPronunciationDictJson({
    orgId: 'org-1',
    ttsProvider: 'fishaudio',
    includePlatform: true,
    loadMerged,
  });
  assert.deepEqual(seen, [false, true]);
});

test('resolveNarrationPronunciationDictJson: org entries come before platform entries', async () => {
  const json = await resolveNarrationPronunciationDictJson({
    orgId: 'org-1',
    ttsProvider: 'minimax',
    includePlatform: true,
    loadMerged: async () => [ja('9月', 'くがつ'), ja('1人', 'ひとり')],
  });
  const parsed = JSON.parse(json as string) as PronunciationDictEntry[];
  assert.deepEqual(
    parsed.map((e) => e.sourceText),
    ['9月', '1人'],
  );
  assert.equal(
    await resolveNarrationPronunciationDictJson({
      orgId: 'org-1',
      ttsProvider: 'openai',
      includePlatform: true,
      loadMerged: async () => [ja('9月', 'くがつ')],
    }),
    undefined,
  );
  assert.equal(
    await resolveNarrationPronunciationDictJson({
      orgId: 'org-1',
      ttsProvider: 'fishaudio',
      includePlatform: true,
      loadMerged: async () => [],
    }),
    null,
  );
});

test('resolveNarrationPronunciationDictJson: no size cap, every entry is kept (the JSON goes to a temp file)', async () => {
  const platform = Array.from({ length: 2000 }, (_, i) =>
    ja(`平台語${i}`, 'ぷらっとふぉーむ'.repeat(4)),
  );
  const json = await resolveNarrationPronunciationDictJson({
    orgId: 'org-1',
    ttsProvider: 'fishaudio',
    includePlatform: true,
    loadMerged: async () => [ja('東京', 'とうきょう'), ...platform],
  });
  assert.ok(Buffer.byteLength(json as string, 'utf8') > 128 * 1024);
  const parsed = JSON.parse(json as string) as PronunciationDictEntry[];
  assert.equal(parsed.length, 2001);
  assert.equal(parsed[0].sourceText, '東京');
});

test('listEnabledPlatformPronunciationDictEntries: a query that throws synchronously does not wedge the single-flight', async () => {
  await withEnv(DEFAULT_KNOBS, async () => {
    __resetPlatformDictCacheForTests();
    let clock = 0;
    const now = () => clock;
    const syncThrow = (() => {
      throw new Error('sync failure');
    }) as unknown as PlatformPronunciationDictQuery;
    assert.deepEqual(await listEnabledPlatformPronunciationDictEntries({ query: syncThrow, now }), []);
    clock += 61_000;
    const good = async () => [ja('9月', 'くがつ')];
    assert.equal((await listEnabledPlatformPronunciationDictEntries({ query: good, now })).length, 1);
  });
});

test('resolveNarrationPronunciationDictJson: without an org, a Japanese job still gets the platform dict', async () => {
  const listPlatform = async () => [ja('9月', 'くがつ')];
  const json = await resolveNarrationPronunciationDictJson({
    orgId: null,
    ttsProvider: 'minimax',
    includePlatform: true,
    listPlatform,
  });
  assert.deepEqual(
    (JSON.parse(json as string) as PronunciationDictEntry[]).map((e) => e.sourceText),
    ['9月'],
  );
  // Neither an org nor a Japanese job: nothing to send.
  assert.equal(
    await resolveNarrationPronunciationDictJson({
      orgId: '',
      ttsProvider: 'minimax',
      includePlatform: false,
      listPlatform,
    }),
    undefined,
  );
});
