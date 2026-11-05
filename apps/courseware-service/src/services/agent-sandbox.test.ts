// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentSandboxSettings,
  shouldEnableWeakerNestedSandbox,
  shouldUseOsSandbox,
} from './agent-sandbox.ts';

function withForcedOsSandbox<T>(fn: () => T): T {
  const prevForce = process.env.AINOBI_AGENT_FORCE_SANDBOX;
  if (process.platform !== 'darwin') {
    process.env.AINOBI_AGENT_FORCE_SANDBOX = 'true';
  }
  try {
    return fn();
  } finally {
    if (prevForce === undefined) {
      delete process.env.AINOBI_AGENT_FORCE_SANDBOX;
    } else {
      process.env.AINOBI_AGENT_FORCE_SANDBOX = prevForce;
    }
  }
}

test('buildAgentSandboxSettings includes API host and blocks unsandboxed escape', () => {
  const settings = withForcedOsSandbox(() => buildAgentSandboxSettings(
    'https://dashscope.example.com/apps/anthropic',
    '/code/agent-workspaces/conv-1',
    {
      AINOBI_COURSEWARE_PERSISTENCE_URL: 'http://127.0.0.1:3000/courseware',
      AINOBI_COURSEWARE_ASSET_UPLOAD_URL: 'http://127.0.0.1:5633/courseware/assets/upload',
      AINOBI_NARRATION_HOST_URL: 'http://127.0.0.1:5633/courseware/narration/run',
      AINOBI_SEARCH_HOST_URL: 'http://127.0.0.1:5633/courseware/search/run',
    },
  ));

  assert.equal(settings.enabled, true);
  assert.equal(settings.allowUnsandboxedCommands, false);
  assert.ok(settings.network?.allowedDomains?.includes('dashscope.example.com'));
  assert.ok(settings.network?.allowedDomains?.includes('127.0.0.1'));
  assert.ok(settings.network?.allowedDomains?.includes('localhost'));
  assert.ok(!settings.network?.allowedDomains?.includes('*.aliyuncs.com'));
  assert.ok(settings.filesystem?.denyRead?.some((p) => p.includes('.env')));
});

test('buildAgentSandboxSettings scopes filesystem writes to workspace only', () => {
  const workspace = '/code/agent-workspaces/conv-1';
  const settings = withForcedOsSandbox(() =>
    buildAgentSandboxSettings('https://example.com', workspace, {}),
  );

  const allowWrite = settings.filesystem?.allowWrite ?? [];
  assert.ok(allowWrite.includes(workspace));
  assert.ok(allowWrite.some((p) => p === `${workspace}/**`));
  assert.equal(allowWrite.some((p) => p.includes('ainobi-courseware-cli')), false);
});

test('buildAgentSandboxSettings allows writes to CLI work_dir when provided', () => {
  const workspace = '/code/agent-workspaces/conv-1';
  const workDir = '/var/folders/xx/T/ainobi-cli/work/ainobi-session';
  const settings = withForcedOsSandbox(() =>
    buildAgentSandboxSettings('https://example.com', workspace, {}, workDir),
  );

  const allowWrite = settings.filesystem?.allowWrite ?? [];
  assert.ok(allowWrite.includes(workDir));
  assert.ok(allowWrite.some((p) => p === `${workDir}/**`));
});

test('shouldEnableWeakerNestedSandbox parses explicit env on any platform', () => {
  assert.equal(
    shouldEnableWeakerNestedSandbox({ AINOBI_AGENT_WEAKER_NESTED_SANDBOX: 'true' }, 'darwin'),
    true,
  );
  assert.equal(
    shouldEnableWeakerNestedSandbox({ AINOBI_AGENT_WEAKER_NESTED_SANDBOX: 'false' }, 'linux'),
    false,
  );
});

test('shouldEnableWeakerNestedSandbox defaults true on linux when env unset', () => {
  assert.equal(shouldEnableWeakerNestedSandbox({}, 'linux'), true);
  assert.equal(shouldEnableWeakerNestedSandbox({}, 'darwin'), false);
});

