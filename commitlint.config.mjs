// SPDX-License-Identifier: AGPL-3.0-only
// Commitlint rules that enforce the AINOBI commit message convention.
const headerPattern = /^[a-z]+\([a-z][a-z0-9-]*\)!?: [a-z][\x20-\x7e]*$/;
const aiAttributionPattern = /^(?:(?:generated|written|authored|created|assisted|co-authored)\s+(?:by|with|using)\s+\[?(?:AI\b|Codex\b|Claude\b|ChatGPT\b|Copilot\b|Gemini\b|Cursor\b|Hermes\b|OpenAI\b|Anthropic\b)|AI[- ](?:generated|assisted)\b)/i;
const pullRequestMergePattern = /^Merge pull request #\d+ from \S+(?:\n|$)/;

export default {
  extends: ['@commitlint/config-conventional'],
  // Revert, version-bump and other merge messages are validated like any other. The one exception is the merge
  // commit GitHub creates for a pull request, because GitHub writes its subject.
  defaultIgnores: false,
  ignores: [(message) => pullRequestMergePattern.test(message)],
  plugins: [{
    rules: {
      'ainobi-header-format': ({ header }) => [
        headerPattern.test(header ?? ''),
        'Use type(scope): summary or type(scope)!: summary; scope must match [a-z][a-z0-9-]* and summary must start with a lowercase English letter and use printable ASCII.',
      ],
      'ainobi-no-attribution': ({ raw }) => {
        const hasAttribution = (raw ?? '').split(/\r?\n/).some((line) => aiAttributionPattern.test(line.replace(/^[^\p{L}\p{N}]+/u, '')));
        return [!hasAttribution, 'Do not include AI attribution signatures. A Co-Authored-By trailer is allowed.'];
      },
    },
  }],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']],
    'scope-empty': [2, 'never'],
    'header-max-length': [2, 'always', 72],
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'ainobi-header-format': [2, 'always'],
    'ainobi-no-attribution': [2, 'always'],
  },
};
