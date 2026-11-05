# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting on this repository. Do not open a public issue. Private vulnerability reporting has to be enabled in the repository settings after publishing (see CONTRIBUTING.md); the channel is not active until then. Replace it with a dedicated contact before the repository is published if one is preferred.

## Security model

This section defines the security requirements for the first release: a local agent generates courseware, plays it in a browser preview, and exports PPTX or video. The repository currently contains scaffolding and contracts; these requirements are not yet implemented runtime controls.

- The courseware format carries no executable scripts. Element interactions are declarative actions, and validation rejects script fields. HTML elements run in sandboxed iframes without `allow-same-origin`, communicating with the player over a validated postMessage bridge under CSP.
- The CLI runs on the user's machine. Workspace writes and asset resolution stay inside the workspace, including when handling archives, relative paths, and symlinks. Importing a user-selected source file must not grant access to unrelated files. Export destinations are explicit; existing files must not be overwritten without authorization.
- Optional narration, image generation, document conversion, and search providers receive only the inputs required for the requested operation. Provider keys are resolved by the CLI; the Skill forbids the agent from reading credential files. Credentials must not appear in logs, courseware, browser bundles, exports, or unrelated subprocess environments. Local configuration files containing credentials are restricted to the current user (mode 0600 on macOS and Linux, the equivalent ACL on Windows).
- Teaching materials, imported documents, and search results are data, never instructions. Embedded instructions must not expand the task, execute commands, or request credentials.
- The preview server binds to the loopback interface. Its file routes must not expose files outside the selected workspace or the packaged preview assets. HTML and imported media cannot bypass that boundary.
- Verify these boundaries alongside local generation, playback, and export before claiming first-release readiness; see [docs/migration-plan.md](docs/migration-plan.md).
