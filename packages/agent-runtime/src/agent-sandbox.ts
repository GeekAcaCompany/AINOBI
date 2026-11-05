// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The Claude Code sandbox settings this module produces: the subset of the Agent SDK's
 * `Options["sandbox"]` it sets, declared here so the package does not depend on the SDK.
 */
export type AgentSandboxSettings = {
  enabled: boolean;
  autoAllowBashIfSandboxed?: boolean;
  allowUnsandboxedCommands?: boolean;
  enableWeakerNestedSandbox?: boolean;
  bwrapPath?: string;
  socatPath?: string;
  ripgrep?: { command: string };
  network?: { allowedDomains: string[]; allowLocalBinding: boolean };
  filesystem?: { allowWrite: string[]; allowRead: string[]; denyRead: string[]; denyWrite: string[] };
};

function hostnameFromUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) {
    return undefined;
  }
  try {
    return new URL(url.trim()).hostname;
  } catch {
    return undefined;
  }
}

function addHostFromEnv(domains: Set<string>, env: NodeJS.ProcessEnv, keys: readonly string[]): void {
  for (const key of keys) {
    const host = hostnameFromUrl(env[key]);
    if (host) {
      domains.add(host);
    }
  }
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

export type AgentSandboxPolicy = {
  /** The host service's own environment (not the filtered agent subprocess env). */
  hostEnv: () => NodeJS.ProcessEnv;
  /** Env keys on the agent env whose URL hosts the sandbox network may reach. */
  hostUrlEnvKeys: readonly string[];
};

/** Claude Code OS sandbox settings for a host; every function reads the host env lazily. */
export function createAgentSandbox(policy: AgentSandboxPolicy) {
  /**
   * FC/Docker: bubblewrap cannot mount proc/userns inside nested containers.
   * Reads the host env only (not the filtered agent subprocess env).
   */
  function shouldEnableWeakerNestedSandbox(
    hostEnv: NodeJS.ProcessEnv = policy.hostEnv(),
    platform: NodeJS.Platform = process.platform,
  ): boolean {
    const raw = hostEnv.AINOBI_AGENT_WEAKER_NESTED_SANDBOX?.trim().toLowerCase();
    if (raw && FALSY.has(raw)) {
      return false;
    }
    if (raw && TRUTHY.has(raw)) {
      return true;
    }
    return platform === 'linux';
  }

  /** Escape hatch: run Bash without Claude OS sandbox (FC still has tool policy + VPC boundary). */
  function isAgentSandboxDisabled(hostEnv: NodeJS.ProcessEnv = policy.hostEnv()): boolean {
    const raw = hostEnv.AINOBI_AGENT_DISABLE_SANDBOX?.trim().toLowerCase();
    return Boolean(raw && TRUTHY.has(raw));
  }

  /**
   * Whether to enable Claude Code OS-level bash sandbox.
   * Off on Linux (Aliyun FC) by default: nested bwrap cannot mount proc; Agent SDK init fails
   * even when sandbox-runtime CLI works. Set AINOBI_AGENT_FORCE_SANDBOX=true to retry.
   * Off on Windows: the Claude Code sandbox supports only macOS and Linux/WSL2, and a host
   * process running on native Windows fails every query when it is requested.
   */
  function shouldUseOsSandbox(
    hostEnv: NodeJS.ProcessEnv = policy.hostEnv(),
    platform: NodeJS.Platform = process.platform,
  ): boolean {
    if (isAgentSandboxDisabled(hostEnv)) {
      return false;
    }
    const force = hostEnv.AINOBI_AGENT_FORCE_SANDBOX?.trim().toLowerCase();
    if (force && TRUTHY.has(force)) {
      return true;
    }
    if (force && FALSY.has(force)) {
      return false;
    }
    return platform === 'darwin';
  }

  function resolveBundledRgPath(projectRoot: string): string | undefined {
    const candidates = [
      resolve(projectRoot, 'bin', 'rg'),
      resolve(projectRoot, 'node_modules', '@vscode', 'ripgrep-linux-x64', 'bin', 'rg'),
    ];
    return candidates.find((p) => existsSync(p));
  }

  function resolveSandboxToolPaths(
    hostEnv: NodeJS.ProcessEnv = policy.hostEnv(),
  ): { bwrapPath?: string; socatPath?: string; rgPath?: string } {
    const bwrapCandidates = [
      hostEnv.AINOBI_AGENT_BWRAP_PATH?.trim(),
      '/opt/bin/bwrap',
      '/usr/bin/bwrap',
    ].filter(Boolean) as string[];
    const socatCandidates = [
      hostEnv.AINOBI_AGENT_SOCAT_PATH?.trim(),
      '/opt/bin/socat',
      '/usr/bin/socat',
    ].filter(Boolean) as string[];

    const pick = (candidates: string[]): string | undefined =>
      candidates.find((p) => existsSync(p));

    return {
      bwrapPath: pick(bwrapCandidates),
      socatPath: pick(socatCandidates),
    };
  }

  function resolveClaudeSandboxHelperPaths(
    projectRoot: string,
    hostEnv: NodeJS.ProcessEnv = policy.hostEnv(),
  ): {
    bwrapPath?: string;
    socatPath?: string;
    rgPath?: string;
    applySeccompPath?: string;
  } {
    const tools = resolveSandboxToolPaths(hostEnv);
    const claudeDir = resolve(
      projectRoot,
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk-linux-x64',
    );
    const applySeccomp = resolve(claudeDir, 'apply-seccomp');
    return {
      ...tools,
      rgPath: resolveBundledRgPath(projectRoot),
      applySeccompPath: existsSync(applySeccomp) ? applySeccomp : undefined,
    };
  }

  /**
   * Network allowlist for agent sandbox. Host service may reach VPC DB; subprocess may not.
   */
  function buildAgentSandboxSettings(
    baseUrl: string,
    workspaceDir: string,
    env: NodeJS.ProcessEnv,
    cliWorkDir?: string | null,
    projectRoot?: string,
  ): AgentSandboxSettings {
    if (!shouldUseOsSandbox()) {
      return {
        enabled: false,
        allowUnsandboxedCommands: true,
      };
    }

    const deployRoot = projectRoot?.trim() || process.cwd();
    const domains = new Set<string>();

    const fromBase = hostnameFromUrl(baseUrl);
    if (fromBase) {
      domains.add(fromBase);
    }

    addHostFromEnv(domains, env, policy.hostUrlEnvKeys);

    domains.add('127.0.0.1');
    domains.add('localhost');

    const workspaceRoot = resolve(workspaceDir);
    const allowWrite = [workspaceRoot, `${workspaceRoot}/**`];
    const workDir = cliWorkDir?.trim();
    if (workDir) {
      const resolvedWorkDir = resolve(workDir);
      allowWrite.push(resolvedWorkDir, `${resolvedWorkDir}/**`);
    }

    const weakerNested = shouldEnableWeakerNestedSandbox();
    const toolPaths = weakerNested ? resolveSandboxToolPaths() : {};
    const rgPath = resolveBundledRgPath(deployRoot);
    const claudePlatformDir = resolve(
      deployRoot,
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk-linux-x64',
    );

    // denyRead blocks **/bin/** and **/node_modules/** for agent file tools, but the sandbox
    // runtime must still read rg, bwrap, socat, apply-seccomp, and the claude binary on FC.
    const sandboxToolAllowRead = [
      '/opt/bin/bwrap',
      '/opt/bin/socat',
      `${deployRoot}/bin/**`,
      `${claudePlatformDir}/**`,
    ];

    return {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      ...(weakerNested ? { enableWeakerNestedSandbox: true } : {}),
      ...(toolPaths.bwrapPath ? { bwrapPath: toolPaths.bwrapPath } : {}),
      ...(toolPaths.socatPath ? { socatPath: toolPaths.socatPath } : {}),
      ...(rgPath ? { ripgrep: { command: rgPath } } : {}),
      network: {
        allowedDomains: [...domains].filter(Boolean).sort(),
        allowLocalBinding: true,
      },
      filesystem: {
        allowWrite,
        allowRead: sandboxToolAllowRead,
        denyRead: [
          '**/.git',
          '**/.git/**',
          '**/.env',
          '**/.env.*',
          '**/.env.example',
          '**/.env.prod',
          '**/cli/**',
          '**/courseware/**',
          '**/bin/**',
          '**/node_modules/**',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/package.json',
          '**/tsconfig.json',
          '**/yarn.lock',
          '**/.git-credentials',
          '**/.npmrc',
          '**/.pypirc',
          '**/credentials',
          '**/*service-account*.json',
          '**/id_rsa',
          '**/id_rsa.pub',
        ],
        denyWrite: [
          '**/.git',
          '**/.git/**',
          '**/.env',
          '**/.env.*',
          '**/cli/**',
          '**/courseware/**',
          '**/bin/**',
        ],
      },
    };
  }

  return {
    shouldEnableWeakerNestedSandbox,
    isAgentSandboxDisabled,
    shouldUseOsSandbox,
    resolveBundledRgPath,
    resolveSandboxToolPaths,
    resolveClaudeSandboxHelperPaths,
    buildAgentSandboxSettings,
  };
}

export type AgentSandbox = ReturnType<typeof createAgentSandbox>;
