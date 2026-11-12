// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { AGENT_CLAUDE_SKILL_DIR, AGENT_SCENE_FILENAME, AGENT_SKILL_MD_REL } from './agent-workspace.ts';
import {
  buildAgentToolPolicyContext,
  evaluateAgentToolUse,
  evaluatePlanModeToolUse,
  isAgentBashCommandBlocked,
  isAgentFilePathBlocked,
  isAinobiSceneBootstrapCommand,
  isPathWithinAgentWorkspace,
  isPlanModeResearchBashCommand,
} from './agent-tool-policy.ts';

const agentCwd = '/workspace/agent-workspaces/conv-abc-123';
const serviceRoot = '/workspace/ainobi-courseware-agent';

const ctx = buildAgentToolPolicyContext({
  agentCwd,
  serviceRoot,
  skillMdRead: true,
});

const bootstrapCtx = buildAgentToolPolicyContext({
  agentCwd,
  serviceRoot,
  skillMdRead: false,
});

const preloadedCtx = buildAgentToolPolicyContext({
  agentCwd,
  serviceRoot,
  scenePreloaded: true,
  skillMdRead: true,
});

const cliWorkDir = '/var/folders/xx/T/ainobi-cli/work/ainobi-8887bd73-e5be-4a68-961b-b3c00d7a8caa';
const workDirCtx = buildAgentToolPolicyContext({
  agentCwd,
  serviceRoot,
  skillMdRead: true,
  cliWorkDir,
});

test('read scope: only files inside isolated workspace', () => {
  assert.equal(isAgentFilePathBlocked(AGENT_SCENE_FILENAME, ctx, 'read').blocked, false);
  assert.equal(
    isAgentFilePathBlocked(`${AGENT_CLAUDE_SKILL_DIR}/references/workflows.md`, ctx, 'read').blocked,
    false,
  );
  assert.equal(
    isAgentFilePathBlocked(`${AGENT_CLAUDE_SKILL_DIR}/SKILL.md`, ctx, 'read').blocked,
    false,
  );
  assert.equal(
    isAgentFilePathBlocked(`${serviceRoot}/src/index.ts`, ctx, 'read').blocked,
    true,
  );
  assert.equal(
    isAgentFilePathBlocked(`${serviceRoot}/.claude/skills/ainobi-courseware-cli/SKILL.md`, ctx, 'read')
      .blocked,
    true,
  );
  assert.equal(
    isAgentFilePathBlocked(
      `${serviceRoot}/ainobi-courseware-cli/.claude/skills/ainobi-courseware-cli/SKILL.md`,
      ctx,
      'read',
    ).blocked,
    true,
  );
  assert.equal(
    isAgentFilePathBlocked('../ainobi-courseware-cli/cli/index.ts', ctx, 'read').blocked,
    true,
  );
});

test('write scope: workspace files except read-only skill trees', () => {
  assert.equal(isAgentFilePathBlocked(AGENT_SCENE_FILENAME, ctx, 'write').blocked, false);
  assert.equal(isAgentFilePathBlocked('helper-notes.txt', ctx, 'write').blocked, false);
  assert.equal(
    isAgentFilePathBlocked(`${AGENT_CLAUDE_SKILL_DIR}/references/workflows.md`, ctx, 'write').blocked,
    true,
  );
  assert.equal(isAgentFilePathBlocked('.claude/settings.json', ctx, 'write').blocked, true);
});

