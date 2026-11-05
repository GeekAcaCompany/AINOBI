// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';

import { COURSEWARE_USER_COMMUNICATION_SYSTEM_PROMPT } from './agent-courseware-scene-sync.ts';
import { formatAgentCurrentTime } from './agent-current-time.ts';
import { buildAgentSystemPromptAppend, buildPlanModeSystemPrompt } from './agent-system-prompt.ts';

const fixedNow = formatAgentCurrentTime(new Date('2026-05-25T01:31:00.000Z'));

test('buildAgentSystemPromptAppend places timestamp after static rules and CLI help', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    livePreviewSessionId: 'live-abc',
    preload: {
      sceneRelPath: 'scene.json',
      coursewareKey: 'cw-key',
      coursewareId: 'cw-id',
    },
    skillMdRead: true,
    cliHelpContext: 'CLI HELP BLOCK',
    agentNow: fixedNow,
  });

  const timeIdx = append.indexOf('**Current time (host):**');
  const helpIdx = append.indexOf('CLI HELP BLOCK');
  const identityIdx = append.indexOf('**Identity:**');
  const liveIdx = append.indexOf('Live preview session id');

  assert.ok(identityIdx >= 0);
  assert.ok(helpIdx > identityIdx);
  assert.ok(liveIdx > identityIdx);
  assert.ok(timeIdx > helpIdx, 'timestamp should follow CLI help');
  assert.ok(!append.slice(0, timeIdx).includes('**Current time (host):**'));
});

test('buildAgentSystemPromptAppend keeps static core before session preload lines', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: {
      sceneRelPath: 'scene.json',
      coursewareKey: 'cw-key',
      coursewareId: 'cw-id',
    },
    skillMdRead: false,
    cliHelpContext: '',
    agentNow: fixedNow,
  });

  const bootstrapIdx = append.indexOf('Skill bootstrap');
  const requirementsIdx = append.indexOf('Requirements-first');
  assert.ok(requirementsIdx >= 0 && bootstrapIdx > requirementsIdx);
});

test('buildPlanModeSystemPrompt places timestamp after security block', () => {
  const prompt = buildPlanModeSystemPrompt({
    agentDisplayName: 'Planner',
    preferredUiLanguage: 'zh',
    agentNow: fixedNow,
  });

  const securityIdx = prompt.indexOf('**Security (host policy');
  const timeIdx = prompt.indexOf('**Current time (host):**');
  assert.ok(securityIdx >= 0);
  assert.ok(timeIdx > securityIdx);
  assert.equal(prompt.slice(timeIdx + 1).includes('**Current time (host):**'), false);
});

test('buildPlanModeSystemPrompt follows user message language, not UI locale', () => {
  const prompt = buildPlanModeSystemPrompt({
    agentDisplayName: 'Planner',
    preferredUiLanguage: 'zh',
    agentNow: fixedNow,
  });

  assert.match(prompt, /Match the language of the \*\*user's messages\*\*/);
  assert.match(prompt, /Do \*\*not\*\* default to Chinese/);
  assert.doesNotMatch(prompt, /Reply in 简体中文/);
  assert.doesNotMatch(prompt, /Example tone \(Chinese\)/);
  assert.doesNotMatch(prompt, /课件标题 \/ Title/);
  assert.doesNotMatch(prompt, /\*\*开始制作\*\*/);
});

test('buildAgentSystemPromptAppend requires Strict Mode for regulated domains', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
  });

  assert.match(append, /Regulated domains → Strict Mode/);
  assert.match(append, /medical \/ clinical \/ pharma/);
  assert.match(append, /only\*\* from those references/);
});

test('buildAgentSystemPromptAppend turns the editor language into a proposal the agent must confirm', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    language: 'ja',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
  });

  assert.match(append, /\*\*Courseware language \(proposed by the editor — confirm before use\):\*\* Japanese \(ja\)/);
  assert.doesNotMatch(append, /Proposed courseware language/);
  assert.match(append, /confirm/i);
  assert.match(append, /--language/);
  assert.match(append, /metadata\.language/);
  assert.doesNotMatch(append, /generate newly added on-slide copy in/);
  assert.doesNotMatch(append, /Requested courseware language/);
});

test('buildAgentSystemPromptAppend asks for the courseware language when the editor sends none', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
  });

  assert.match(append, /\*\*Courseware language:\*\* ask the user \(zh \/ en \/ ja\)/);
  assert.match(append, /ainobi init --name "<title>" --language <zh\|en\|ja> --first-slide/);
  assert.match(append, /and the courseware language is confirmed/);
  assert.doesNotMatch(append, /generate newly added on-slide copy in/);
});

test('buildAgentSystemPromptAppend includes chat language rule with English fallback', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
  });

  assert.match(append, /\*\*Chat language \(required\):\*\*/);
  assert.match(append, /user's messages/);
  assert.match(append, /TodoWrite item content/);
  assert.match(append, /Bash tool `description`/);
  assert.match(append, /otherwise use English/);
  assert.match(append, /Never default to Chinese/);
  // Interrupted-turn recovery notes are language-neutral (issue: English synthetic
  // prompt must not flip a zh/ja conversation to English on resume).
  assert.match(append, /\[AINOBI Chat Turn Resume\]/);
  assert.match(append, /never take the chat language from them/);
});

