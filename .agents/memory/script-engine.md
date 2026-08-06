---
name: Script engine English subtitle sentinel
description: How the Arabic script engine embeds English subtitles, and how the UI splits them.
---

**Rule:** `generateCinematicScript()` in `artifacts/api-server/src/lib/scriptGenerator.ts` appends the English subtitle block after the literal sentinel string `---ENGLISH_SUBTITLES---`. The frontend (`writing.tsx`) calls `splitScriptContent()` which splits on this sentinel and renders the Arabic block as main prose and the English block inside a collapsible `EnglishSubtitlesPanel`.

**Why:** Storing both languages in a single `generatedContent` string avoids a DB schema change while keeping the output self-contained.

**How to apply:** Never rename or remove the sentinel string without updating both the generator and the UI splitter simultaneously.
