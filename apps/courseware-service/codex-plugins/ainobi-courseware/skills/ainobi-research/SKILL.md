---
name: ainobi-research
description: Gathers and checks the facts for AINOBI courseware, using your own web search when you have it and falling back to the host's search only when you do not, and reads the user's own documents. Use before writing courseware content that needs facts, figures, dates, current events, or the user's reference material.
---

# Research for AINOBI courseware

You are the search engine when you can search the web yourself. The host's search (`courseware_search`) is only for agents without that ability, and it needs the owner's `TAVILY_API_KEY`.

## 1. Start from what the user gave you

- Files in the courseware library: `courseware_doc_read { mcp_session_id, file_id }` turns PDF, Word, slides, and spreadsheets into text.
- Files on this machine that you can read yourself: read them directly.
- When the user names sources, use those first.

## 2. Search for what is missing

**If you can search the web:** search, then open and read the most authoritative pages (official bodies, textbooks, papers, the original publisher). For anything time-sensitive, search in rounds: the overall picture, then depth, then a check of each key figure.

**If you cannot:** `courseware_search { mcp_session_id, query }`, with `time_range` or `topic` for recent events. If it reports that search is not configured, tell the user that research needs `TAVILY_API_KEY` in `.env.local` (or an agent with web search), and ask them for source material instead. Do not invent facts to fill the gap.

## 3. Check before it goes on a slide

- Confirm every figure, date, and name in a second source when it matters.
- Prefer the date the user cares about: say "as of" when a fact changes over time.
- Keep a short list of the sources you used, and offer it to the user. Put sources on a slide when the user asks or the subject needs it.
- Medical, legal, and financial content: use only the user's material and sources you found and checked, and say so.

## 4. Write it for learners

Summarize in the courseware's language and level; never paste raw search results into slides. Then author with the `ainobi-courseware` skill.
