# Assets, search, docs, images (L1)

Read before `search`, `doc read`, `image generate|replicate-html`, or heavy asset workflows.

## Assets

```bash
ainobi asset get <file_id>          # @-mentioned library file → signed url
ainobi asset upload path/to/file.png
```

Slide-layer media: upload then `element insert --type image|audio --asset …` with timing on narrated slides. Quiz question media: see topics/quiz.md.

## Reference courseware (@)

Host stages `./reference/*.brief.json` + `.scene.json`.

```bash
ainobi reference inspect ./reference/foo.brief.json
ainobi reference import ./reference/foo.scene.json --slides all|--slides 0,2-4 [--at N]
```

Never `ainobi load` reference files; never hand-copy large scene JSON.

## Search

```bash
ainobi search "query" --max-results 5 --answer
```

Agent runtime POSTs to host Tavily. For time-sensitive topics: 2–3 iterative searches (landscape → depth → verify) with `--time-range` / `--topic`. Summarize — do not dump raw JSON into slides.

## Doc read / image tools

- Never `Read` raw PNG/PDF bytes or `WebFetch` binary URLs.
- Text description: `ainobi doc read ./reference.png` then Read returned `markdown_path`.
- Editor @ library files: `ainobi doc read --file-id <uuid>` (host loads OSS; never pass the display filename).
- **Section knowledge base** (course lesson materials, not courseware assets): Read `section-knowledge-catalog.json` (or `ainobi knowledge list`) for `file_id` + `file_summary`. Segmented body text: `ainobi knowledge read --file-id <uuid> [--offset N] [--limit M]` then Read the returned `markdown_path`.
- Visual clone for html elements: `ainobi image replicate-html ./slide.png` → Read `html_path` → `element insert --type html --asset …`.
- Original illustration: `ainobi image generate --prompt "…"` → use `data.source` as image `source` (and `data.file_id` if you need the library id).

### `image generate` (hard rules — billed, slow)

- **Foreground only.** Run each `ainobi image generate` as a **blocking** Bash call. Do **not** background it, do **not** use the Task tool / TaskOutput to wait on it, and do **not** fire many parallel background generates.
- **Why:** Background task IDs often expire (`No task found with ID`) while the image is already in the asset library — the agent loses `data.source` and regenerates (wasted credits).
- **One (or a few) at a time:** Prefer sequential generates; at most 2–3 concurrent **foreground** Bash calls if the host allows. Read each JSON `data.source` before the next insert.
- **Optional durable capture:** `ainobi image generate … > "$WORK_DIR/gen_p1.json"` then Read that file — safer than relying on ephemeral TaskOutput.
- Agent quiet output omits the fat `asset` object; `source` / `file_id` / `file_name` remain. If a prior result was archived, use `ainobi recall <id>` or re-read the redirected JSON — do **not** regenerate unless `ok` was false.

Prefer workspace-relative paths or `--from-work-dir`; avoid embedding huge absolute paths from `scene info` into Bash.
