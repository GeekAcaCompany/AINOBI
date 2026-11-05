# AINOBI Courseware — 安装说明 / INSTALL

## 给用户（推荐）

1. 管理后台 → 空间管理 → **Agent**，复制「接入指令」（含一次性接入码链接；凭证由 Agent 经链接直接下载到 `~/.ainobi/ainobi-agent.env`，不经过对话）
2. 把接入指令发给你的 Agent（Claude Code / Codex 均可），或打开 **ChatGPT Desktop → Codex**，把本 zip 发给它，并说：

```text
请运行包内的 install.sh 安装 AINOBI Courseware 插件（可读本 INSTALL.md）。装好后告诉我下一步。
```

3. 按 Codex 提示：重启 / 启用插件 → Developer Mode 接 MCP → **新开对话**

本环境 MCP：

**`{{MCP_URL}}`**

---

## 给 Codex：只做这件事 / Steps for Codex (required)

Do **not** invent an install path. Do **not** use `@plugin-creator` / `create_basic_plugin.py` for this zip.  
Do **not** install only into `~/.codex/plugins/` (that is cache). Do **not** put absolute paths in marketplace.json.

### 1) Locate PLUGIN_ROOT

Unzip if needed. `PLUGIN_ROOT` = directory that contains both `install.sh` and `.codex-plugin/plugin.json` (usually `ainobi-courseware/`).

### 2) Run the installer (preferred)

```bash
chmod +x "$PLUGIN_ROOT/install.sh"
bash "$PLUGIN_ROOT/install.sh"
```

The script:

- Copies the plugin to **`~/plugins/ainobi-courseware`** (overwrites; this is required)
- Upserts **`~/.agents/plugins/marketplace.json`** with:

```json
{
  "source": { "source": "local", "path": "./plugins/ainobi-courseware" }
}
```

  (`path` is relative to **`$HOME`**, matching Codex personal-marketplace rules)
- Runs `codex plugin add <name>@<marketplace>` when `codex` is on PATH

### 3) If `install.sh` cannot run

Replicate the same layout manually (same paths as above), then:

```bash
codex plugin add ainobi-courseware@ainobi-local
# if marketplace "name" differs, use that name from ~/.agents/plugins/marketplace.json
```

### 4) Tell the user (checklist)

1. Restart ChatGPT Desktop (or new Codex CLI session)
2. Plugins → enable **AINOBI Courseware**
3. Developer Mode → MCP URL = **`{{MCP_URL}}`** + Bearer = **`${AINOBI_AGENT_API_KEY}`**（值在启动时从环境变量展开；env 文件由 Agent 经接入链接下载到 `~/.ainobi/ainobi-agent.env`，不要读取明文）
4. **New chat** → 「列出我们组织的课件」

### Hard rules

- Overwrite `~/plugins/ainobi-courseware` when updating — do not stop just because the folder exists
- Keep `"apps": "./.app.json"` in `.codex-plugin/plugin.json` (do not strip it)
- Never point marketplace `path` at `~/.codex/plugins/...`
- Never `codex plugin marketplace add $HOME` as a workaround for absolute paths
- MCP is hosted; do not ask the user to run a local courseware server

---

## 目录

```text
ainobi-courseware/
  install.sh          ← 一键安装（Codex / 用户均可执行）
  INSTALL.md
  README.md
  .app.json
  .codex-plugin/plugin.json
  skills/…
```
