# Local content and provider privacy

This describes where content goes when you run AINOBI with `npm start`. AINOBI has no account, sends no telemetry, and contacts no GeekAca service.

## What stays on your machine

- Courseware, uploaded files, generated narration and images, AI teachers, and quiz answers and scores are stored in `.ainobi/` in the repository directory: a PGlite database and files on disk. `AINOBI_STORAGE_DIR` moves the stored files.
- Playback, editing, and the scoring of single choice, multiple choice, and exact fill-in questions run locally.
- You control retention: deleting courseware in Studio removes its slides, narration, and uploaded files, and deleting `.ainobi/` removes everything.
- The optional video renderer and document converters run in containers on your machine and read the courseware or the file you give them from there.

## What is sent to a provider

A provider receives content only when you configure its key and use the feature. Each receives what the operation needs:

| Feature | Provider | What is sent |
| --- | --- | --- |
| Narration | Google Gemini (AI Studio or Vertex AI); Fish Audio or MiniMax if you use their voices | The narration text and the voice and style settings |
| AI scoring of essay, shadowing, and speech questions | Google Gemini (AI Studio or Vertex AI) | The question and the learner's answer, including the audio recording for spoken answers |
| The editor's AI assistant | The Anthropic compatible API you configure | Your messages and the courseware content the assistant works on |
| Generating AI teachers and images | The OpenAI compatible API you configure | The description you write and the images being checked or edited |
| Web search for agents that cannot search | Tavily | The search query |

Each provider handles that content under its own terms, and its retention and deletion policies are separate from your local files. Review them before sending private material, and tell learners when their recorded answers are scored by a provider.

## Coding agents

A coding agent you connect, such as Claude Code or Codex, reads and writes your courseware through the local service and sends what it reads to its own model provider, under that agent's settings and terms. AINOBI does not change those settings.

## If you run AINOBI for other people

This document covers a single local user. If you serve AINOBI to others, you decide what is collected and kept, and you are responsible for your own privacy notice.
