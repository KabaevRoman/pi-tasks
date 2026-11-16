# Prompt provenance

The original fragments in `original/` are reproduced from Piebald-AI/claude-code-system-prompts at commit `06a56c03bbd006278263aa380786ceb608f1fc23`, corresponding to the selected Claude Code 2.1.310 inventory. They contain Claude Code prompt text extracted and catalogued by the upstream project. Original metadata comments are retained.

Source and upstream licensing information: https://github.com/Piebald-AI/claude-code-system-prompts/tree/06a56c03bbd006278263aa380786ceb608f1fc23

`manifest.json` records every imported source path, Git blob SHA-1, byte count and SHA-256. The importer verifies each source against `source-tree.json` before copying it. The manifest intentionally says `complete: false`.

`src/extensions/prompts.ts` records the active subset and adaptation bindings. Cached originals for Explore/Plan, compaction and multi-agent plan reminders are inactive because this profile does not implement the tools or exact orchestration they describe. They do not imply runtime support.
