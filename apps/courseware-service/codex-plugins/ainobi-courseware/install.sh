#!/usr/bin/env bash
# Install AINOBI Courseware into Codex personal marketplace (canonical layout).
# Safe to re-run. Overwrites ~/plugins/ainobi-courseware.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${HOME:?HOME is required}"
DEST="$HOME_DIR/plugins/ainobi-courseware"
MARKETPLACE_DIR="$HOME_DIR/.agents/plugins"
MARKETPLACE_JSON="$MARKETPLACE_DIR/marketplace.json"
PLUGIN_NAME="ainobi-courseware"
MARKETPLACE_NAME="ainobi-local"

if [[ ! -f "$PLUGIN_ROOT/.codex-plugin/plugin.json" ]]; then
  echo "error: run this script from the plugin folder (missing .codex-plugin/plugin.json)" >&2
  exit 1
fi

# Refuse to install from an in-place destination (would recurse / confuse overwrite).
if [[ "$PLUGIN_ROOT" -ef "$DEST" ]]; then
  echo "error: source is already $DEST; unzip the download to a temp folder and run install.sh from there." >&2
  exit 1
fi

mkdir -p "$HOME_DIR/plugins" "$MARKETPLACE_DIR" "$DEST"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'agent-workspaces' \
    "$PLUGIN_ROOT"/ "$DEST"/
else
  # Fallback without find(1): wipe known top-level names then copy.
  for name in .app.json .codex-plugin INSTALL.md README.md install.sh skills assets; do
    rm -rf "$DEST/$name"
  done
  cp -R "$PLUGIN_ROOT"/. "$DEST"/
fi

# Personal marketplace paths are relative to $HOME (not ~/.agents/plugins).
python3 - "$MARKETPLACE_JSON" "$MARKETPLACE_NAME" "$PLUGIN_NAME" <<'PY'
import json, sys
from pathlib import Path

path = Path(sys.argv[1])
marketplace_name = sys.argv[2]
plugin_name = sys.argv[3]
entry = {
    "name": plugin_name,
    "source": {"source": "local", "path": f"./plugins/{plugin_name}"},
    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
    "category": "Productivity",
    "interface": {"displayName": "AINOBI Courseware"},
}
if path.exists():
    data = json.loads(path.read_text(encoding="utf-8"))
else:
    data = {
        "name": marketplace_name,
        "interface": {"displayName": "AINOBI Local Plugins"},
        "plugins": [],
    }
if not isinstance(data, dict):
    raise SystemExit(f"invalid marketplace json: {path}")
data.setdefault("interface", {"displayName": "AINOBI Local Plugins"})
plugins = data.setdefault("plugins", [])
if not isinstance(plugins, list):
    raise SystemExit("marketplace.plugins must be an array")
if not data.get("name"):
    data["name"] = marketplace_name
plugins[:] = [p for p in plugins if not (isinstance(p, dict) and p.get("name") == plugin_name)]
plugins.append(entry)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"updated {path} (marketplace name={data.get('name')})")
PY

# Ensure apps pointer survives (some helpers strip it).
python3 - "$DEST/.codex-plugin/plugin.json" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
if data.get("apps") != "./.app.json":
    data["apps"] = "./.app.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("restored apps: ./.app.json")
PY

echo "installed plugin files → $DEST"
echo "marketplace entry → ./plugins/$PLUGIN_NAME (relative to \$HOME)"

if command -v codex >/dev/null 2>&1; then
  MNAME="$(python3 -c "import json; print(json.load(open('$MARKETPLACE_JSON'))['name'])")"
  echo "running: codex plugin add ${PLUGIN_NAME}@${MNAME}"
  codex plugin add "${PLUGIN_NAME}@${MNAME}" || true
  codex plugin list || true
else
  echo "codex CLI not on PATH — enable the plugin in ChatGPT Desktop → Plugins after restart."
fi

echo
echo "Next:"
echo "  1) Restart ChatGPT Desktop (or start a new Codex CLI session)"
echo "  2) Plugins → AINOBI Local Plugins → enable AINOBI Courseware"
echo "  3) Developer Mode → register MCP URL from INSTALL.md + Bearer ainobi_ak_…"
echo "  4) Start a NEW chat, then ask to list coursewares"
