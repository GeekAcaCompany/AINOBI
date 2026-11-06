---
name: ainobi-images
description: Adds illustrations, photos, and other pictures to AINOBI courseware, drawing them with your own image generation when you have it and falling back to the host's image service only when you do not. Use when a slide, quiz, or cover needs an image, or the user asks for a picture, illustration, or visual in AINOBI courseware.
---

# Images for AINOBI courseware

You are the image model when you can generate images yourself. The host's image service (`courseware_image_generate`) is only for agents without that ability, and it needs the owner's `OPENAI_API_KEY`.

Do this with the courseware open (`courseware_open` or `courseware_create`, which return `mcp_session_id`).

## 1. Decide whether a picture is the right element

Use an image for illustrations, photos, scenes, and characters. Text, cards, tables, charts, and diagrams are built from slide elements instead (`rich`, `html`, shapes), as the `ainobi-courseware` skill describes. Hand-written SVG is not a substitute for an illustration.

Slides are 1920×1080. Pick the image's shape from where it goes: 16:9 for a full-slide background, square or 4:3 for an illustration beside text.

## 2. Make the image

**If you can generate images:**

1. Write one prompt per image: subject, style, composition, and the aspect ratio. Keep the style the same across a courseware (say it in every prompt). Ask for no text inside the image unless the lesson needs it, and then check the spelling.
2. Generate it, and look at the result before using it. Regenerate if it is wrong, distorted, or off-topic.
3. Upload it:
   - On a local AINOBI Studio, pass the file you saved: `courseware_asset_upload { mcp_session_id, local_path: "<absolute path>" }`.
   - Otherwise pass the bytes: `courseware_asset_upload { mcp_session_id, file_name: "name.png", content_base64 }`.

**If you cannot generate images:**

1. `courseware_image_generate { mcp_session_id, prompt }`. It is billed and slow: run one at a time and wait for each result.
2. If it reports that image generation is not configured, tell the user that pictures need `OPENAI_API_KEY` in `.env.local` (or an agent that can generate images), and continue without pictures. Do not retry.

Both paths return `source` (and `file_id`). Keep it: do not generate the same image twice.

## 3. Place it

```text
ainobi_exec ["element","insert","<slide>","--type","image","--set","source=<source>", …size, position, timing]
```

Then follow the `ainobi-courseware` skill to save and send the user a fresh preview link. For a quiz question's image, follow its quiz topic instead: question media goes inside the quiz layout.

## Rules

- Never call `ainobi_exec ["image", …]`.
- Never call `courseware_image_generate` when you can generate the image yourself.
- Reuse an uploaded image (`courseware_asset_list`) instead of making it again.
