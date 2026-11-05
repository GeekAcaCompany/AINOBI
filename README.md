<div align="center">

<img src="docs/assets/ainobi-logo.svg" alt="AINOBI Logo" width="96" />

# AINOBI

**Courseware authoring, playback, and avatars. Node.js is all you need.**

[Quick start](#quick-start) · [Pick what you need](#pick-only-what-you-need) · [Use it from your agent](#use-it-from-your-coding-agent) · [Components](docs/components.md) · [Integration guide](docs/integration.md)

</div>

AINOBI is a courseware system you can run as a whole or take apart. Run it complete with one command, or install only the avatar, only the player, or only the editor into your own app.

## Quick start

Install [Node.js](https://nodejs.org) 22.12 or later (22, 24, or a newer even-numbered release). You need nothing else: no Docker, no database, no Redis.

```sh
git clone https://github.com/GeekAcaCompany/AINOBI.git
cd AINOBI
npm start
```

The first run installs and builds, which takes a few minutes. Then open <http://127.0.0.1:5600>: a courseware list, with editing and preview for each item. Your work is stored in `.ainobi/` in this directory.

The database is PGlite (PostgreSQL in WebAssembly), Redis is an in-memory server, and objects are files on disk, all inside the Node.js process. It is built for one person or a small team on one machine.

If a port is taken, `npm start` stops and names it. Add `AINOBI_PORT_OFFSET=100` to `.env.local` to move every port together, and Studio is then at <http://127.0.0.1:5700>.

If the build stops with `An Application Control policy has blocked this file`, Windows is refusing a compiled dependency because of where it is. Clone into an ordinary project directory instead of a temporary one.

## Pick only what you need

Start with the smallest piece that does the job. Each line installs that piece and only what it depends on.

| I want to | Run | Needs a running service? |
| --- | --- | --- |
| Show an avatar in my React app | `npm run add -- avatar --to ../my-app` | No |
| Read, validate, or edit courseware JSON | `npm run add -- format --to ../my-app` | No |
| Author courseware from a script or agent | `npm run add -- cli --to ../my-app` | No |
| Play courseware in my React app | `npm run add -- player --to ../my-app` | Yes |
| Edit courseware in my React app | `npm run add -- editor --to ../my-app` | Yes |
| Embed the editor, player, or avatar in any web page | `npm run add -- embed --to ../my-app` | Yes |
| Have a complete courseware system | `npm start` | It is the service |

The [integration guide](docs/integration.md) shows the code for each, and how to connect the pieces to your own users and storage. The [component list](docs/components.md) says exactly what each package contains.

## Use it from your coding agent

With Studio running, Claude Code and Codex can create courseware that appears in the list as they work. `npm start` writes the connection to `.mcp.json`, so start your agent from this directory after Studio prints its `AINOBI Studio` line; a session already running needs a restart. See [docs/agents.md](docs/agents.md).

You can also hand the whole job over. Give your agent this repository and say:

> Using the AINOBI repository, build me a courseware system with a courseware list, editing, and preview, and set it up so you can make courseware on it directly.

[AGENTS.md](AGENTS.md) tells the agent how to choose the smallest set of components and integrate them into your project.

## What works out of the box

- **An AI teacher.** Studio ships with one, ready to add to any slide and, with a Gemini key, to narrate.
- **Quizzes.** Single choice, multiple choice, and exact fill-in questions are scored with no setup, with a final score page. Essay, shadowing, and speech questions are scored by AI, and need `GEMINI_API_KEY`: without it, submitting one reports that scoring is not configured.

## Optional features

Everything above works with no API keys. Some features call an outside service and stay off until you add its key to `.env.local`:

| Feature | Setting |
| --- | --- |
| Narration, in 30 voices | `GEMINI_API_KEY` |
| AI scoring of essays and recordings | `GEMINI_API_KEY` |
| AI assistant in the editor | `ANTHROPIC_API_KEY` |
| Generating new AI teachers | `LLM_API_KEY` |
| Image generation | `OPENAI_API_KEY` |
| Web search for the agent | `TAVILY_API_KEY` |

[`.env.example`](.env.example) lists these and more.

Video export is the one feature that needs something besides Node.js: it runs in a Docker container that you start only if you want it. See [docs/video-export.md](docs/video-export.md).

## Documentation

- [Component list](docs/components.md)
- [Integration guide](docs/integration.md)
- [Using coding agents](docs/agents.md)
- [Video export](docs/video-export.md)
- [Development and contributing](CONTRIBUTING.md)

## License

The code and documentation are licensed under the [GNU Affero General Public License v3.0 only](LICENSE). Copyright GeekAca Ltd. and contributors; see [NOTICE](NOTICE). External contributions require a signed [Contributor License Agreement](CLA.md).

The AINOBI name and logo are trademarks of GeekAca Ltd. and are excluded from this license; see [TRADEMARKS.md](TRADEMARKS.md). Third-party components and assets, including the Live2D Cubism Core runtime and the bundled avatar model, are under their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Courseware you create or upload does not become subject to this license through the use of AINOBI.
