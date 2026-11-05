# Using coding agents

A coding agent can author courseware directly on a running Studio: what it makes appears in the courseware list, ready to edit and preview. It connects over MCP, and needs no API keys of AINOBI's own.

## Claude Code

```sh
npm start        # in one terminal; writes .mcp.json
claude           # in another, from this directory
```

Wait for the `AINOBI Studio` line before starting Claude Code. It reads `.mcp.json` when it starts and asks you to approve the `ainobi` server; a session already running needs a restart to see it. The skill in `.claude/skills/ainobi-courseware` teaches it how to author. Then ask:

> Make a five-slide lesson on photosynthesis for beginners, with a short quiz at the end.

## Codex

Start Studio, then add the server to `~/.codex/config.toml`, using the token from `.ainobi/secrets.json`. The address is the `Agent (MCP)` line Studio prints; it differs from the one below if you moved the ports.

```toml
[mcp_servers.ainobi]
url = "http://127.0.0.1:5633/mcp"
bearer_token_env_var = "AINOBI_LOCAL_TOKEN"
```

```sh
AINOBI_LOCAL_TOKEN=<token> codex
```

Codex reads the same skill from `.agents/skills/ainobi-courseware`.

## If a port is taken

`npm start` stops and names the port. Add this to `.env.local` and start again; it moves every port together, and `.mcp.json` is rewritten to match:

```sh
AINOBI_PORT_OFFSET=100
```

Studio is then at <http://127.0.0.1:5700> and MCP at <http://127.0.0.1:5733/mcp>. Restart your agent so it reads the new address.

## What the agent can do

| Tool | Purpose |
| --- | --- |
| `courseware_list`, `courseware_create`, `courseware_open`, `courseware_rename` | Find, create, and open courseware |
| `ainobi_exec` | Edit slides, elements, quizzes, and timing through the `ainobi` command |
| `courseware_workspace_write` | Prepare the batch plans and quiz layouts `ainobi_exec` reads |
| `courseware_save` | Save, which creates a new version. It refuses to overwrite changes made after the agent opened the courseware |
| `courseware_ui_links` | Get links to open the editor and preview |
| `courseware_asset_upload`, `courseware_asset_list`, `courseware_doc_read` | Work with images and documents |
| `courseware_ai_teachers` | List AI teachers |
| `courseware_narration`, `courseware_tts_list` | Narration, once `GEMINI_API_KEY` is set |
| `courseware_image_generate`, `courseware_search` | Images and web search, once their providers are set |

The tools for courses and teaching sections (`course_*`, `courseware_bind_section`) belong to the full platform; Studio has no courses, so they return nothing useful.

## Working alongside an agent

You can edit in the browser while an agent works on the same courseware. If you save first, the agent's next save is refused rather than overwriting you, and it reloads your version and reapplies its edits. An agent save does not redraw the courseware's cover image; the editor does that the next time you save there.

## Without a server

For courseware as local files, with no Studio running, use the `ainobi` command itself. See the [CLI README](../packages/courseware-cli/README.md).

## Security

The token in `.mcp.json` and `.ainobi/secrets.json` gives full access to your local courseware. Both files are ignored by git; keep them out of anything you share. Teaching materials and web results an agent reads are data, not instructions.