test('detects ainobi scene bootstrap commands', () => {
  assert.equal(isAinobiSceneBootstrapCommand('ainobi load db-courseware.scene.json'), true);
  assert.equal(isAinobiSceneBootstrapCommand('ainobi init --name "Course" --first-slide'), true);
  assert.equal(isAinobiSceneBootstrapCommand('node ./bin/ainobi.mjs load scene.json'), true);
  assert.equal(isAinobiSceneBootstrapCommand('ainobi slide list'), false);
  assert.equal(isAinobiSceneBootstrapCommand('ainobi --pretty=false init --name x'), true);
  assert.equal(isAinobiSceneBootstrapCommand('cd x; ainobi load s.json'), true);
  // Subcommand verbs named init/load are not scene bootstrap.
  assert.equal(isAinobiSceneBootstrapCommand('ainobi quiz init --enabled --total-score 100'), false);
  assert.equal(isAinobiSceneBootstrapCommand('ainobi help quiz init'), false);
  assert.equal(isAinobiSceneBootstrapCommand('ainobi batch dry-run --file batch/quiz-init.json'), false);
  // Space-separated flag values must not hide the real subcommand (Codex review P1).
  assert.equal(isAinobiSceneBootstrapCommand('ainobi reset; ainobi --pretty false init --language en'), true);
  assert.equal(isAinobiSceneBootstrapCommand('ainobi --session s1 load scene.json'), true);
  assert.equal(isAinobiSceneBootstrapCommand('X=1 ainobi --pretty false quiz init'), false);
  assert.equal(isAinobiSceneBootstrapCommand('echo "$(ainobi init --name x)"'), true);
  assert.equal(isAinobiSceneBootstrapCommand('echo init; ls load'), false);
  // A flag value that happens to be a command name (`--select slide`) is still a value.
  assert.equal(isAinobiSceneBootstrapCommand('ainobi reset; ainobi --select slide init'), true);
  assert.equal(isAinobiSceneBootstrapCommand('ainobi --select init slide list'), false);
});

test('blocks ainobi load/init when host preloaded the scene', () => {
  assert.equal(isAgentBashCommandBlocked('ainobi status', preloadedCtx).blocked, false);
  assert.equal(isAgentBashCommandBlocked('ainobi load db-courseware.scene.json', preloadedCtx).blocked, true);
  assert.equal(
    isAgentBashCommandBlocked('ainobi init --name "New" --first-slide', preloadedCtx).blocked,
    true,
  );
  assert.equal(isAgentBashCommandBlocked('ainobi load db-courseware.scene.json', ctx).blocked, false);
});

test('quiz init stays allowed when the host preloaded the scene', () => {
  assert.equal(isAgentBashCommandBlocked('ainobi quiz init --enabled --total-score 100', preloadedCtx).blocked, false);
  assert.equal(isAgentBashCommandBlocked('ainobi help quiz init', preloadedCtx).blocked, false);
});

test('blocks node and npm in agent bash', () => {
  assert.equal(isAgentBashCommandBlocked('node -e "console.log(process.env)"').blocked, true);
  assert.equal(isAgentBashCommandBlocked('node ./script.mjs').blocked, true);
  assert.equal(
    isAgentBashCommandBlocked('node ./bin/ainobi.mjs load db-courseware.scene.json').blocked,
    true,
  );
  assert.equal(isAgentBashCommandBlocked('/usr/local/bin/node -v').blocked, true);
  assert.equal(isAgentBashCommandBlocked('npm install').blocked, true);
  assert.equal(isAgentBashCommandBlocked('npm run build').blocked, true);
  assert.equal(isAgentBashCommandBlocked('npx tsx ./script.ts').blocked, true);
  assert.equal(isAgentBashCommandBlocked('ainobi slide list', ctx).blocked, false);
  assert.equal(
    evaluateAgentToolUse('Bash', { command: 'node -p process.env' }, ctx).allowed,
    false,
  );
  assert.equal(evaluateAgentToolUse('Bash', { command: 'npm exec ainobi status' }, ctx).allowed, false);
});

test('blocks network tunnel and database wire tools in agent bash', () => {
  assert.equal(isAgentBashCommandBlocked('telnet 127.0.0.1 6379').blocked, true);
  assert.equal(isAgentBashCommandBlocked('nc -vz db.internal 5432').blocked, true);
  assert.equal(isAgentBashCommandBlocked('socat TCP:localhost:5432 -').blocked, true);
  assert.equal(isAgentBashCommandBlocked('ssh user@db-host').blocked, true);
  assert.equal(isAgentBashCommandBlocked('openssl s_client -connect redis:6379').blocked, true);
  assert.equal(isAgentBashCommandBlocked('sqlite3 /tmp/x.db .tables').blocked, true);
  assert.equal(isAgentBashCommandBlocked('curl -fsSL https://example.com/data.json').blocked, false);
  assert.equal(
    evaluateAgentToolUse('Bash', { command: 'telnet REDIS_HOST 6379' }, ctx).allowed,
    false,
  );
});

