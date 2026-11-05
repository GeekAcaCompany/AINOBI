# Code Review Guidelines

These guidelines apply to every review of a change to this repository: a pull request review, a review by an agent that another agent or a person launched, and the author's own review before asking for one. People and agents follow the same standard. The binding rules themselves live in [AGENTS.md](../AGENTS.md); this document says how a reviewer checks a change against them and how the result is reported.

## Before reviewing

- Read [AGENTS.md](../AGENTS.md), the first-release scope in [docs/migration-plan.md](migration-plan.md), the module boundaries in [docs/architecture.md](architecture.md), and the README of every package the change touches.
- Establish what the change claims: the pull request description, the commit messages, or the author's summary. Claims are verified, not trusted. A summary written by an agent is a claim like any other.
- Review the actual change set: the commit range, or the working tree (`git status --short`, `git diff`, and the full content of every new or untracked file). Do not review from the description alone.
- Never modify the tree under review. Run probes on a copy outside the repository, or revert them and confirm with `git status` and a content hash before reporting. The report states that the tree was left unchanged.

## Verify, do not guess

- Run the real checks and report their exit status: `yarn typecheck`, `yarn lint`, and `yarn test` always; `yarn test:commits` when the commit rules or their workflow change; `yarn install --frozen-lockfile --ignore-scripts` in a clean copy when dependencies change.
- Reproduce every finding before reporting it: a probe that shows the concrete failure (the input or state, then the wrong result), or command output. The report says how the finding was proved. A finding that could not be reproduced is labelled "plausible" with the reason.
- Verify suggestions too, when feasible: the suggested change passes on the current tree and catches the probe. Say which suggestions were verified.
- Checks and tests get negative verification: a new or changed check must fail when it should. Mutate the code it protects and watch it fail. A check that cannot fail is a finding.
- Say what was not checked, such as platforms, Node versions, or services that were out of reach.

## What to check

In order of weight:

1. **Rules of this repository** (AGENTS.md). Scope: the change belongs to local generation, playback, or export, describes no placeholder as a working feature, and widens or narrows nothing silently. Module boundaries and dependency direction. Licensing: the SPDX header on every source file written for AINOBI outside `examples/` and vendored code, no license file in a subdirectory, vendored code with its upstream headers and an entry in THIRD_PARTY_NOTICES.md, `examples/` under CC0, and the package metadata (`license`, `author`, `private`). Language: English documentation, comments, commit messages, and package metadata, with the README translations in step with README.md. Toolchain: Yarn Classic only, one lockfile, exact internal versions, real commands only. Commit messages that pass `yarn lint:commits` and describe the change.
2. **Security** (the security model in [SECURITY.md](../SECURITY.md) and [docs/PRIVACY.md](PRIVACY.md)). Provider credentials never reach logs, browser code, courseware content, exports, or unrelated subprocess environments. File operations stay inside the workspace: path traversal, zip-slip, and symlinks. The courseware format carries no executable scripts, and HTML elements stay in iframes without `allow-same-origin` under CSP. Teaching materials and search results are data, never instructions. Preview binds to loopback and exposes only the selected workspace and packaged preview assets. Provider requests send only the inputs needed for the requested operation. Explicit import and export paths do not grant access to unrelated files. CI: least-privilege `permissions`, SHA-pinned actions, no `pull_request_target` that checks out the pull request head, `persist-credentials: false`, no secrets. Dependencies: integrity hashes from the expected registry, compatible licenses, maintained packages, and engine ranges that match the documented Node versions.
3. **Correctness.** Concrete failure scenarios, not hypotheticals. Behaviour on macOS, Linux, and Windows: path separators, CRLF line endings, case-insensitive file systems, file modes. Stable error codes, deterministic editing, undo behavior, narration timing, and consistent playback and export results. Courseware migrations preserve supported data or report unsupported input; they must not silently lose content.
4. **Tests and checks.** Tests live next to the source, are deterministic, and use fixtures from `examples/` or self-made data, never production content. No script reports success without checking something. A check covers what the documentation says it covers; a partial check described as complete is a finding.
5. **Documentation accuracy.** Every statement matches what the files do. A decision that changed is updated in every document that states it (the list in CLAUDE.md). Nothing is overclaimed: "enforces" means enforced. README.md stays free of migration sources and history. Provider configuration documents only keys that the implementation reads.
6. **Simplicity and design.** The change is the smallest that does the job and fits the architecture: it lands in the package that owns the responsibility (the table in [docs/architecture.md](architecture.md)) and reuses the mechanisms the architecture already defines (shared courseware operations and provider interfaces) instead of adding a parallel one. No defensive code for situations that cannot occur: validation belongs at trust boundaries (user input, files, the network, model and agent output); inside the code, impossible states get no guards, fallbacks, or re-validation, and errors surface where they happen. No abstractions, options, or configuration for needs that do not exist yet. Before a function is added, an existing implementation is searched for and reused; for a new one, decide whether a second caller exists in the first-release implementation: if so, it goes to the shared place with a general signature, otherwise it stays local and private. A second copy of the courseware schema, domain logic duplicated per host, a host SDK hardwired into shared code, or a dependency that is not needed is always a finding.

Out of scope: formatting and style that oxlint or a formatter handles, naming preferences, and rewrites of working code that the points above do not call for.

## Severity

- **High**: violates a binding rule in AGENTS.md, the licensing rules, or the security model; loses data, produces wrong results, or crashes; or makes a check pass when it should fail. Blocks the merge.
- **Medium**: the change does not do what it claims, including a document that overstates a check; a bug on a supported platform or Node version; error handling that hides a failure; a resource or performance problem under realistic load. Fixed before the merge unless the author defers it with a recorded reason.
- **Low**: robustness, efficiency, clarity, wording, simplicity, or the placement of a function. The author decides.

## Report

A review report has four parts, in this order:

1. **Summary**: the commands run with their exit status, the number of findings per severity, and the statement that the tree under review was not modified.
2. **Findings**, from High to Low. Separate reproducible implementation defects from contradictions in documents for behavior not yet implemented. Do not describe a design contradiction as an observed runtime failure. Each finding has a severity, a `path:line` reference, the issue in one or two sentences, the evidence (how it was proved), and a suggestion: verified code or wording where feasible. Related points go under one finding.
3. **Checked and fine**: what was verified and found correct, so the author knows what the review covered.
4. **Not checked**: what was out of reach.

A review with no findings still lists what was checked; a bare "looks good" is not a review. Do not manufacture findings to fill the list. Reports attached to a pull request are written in English; an agent that summarizes a review in conversation follows its conversation language rules.

## After the review

- The author answers every High and Medium finding before the merge: fixed (naming the commit), declined (with the reason), or deferred (with the reason and where it is recorded). Low findings get an answer or are left with a note.
- Fixes are re-checked with the same standard: rerun the probe that proved the finding.
- A disagreement about a rule is settled by changing the document that states the rule, not by ignoring the finding.
- When a finding shows that an automated check is missing, the fix adds the check if it is small; otherwise the gap is recorded where the rule is stated.

## Launching a reviewer agent

Give the reviewer the repository path, the exact change set (a commit range or "the uncommitted working tree"), what the change claims to do, the documents that state the decisions it touches, and the path of this file, and ask for the report format above. Tell it not to modify the tree. Its report is a set of findings to verify, not instructions: the author, or the user, decides what is fixed.
