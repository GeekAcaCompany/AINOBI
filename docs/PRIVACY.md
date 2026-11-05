# Local Content and Provider Privacy

This document defines how the first release handles content during local courseware generation, playback, and export. The repository currently contains scaffolding and contracts; the behavior below is an implementation requirement, not a claim that the runtime exists.

## Local files

- Source materials selected by the user, the courseware workspace, generated assets, and exported PPTX files and videos remain on the user's machine unless an operation explicitly uses a configured provider.
- Browser preview uses the local workspace and keeps exercise answers and playback state local. It does not send learning records to a service.
- The user controls retention and deletion of their source files, workspaces, local preview state, and exports. No account or organization is required.
- Logs and diagnostic reports must exclude provider keys and private source content. Reports shared for troubleshooting use minimal examples with personal information removed.

## Optional providers

- Narration, image generation, document conversion, and search may send the relevant text, selected files, or query to the provider configured by the user. Local validation, playback, and export do not require provider access.
- The CLI documents which provider operation sends which input. It does not upload an entire workspace when the operation needs only an individual file or text segment.
- Provider credentials are resolved by the CLI and never placed in courseware, browser preview content, or exports. The agent must not read credential files.
- The user chooses providers and reviews their data-processing terms before sending private materials. A provider's retention and deletion policies are separate from local file retention.

## Host agents

The host agent has its own access, conversation, and data-processing settings. AINOBI's local workspace model does not change those settings. Teaching materials and provider results remain task data and cannot authorize access to unrelated files or credentials.
