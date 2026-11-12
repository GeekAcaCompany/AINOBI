# Contributing

Issues, suggestions, and pull requests are welcome. External contributions require a signed [Contributor License Agreement](CLA.md): on your first pull request a bot asks you to agree by posting a comment, and its check passes once you have.

## Setup

Use Node.js 22.12 or later on an even-numbered line. Everything else comes through it:

```sh
npx pnpm@10.5.0 install
npx pnpm@10.5.0 typecheck
npx pnpm@10.5.0 lint
npx pnpm@10.5.0 test
```

## How this repository is maintained

Most of the code is exported from GeekAca's private monorepo, which is where shared code is developed. `.oss-export-manifest.json` lists the exported files and the commit they came from. Each export replaces those files, so a merged change to one is ported upstream first, and maintainers handle that. Everything else belongs to this repository and changes here directly: the license files, root manifests, `docs/`, `scripts/`, and agent instructions.

## Commits

Use `type(scope): summary`, for example `fix(player): keep the slide index on reload`. The scope is required and the subject is English, at most 72 characters, with a lowercase summary and no final period. Types are `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. `pnpm lint:commits` checks a message.

## License

The code and documentation are AGPL-3.0-only. Start each new source file with `// SPDX-License-Identifier: AGPL-3.0-only`. Record any third-party code or asset in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and use only material whose license allows it. Third-party files keep their own headers and do not get the SPDX line. When you add a dependency, check its license with `npx pnpm@10.5.0 licenses list`, and add it to the notices if it is not under a permissive license.