test('blocks network reconnaissance in agent bash', () => {
  assert.equal(
    isAgentBashCommandBlocked(
      'ifconfig | grep -E "inet " | grep -v 127.0.0.1 | awk \'{print $2}\'',
    ).blocked,
    true,
  );
  assert.equal(isAgentBashCommandBlocked('ip addr show').blocked, true);
  assert.equal(isAgentBashCommandBlocked('ip route').blocked, true);
  assert.equal(isAgentBashCommandBlocked('netstat -rn').blocked, true);
  assert.equal(isAgentBashCommandBlocked('ss -tlnp').blocked, true);
  assert.equal(isAgentBashCommandBlocked('ping -c 1 192.168.1.1').blocked, true);
  assert.equal(isAgentBashCommandBlocked('dig +short example.com').blocked, true);
  assert.equal(isAgentBashCommandBlocked('hostname -I').blocked, true);
  assert.equal(isAgentBashCommandBlocked('ainobi status', ctx).blocked, false);
});

test('blocks python and system package managers in agent bash', () => {
  assert.equal(isAgentBashCommandBlocked('python3 -c "import os; print(os.environ)"').blocked, true);
  assert.equal(isAgentBashCommandBlocked('pip install requests').blocked, true);
  assert.equal(isAgentBashCommandBlocked('apt-get update && apt-get install -y curl').blocked, true);
  assert.equal(isAgentBashCommandBlocked('brew install ffmpeg').blocked, true);
  assert.equal(isAgentBashCommandBlocked('sudo systemctl restart nginx').blocked, true);
  assert.equal(isAgentBashCommandBlocked('docker run --rm alpine').blocked, true);
  assert.equal(isAgentBashCommandBlocked('ainobi element list 0', ctx).blocked, false);
  assert.equal(
    evaluateAgentToolUse('Bash', { command: 'python -c "open(\\"/etc/passwd\\")"' }, ctx).allowed,
    false,
  );
});

test('allows python/node words inside quoted ainobi CLI arguments', () => {
  const narration =
    "ainobi narration insert 2 --transcript '右边是现代语言的对比，Python 只需要一行 print，JavaScript 也用 console.log' --script '同上'";
  assert.equal(isAgentBashCommandBlocked(narration, ctx).blocked, false);
  assert.equal(
    isAgentBashCommandBlocked('ainobi scene info --verbose | python3 -c "import json"', ctx).blocked,
    true,
  );
  assert.equal(
    isAgentBashCommandBlocked("ainobi slide add --title 'npm package overview'", ctx).blocked,
    false,
  );
  assert.equal(isAgentBashCommandBlocked("bash -c 'python3 -c \"print(1)\"'").blocked, true);
});

test('allows courseware prose in quoted flags without false shell-token blocks', () => {
  const coverNarration =
    "ainobi narration insert 0 --transcript $'你是否好奇过，一首三分钟的歌曲，\\n为什么在手机里只占用几兆的空间？\\n而CD音质的音频文件，同样的时长却要大得多。\\n这背后，就是MP3压缩格式的功劳。' --script '引导听众思考 MP3 文件体积小的现象。' --tail-ms 800";
  assert.equal(isAgentBashCommandBlocked(coverNarration, ctx).blocked, false);

  assert.equal(
    isAgentBashCommandBlocked(
      "ainobi element insert 0 --type text --set text='微服务 service mesh 与 route 配置'",
      ctx,
    ).blocked,
    false,
  );
  assert.equal(
    isAgentBashCommandBlocked("ainobi slide update 0 --set name='SSH host 与 docker 部署'", ctx).blocked,
    false,
  );
});