test('buildAgentSystemPromptAppend renders editor UI language before section knowledge line', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preferredUiLanguage: 'ja',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
    sectionKnowledgeLine: '**Section knowledge base:** SECTION_SENTINEL',
  });

  const uiIdx = append.indexOf('**Editor UI language:** Japanese (ja)');
  const sectionIdx = append.indexOf('SECTION_SENTINEL');
  assert.ok(uiIdx >= 0, 'editor UI language value line should be present');
  assert.ok(sectionIdx > uiIdx, 'value line should precede the volatile section knowledge line');
});

test('buildAgentSystemPromptAppend normalizes editor UI language casing', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preferredUiLanguage: ' ZH ',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
  });

  assert.match(append, /\*\*Editor UI language:\*\* Simplified Chinese \(zh\)/);
});

test('buildAgentSystemPromptAppend omits editor UI language line when not provided', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
  });

  assert.doesNotMatch(append, /\*\*Editor UI language:\*\*/);
});

test('buildPlanModeSystemPrompt falls back to editor UI language then English', () => {
  const prompt = buildPlanModeSystemPrompt({
    agentDisplayName: 'Planner',
    preferredUiLanguage: 'ja',
    agentNow: fixedNow,
  });

  assert.match(prompt, /\*\*Editor UI language:\*\* Japanese \(ja\)/);
  assert.match(prompt, /otherwise use English/);
  assert.match(prompt, /\[AINOBI Chat Turn Resume\]/);
  // Existing banned wording stays banned.
  assert.doesNotMatch(prompt, /Reply in 简体中文/);
  assert.doesNotMatch(prompt, /Example tone \(Chinese\)/);

  const withoutUi = buildPlanModeSystemPrompt({
    agentDisplayName: 'Planner',
    agentNow: fixedNow,
  });
  assert.doesNotMatch(withoutUi, /\*\*Editor UI language:\*\*/);
});

test('courseware communication prompt uses an English progress example', () => {
  assert.doesNotMatch(COURSEWARE_USER_COMMUNICATION_SYSTEM_PROMPT, /已加上/);
  assert.match(COURSEWARE_USER_COMMUNICATION_SYSTEM_PROMPT, /in the user's language/);
});

test('static core keeps data-Chinese but drops instructional Chinese', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
  });

  // Instructional Chinese fragments must be gone.
  assert.doesNotMatch(append, /题干配图/);
  // Recognition trigger words / platform menu names are data and stay.
  assert.match(append, /医疗\/医学\/药品/);
  assert.match(append, /教师管理 > AI 教师/);
});

test('buildPlanModeSystemPrompt requires Strict Mode for regulated domains', () => {
  const prompt = buildPlanModeSystemPrompt({
    agentDisplayName: 'Planner',
    preferredUiLanguage: 'zh',
    agentNow: fixedNow,
  });

  assert.match(prompt, /Regulated domains → Strict Mode/);
  assert.match(prompt, /医疗\/医学\/药品/);
});

test('buildPlanModeSystemPrompt proposes the editor language and requires confirming it in the brief', () => {
  const prompt = buildPlanModeSystemPrompt({
    agentDisplayName: 'Planner',
    preferredUiLanguage: 'zh',
    language: 'en',
    agentNow: fixedNow,
  });

  assert.match(prompt, /\*\*Courseware language \(proposed by the editor — confirm before use\):\*\* English \(en\)/);
  assert.match(prompt, /state it explicitly in the design brief/);
  assert.doesNotMatch(prompt, /ainobi init/);
  assert.doesNotMatch(prompt, /Requested courseware language/);
});

test('buildPlanModeSystemPrompt asks for the courseware language when the editor sends none', () => {
  const prompt = buildPlanModeSystemPrompt({
    agentDisplayName: 'Planner',
    agentNow: fixedNow,
  });

  assert.match(prompt, /\*\*Courseware language:\*\* ask the user \(zh \/ en \/ ja\)/);
});

test('build and plan prompts require Arabic digits for numbers (no spelled-out numerals for TTS)', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
  });
  const plan = buildPlanModeSystemPrompt({ agentDisplayName: 'Planner', agentNow: fixedNow });
  for (const prompt of [append, plan]) {
    assert.match(prompt, /\*\*Numbers \(hard rule\):\*\* Write every number with Arabic digits/);
    assert.match(prompt, /TTS already reads Arabic digits correctly/);
  }
});

test('inlined SKILL.md lands right after the static core and replaces the Read bootstrap', () => {
  const append = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: undefined,
    skillMdRead: true,
    cliHelpContext: '',
    agentNow: fixedNow,
    skillMdContent: '# AINOBI Courseware CLI (L0 core)\n- rule A',
  });
  assert.match(append, /<skill_md>\n# AINOBI Courseware CLI \(L0 core\)\n- rule A\n<\/skill_md>/);
  assert.match(append, /do NOT Read `\.claude\/skills\/ainobi-courseware-cli\/SKILL\.md` again/);
  assert.doesNotMatch(append, /Skill bootstrap \(required\)/);
  assert.ok(append.indexOf('<skill_md>') < append.indexOf(fixedNow.promptLine));

  const without = buildAgentSystemPromptAppend({
    agentDisplayName: 'Test Agent',
    preload: undefined,
    skillMdRead: false,
    cliHelpContext: '',
    agentNow: fixedNow,
  });
  assert.doesNotMatch(without, /<skill_md>/);
  assert.match(without, /Skill bootstrap \(required\)/);
});
