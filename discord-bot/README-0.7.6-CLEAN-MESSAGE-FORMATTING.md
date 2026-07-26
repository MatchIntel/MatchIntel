# MatchIntel Discord Bot v0.7.6 — Clean Message Formatting

This release builds on v0.7.5 and improves `/sendthismessage` formatting.

## Changes

- Restores literal `\\n` tokens as real Discord line breaks.
- Automatically separates collapsed Markdown sections such as `1. **Download MatchIntel**`.
- Places inline `•` items onto separate bullet lines.
- Separates the Getting Started competitive-safety note.
- Removes the redundant embed footer and timestamp from owner-authored `/sendthismessage` posts; Discord already displays the bot name and sent time above the embed.
- Keeps normal inline bold formatting unchanged.

## Usage

You can paste a compact one-line slash-command value and use `\\n` wherever a manual line break is needed. Numbered bold headings are also detected automatically.

No backend, database, or environment-variable changes are required.