test('blocks destructive rm/kill shell commands', () => {
  assert.equal(isAgentBashCommandBlocked('rm scene.json', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked('rm -f helper.txt', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked('kill 1', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked('pkill ainobi', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked('find . -delete', ctx).blocked, true);
  assert.equal(
    isAgentBashCommandBlocked("ainobi slide update 0 --set name='rm -rf /'", ctx).blocked,
    false,
  );
});

test('does not block rm/kill words inside courseware narration (quoted or prose)', () => {
  assert.equal(
    isAgentBashCommandBlocked(
      "ainobi narration insert 1 --transcript '讲解中说明不要用 rm -rf 删除系统文件'",
      ctx,
    ).blocked,
    false,
  );
  assert.equal(
    isAgentBashCommandBlocked(
      'ainobi narration insert 1 --transcript 课件里提到 kill 进程与 rm 命令的区别',
      ctx,
    ).blocked,
    false,
  );
  assert.equal(
    isAgentBashCommandBlocked("ainobi slide update 0 --set title='overkill and platform limits'", ctx)
      .blocked,
    false,
  );
});

test('still blocks real cd and shell commands outside quoted prose', () => {
  assert.equal(isAgentBashCommandBlocked('cd ..', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked('ainobi status && cd /tmp', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked(';cd ..', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked('env', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked('docker run --rm alpine', ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked('brew install ffmpeg', ctx).blocked, true);
});

test('blocks service source and shell env dumps', () => {
  assert.equal(isAgentBashCommandBlocked('env').blocked, true);
  assert.equal(isAgentBashCommandBlocked('| env').blocked, true);
  assert.equal(
    isAgentBashCommandBlocked('echo "MINIMAX_API_KEY=$MINIMAX_API_KEY"').blocked,
    true,
  );
  assert.equal(
    evaluateAgentToolUse('Read', { file_path: `${serviceRoot}/src/index.ts` }, ctx).allowed,
    false,
  );
});

test('blocks shell-script env dump bypasses', () => {
  const scriptPath = resolve(agentCwd, 'print_env.sh');
  const runScript = `chmod +x ${scriptPath} && ${scriptPath}`;
  assert.equal(isAgentBashCommandBlocked(runScript, ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked(`bash ${scriptPath}`, ctx).blocked, true);
  assert.equal(isAgentBashCommandBlocked("awk 'BEGIN {for (k in ENVIRON) print k}'").blocked, true);
  assert.equal(isAgentFilePathBlocked('print_env.sh', ctx, 'write').blocked, true);
  assert.equal(isAgentFilePathBlocked('print_env.sh', ctx, 'read').blocked, true);
  assert.equal(
    evaluateAgentToolUse('Write', { file_path: 'dump.sh', content: '#!/bin/sh\nenv' }, ctx).allowed,
    false,
  );
  assert.equal(evaluateAgentToolUse('Bash', { command: runScript }, ctx).allowed, false);
});

test('bash blocks absolute paths outside workspace but allows workspace scene paths', () => {
  const scenePath = resolve(agentCwd, AGENT_SCENE_FILENAME);
  assert.equal(
    isAgentBashCommandBlocked(`file_path=$(ls ${scenePath})`, ctx).blocked,
    false,
  );
  assert.equal(
    isAgentBashCommandBlocked(`cat ${serviceRoot}/package.json`, ctx).blocked,
    true,
  );
  assert.equal(isAgentBashCommandBlocked('cd ..', ctx).blocked, true);
});

test('bash blocks every other way out of the workspace', () => {
  const blocked = (command: string) => isAgentBashCommandBlocked(command, ctx).blocked;
  for (const command of [
    'cat ../../secrets.txt',
    'cp scene.json notes/../../../out.json',
    'cat "$AINOBI_WORK_DIR/../other/file"',
    'cat ~/.ssh/id_rsa',
    'ls ~',
    'cat $HOME/.aws/config',
    'cat "${USERPROFILE}/Documents/a.txt"',
    'type %APPDATA%\\a.txt',
    'cat </etc/passwd',
    'pushd notes',
  ]) {
    assert.equal(blocked(command), true, command);
  }
  for (const command of ['cat notes/../scene.json', 'ainobi text set --text "wait... then go"', 'ls notes/a..b']) {
    assert.equal(blocked(command), false, command);
  }
});

test('bash blocks Windows drive and share paths outside the workspace', { skip: process.platform !== 'win32' }, () => {
  const blocked = (command: string) => isAgentBashCommandBlocked(command, ctx).blocked;
  assert.equal(blocked('cat C:\\Users\\someone\\.ssh\\id_rsa'), true);
  assert.equal(blocked('cat C:/Users/someone/.ssh/id_rsa'), true);
  assert.equal(blocked('cat D:/data.txt'), true);
  assert.equal(blocked('cat \\\\server\\share\\file.txt'), true);
  assert.equal(blocked('cat //server/share/file.txt'), true);
  assert.equal(blocked(`cat ${resolve(agentCwd, 'notes.md')}`), false);
});

test('bash blocks nested shells and Windows system commands', () => {
  const blocked = (command: string) => isAgentBashCommandBlocked(command, ctx).blocked;
  for (const command of [
    "bash -c 'rm -rf notes'",
    'sh -lc "cat scene.json"',
    'echo "rm -rf notes" | sh',
    'eval "$cmd"',
    'powershell -Command "Remove-Item notes"',
    'pwsh -c ls',
    'cmd /c del notes.md',
    'cmd.exe /c dir',
    'wsl ls',
    'del notes.md',
    'reg add HKCU\\Software\\X',
    'ls; taskkill /im node.exe',
    'certutil -urlcache -f http://example.com/a a',
  ]) {
    assert.equal(blocked(command), true, command);
  }
  for (const command of ['ainobi slide list', 'ainobi text set --text "use the cmd key"', 'ainobi export --format png']) {
    assert.equal(blocked(command), false, command);
  }
});

test('a second shell tool and notebook edits outside the workspace are refused', () => {
  assert.equal(evaluateAgentToolUse('PowerShell', { command: 'Get-ChildItem' }, ctx).allowed, false);
  assert.equal(evaluateAgentToolUse('NotebookEdit', { notebook_path: '/etc/a.ipynb', new_source: '' }, ctx).allowed, false);
});

test('grep and glob require scoped paths', () => {
  assert.equal(evaluateAgentToolUse('Grep', { pattern: 'slide', path: '.' }, ctx).allowed, false);
  assert.equal(
    evaluateAgentToolUse('Grep', { pattern: 'slide', path: AGENT_CLAUDE_SKILL_DIR }, ctx).allowed,
    true,
  );
  assert.equal(evaluateAgentToolUse('Glob', { pattern: '**/*' }, ctx).allowed, false);
  assert.equal(
    evaluateAgentToolUse('Glob', { pattern: '*.md', path: `${AGENT_CLAUDE_SKILL_DIR}/references` }, ctx)
      .allowed,
    true,
  );
});

test('isPathWithinAgentWorkspace blocks parent project paths', () => {
  assert.equal(
    isPathWithinAgentWorkspace(`${AGENT_CLAUDE_SKILL_DIR}/references/workflows.md`, agentCwd),
    true,
  );
  assert.equal(isPathWithinAgentWorkspace('../.env', agentCwd), false);
});

test('skill bootstrap: blocks ainobi and non-skill reads until SKILL.md is read', () => {
  assert.equal(isAgentBashCommandBlocked('ainobi status', bootstrapCtx).blocked, true);
  assert.equal(
    isAgentFilePathBlocked(AGENT_SKILL_MD_REL, bootstrapCtx, 'read').blocked,
    false,
  );
  assert.equal(
    isAgentFilePathBlocked(`${AGENT_CLAUDE_SKILL_DIR}/references/workflows.md`, bootstrapCtx, 'read')
      .blocked,
    false,
  );
  assert.equal(isAgentFilePathBlocked(AGENT_SCENE_FILENAME, bootstrapCtx, 'read').blocked, true);
  assert.equal(
    evaluateAgentToolUse('Read', { file_path: AGENT_SCENE_FILENAME }, bootstrapCtx).allowed,
    false,
  );
  assert.equal(
    evaluateAgentToolUse('Grep', { pattern: 'slide', path: AGENT_CLAUDE_SKILL_DIR }, bootstrapCtx).allowed,
    true,
  );
  assert.equal(evaluateAgentToolUse('Grep', { pattern: 'slide', path: '.' }, bootstrapCtx).allowed, false);
});

test('skill bootstrap: after SKILL.md read flag, ainobi and scene reads are allowed', () => {
  assert.equal(isAgentBashCommandBlocked('ainobi status', ctx).blocked, false);
  assert.equal(isAgentFilePathBlocked(AGENT_SCENE_FILENAME, ctx, 'read').blocked, false);
});

test('quiz insert/update/delete/list/validate pass the agent shell policy', () => {
  // The single-element quiz model exposes these subcommands instead of the
  // removed `quiz add-question` / `quiz build-canvas` / `html-form` pairs.
  // Each must run cleanly through the agent's bash policy so the agent can
  // author quiz layouts via JSX.
  const cases: string[] = [
    'ainobi quiz init',
    'ainobi quiz init --enabled --total-score 100 --time-limit-minutes 30',
    'ainobi quiz insert 0 --type single_choice --title "1+1=?"',
    'ainobi quiz insert 1 --type fill_blank --jsx-file work_dir/q1.jsx',
    "ainobi quiz update 0 el_quiz_xxx --jsx '<QuizContainer><QuizTitle>题</QuizTitle><QuizSubmitButton>提交</QuizSubmitButton></QuizContainer>'",
    'ainobi quiz update 0 el_quiz_xxx --set explanation=两者相加',
    'ainobi quiz delete 0 el_quiz_xxx',
    'ainobi quiz list',
    'ainobi quiz validate',
    'ainobi quiz add 0 --type essay', // alias for `insert`
    'ainobi quiz remove 0 el_quiz_xxx', // alias for `delete`
  ];
  for (const command of cases) {
    const result = isAgentBashCommandBlocked(command, ctx);
    assert.equal(
      result.blocked,
      false,
      `expected agent bash policy to allow \`${command}\` but got blocked: ${result.reason ?? ''}`,
    );
    const evaluated = evaluateAgentToolUse('Bash', { command }, ctx);
    assert.equal(evaluated.allowed, true, `evaluateAgentToolUse should allow \`${command}\``);
  }
});

test('removed quiz subcommands and unrelated dangerous shell are still blocked', () => {
  // The refactor removed these subcommands. They have no policy-level allowlist
  // (the agent bash filter blocks dangerous tokens, not unknown subcommands), so
  // they go through as "not blocked" — but ainobi itself will reject them with
  // a USAGE error. This test simply guards that quoted occurrences inside an
  // *allowed* ainobi flag don't trip the policy.
  assert.equal(
    isAgentBashCommandBlocked(
      "ainobi narration insert 1 --transcript '回顾旧的 quiz add-question / quiz build-canvas / html-form 已下线'",
      ctx,
    ).blocked,
    false,
  );

  // Dangerous shell with quiz in the middle still blocked.
  assert.equal(
    isAgentBashCommandBlocked('rm -rf scene.json && ainobi quiz list', ctx).blocked,
    true,
  );
  assert.equal(
    isAgentBashCommandBlocked('ainobi quiz list; cd ..', ctx).blocked,
    true,
  );
});

test('CLI work_dir: Read/Write allowed outside workspace when bound in policy', () => {
  const transcript = `${cliWorkDir}/cover-transcript.txt`;
  assert.equal(isAgentFilePathBlocked(transcript, workDirCtx, 'write').blocked, false);
  assert.equal(isAgentFilePathBlocked(transcript, workDirCtx, 'read').blocked, false);
  assert.equal(
    evaluateAgentToolUse('Write', { file_path: transcript, content: 'hello' }, workDirCtx).allowed,
    true,
  );
  assert.equal(isAgentFilePathBlocked(transcript, ctx, 'write').blocked, true);
});

test('bash: work_dir substitution suffix /reference.png is not false-blocked', () => {
  const cmd =
    'ainobi doc read "$(ainobi scene info --verbose | jq -r \'.data.work_dir\')/reference.png"';
  assert.equal(isAgentBashCommandBlocked(cmd, workDirCtx).blocked, false);
});

test('bash: explicit paths under cli work_dir are allowed', () => {
  const cmd = `ainobi doc read ${cliWorkDir}/reference.png`;
  assert.equal(isAgentBashCommandBlocked(cmd, workDirCtx).blocked, false);
});

test('bash: paths outside workspace and work_dir stay blocked', () => {
  const cmd = 'ainobi doc read /Users/other/reference.png';
  assert.equal(isAgentBashCommandBlocked(cmd, workDirCtx).blocked, true);
});

test('plan mode: allows research ainobi commands and blocks mutations', () => {
  assert.equal(isPlanModeResearchBashCommand('ainobi doc read ./report.pdf').allowed, true);
  assert.equal(isPlanModeResearchBashCommand('ainobi search 上证指数 大跌 --answer').allowed, true);
  assert.equal(
    isPlanModeResearchBashCommand('ainobi asset get deadbeefdeadbeefdeadbeefdeadbeef').allowed,
    true,
  );
  assert.equal(isPlanModeResearchBashCommand('ainobi knowledge list').allowed, true);
  assert.equal(
    isPlanModeResearchBashCommand(
      'ainobi knowledge read --file-id 8a1b2c3d-4e5f-6789-abcd-ef0123456789 --offset 0',
    ).allowed,
    true,
  );
  assert.equal(isPlanModeResearchBashCommand('ainobi help doc').allowed, true);
  assert.equal(isPlanModeResearchBashCommand('ainobi recall abc').allowed, true);
  assert.equal(
    isPlanModeResearchBashCommand('ainobi doc read ./a.pdf 2>&1 | head -80').allowed,
    true,
  );

  assert.equal(isPlanModeResearchBashCommand('ainobi narration insert 0 --teacher-id x').allowed, false);
  assert.equal(isPlanModeResearchBashCommand('ainobi image generate --prompt hi').allowed, false);
  assert.equal(isPlanModeResearchBashCommand('ainobi save').allowed, false);
  assert.equal(isPlanModeResearchBashCommand('ainobi slide list').allowed, false);
  assert.equal(isPlanModeResearchBashCommand('ls -la').allowed, false);
  assert.equal(
    isPlanModeResearchBashCommand('ainobi doc read a.pdf && ainobi save').allowed,
    false,
  );

  assert.equal(
    evaluatePlanModeToolUse('Bash', { command: 'ainobi search 行情' }, ctx).allowed,
    true,
  );
  assert.equal(
    evaluatePlanModeToolUse('Bash', { command: 'ainobi narration insert 0' }, ctx).allowed,
    false,
  );
  assert.equal(
    evaluatePlanModeToolUse('Write', { file_path: `${agentCwd}/x.md`, content: 'x' }, ctx).allowed,
    false,
  );
  assert.equal(
    evaluatePlanModeToolUse('Read', { file_path: `${agentCwd}/out.md` }, ctx).allowed,
    true,
  );
});

test('helper files addressed via $AINOBI_WORK_DIR pass the shell policy', () => {
  for (const command of [
    'ainobi batch apply --file "$AINOBI_WORK_DIR/batch/plan.json"',
    'ainobi quiz update 0 el_quiz_x --jsx-file "${AINOBI_WORK_DIR}/q1.jsx"',
    "ainobi slide get 2 --with-children --select 'slide.children_elements[]{element_id,name}'",
  ]) {
    assert.equal(isAgentBashCommandBlocked(command, preloadedCtx).blocked, false, command);
  }
  const outside = isAgentBashCommandBlocked('cat /etc/passwd', preloadedCtx);
  assert.equal(outside.blocked, true);
  assert.match(outside.reason ?? '', /\$AINOBI_WORK_DIR/);
});