test('buildAgentSandboxSettings enables weaker nested sandbox from host process.env', () => {
  const prev = process.env.AINOBI_AGENT_WEAKER_NESTED_SANDBOX;
  process.env.AINOBI_AGENT_WEAKER_NESTED_SANDBOX = 'true';
  try {
    const settings = withForcedOsSandbox(() =>
      buildAgentSandboxSettings('https://example.com', '/code/ws', {}),
    );
    assert.equal(settings.enableWeakerNestedSandbox, true);
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_AGENT_WEAKER_NESTED_SANDBOX;
    } else {
      process.env.AINOBI_AGENT_WEAKER_NESTED_SANDBOX = prev;
    }
  }
});

test('buildAgentSandboxSettings enables weaker nested on linux when OS sandbox forced', () => {
  if (process.platform !== 'linux') {
    return;
  }
  const prev = process.env.AINOBI_AGENT_WEAKER_NESTED_SANDBOX;
  delete process.env.AINOBI_AGENT_WEAKER_NESTED_SANDBOX;
  try {
    const settings = withForcedOsSandbox(() =>
      buildAgentSandboxSettings('https://example.com', '/code/ws', {}),
    );
    assert.equal(settings.enableWeakerNestedSandbox, true);
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_AGENT_WEAKER_NESTED_SANDBOX;
    } else {
      process.env.AINOBI_AGENT_WEAKER_NESTED_SANDBOX = prev;
    }
  }
});

test('buildAgentSandboxSettings allowRead permits sandbox tooling under deploy root', () => {
  const settings = withForcedOsSandbox(() =>
    buildAgentSandboxSettings('https://example.com', '/code/ws', {}, null, '/code'),
  );
  const allowRead = settings.filesystem?.allowRead ?? [];
  assert.ok(allowRead.some((p) => p.includes('/code/bin')));
  assert.ok(allowRead.some((p) => p.includes('claude-agent-sdk-linux-x64')));
  assert.equal(settings.network?.allowLocalBinding, true);
});

test('shouldUseOsSandbox is false on linux unless forced', () => {
  assert.equal(shouldUseOsSandbox({}, 'linux'), false);
  assert.equal(shouldUseOsSandbox({ AINOBI_AGENT_FORCE_SANDBOX: 'true' }, 'linux'), true);
  assert.equal(shouldUseOsSandbox({}, 'darwin'), true);
  assert.equal(shouldUseOsSandbox({}, 'win32'), false);
});

test('buildAgentSandboxSettings disables OS sandbox off macOS by default', () => {
  const prevForce = process.env.AINOBI_AGENT_FORCE_SANDBOX;
  const prevDisable = process.env.AINOBI_AGENT_DISABLE_SANDBOX;
  delete process.env.AINOBI_AGENT_FORCE_SANDBOX;
  delete process.env.AINOBI_AGENT_DISABLE_SANDBOX;
  try {
    const settings = buildAgentSandboxSettings('https://example.com', '/code/ws', {});
    if (process.platform !== 'darwin') {
      assert.equal(settings.enabled, false);
      assert.equal(settings.allowUnsandboxedCommands, true);
    } else {
      assert.equal(settings.enabled, true);
    }
  } finally {
    if (prevForce === undefined) delete process.env.AINOBI_AGENT_FORCE_SANDBOX;
    else process.env.AINOBI_AGENT_FORCE_SANDBOX = prevForce;
    if (prevDisable === undefined) delete process.env.AINOBI_AGENT_DISABLE_SANDBOX;
    else process.env.AINOBI_AGENT_DISABLE_SANDBOX = prevDisable;
  }
});

test('buildAgentSandboxSettings can disable sandbox via env', () => {
  const prev = process.env.AINOBI_AGENT_DISABLE_SANDBOX;
  const prevForce = process.env.AINOBI_AGENT_FORCE_SANDBOX;
  delete process.env.AINOBI_AGENT_FORCE_SANDBOX;
  process.env.AINOBI_AGENT_DISABLE_SANDBOX = 'true';
  try {
    const settings = buildAgentSandboxSettings('https://example.com', '/code/ws', {});
    assert.equal(settings.enabled, false);
    assert.equal(settings.allowUnsandboxedCommands, true);
  } finally {
    if (prev === undefined) {
      delete process.env.AINOBI_AGENT_DISABLE_SANDBOX;
    } else {
      process.env.AINOBI_AGENT_DISABLE_SANDBOX = prev;
    }
    if (prevForce === undefined) delete process.env.AINOBI_AGENT_FORCE_SANDBOX;
    else process.env.AINOBI_AGENT_FORCE_SANDBOX = prevForce;
  }
});
