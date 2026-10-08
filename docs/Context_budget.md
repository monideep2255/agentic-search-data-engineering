# Context budget

How much a coding agent session carries before you type anything, what was trimmed, and how the budget is enforced. Numbers marked measured were taken on October 4, 2026.

## Contents

- [Standing versus on demand](#standing-versus-on-demand)
- [Before and after](#before-and-after)
- [Path-scoped rules](#path-scoped-rules)
- [The budget and the mod](#the-budget-and-the-mod)
- [How to re-measure](#how-to-re-measure)
- [Behaviour check](#behaviour-check)
- [Known gaps](#known-gaps)

## Standing versus on demand

Every turn resends the standing context. Anything loaded only when needed costs nothing until then.

- Every turn: instruction files (`CLAUDE.md` and always-on rules), the skills listing, custom agent descriptions, MCP tool lists, MCP server instructions. `AGENTS.md` is not loaded; the measurement lists only `CLAUDE.md`. The skills listing includes 15 skills synced from the claude.ai account, about 3.4k of the 7.7k skills tokens (measured October 4, 2026).
- On demand: pointer rules name a longer file in `.claude/rules-reference/`, read only when the task needs it. Path-scoped rules load when a matching file is read. The reference index `docs/Agent_reference_index.md` holds material moved out of the instruction files.

Two account-level settings change the standing set without any change to this repository:

- Synced skills and plugins (Claude Code 2.1.275): a CLI signed in with a claude.ai account loads the skills and plugins enabled on that account. Opt out with `"syncClaudeAiSkills": false` or `"syncClaudeAiPlugins": false` in user settings. The opt-out does not shrink the total: measured October 4, 2026, in an on, off, on, off test, it moved about 3.4k from the skills figure into the system tools figure, and standing context stayed at 26k.
- Project instructions (Claude Code 2.1.277): a repository with `AGENTS.md` and no `CLAUDE.md` now loads `AGENTS.md`. This repository has both, so only `CLAUDE.md` loads. The `/config` option Project instructions can load both; leave it off, because it would add the whole `AGENTS.md` file to every turn.

## Before and after

All figures measured with `/context` at session start, October 4, 2026.

| Item | Before | After |
|------|--------|-------|
| Total | 39.0k tokens | 26.1k tokens |
| Instruction files | 15.3k | 4.6k |
| Skills listing | 8.4k | 7.7k |
| Custom agents | 1.3k | 297 |
| MCP tools | 671 | 0 (a docs connector denied) |
| MCP server instructions | 717 | 212 |

Byte changes (measured):

- Always-on rules: 31,057 to 7,154 bytes.
- `CLAUDE.md`: 12,064 to 4,999 bytes.
- `AGENTS.md`: 12,112 to 6,066 bytes.

What changed:

- Long rule bodies moved to `.claude/rules-reference/`, which is local only and gitignored.
- Two plugins switched off in `.claude/settings.json`.
- Reference material moved to `docs/Agent_reference_index.md`.

## Path-scoped rules

A rule with a `paths` list in its frontmatter loads only when a matching file is read. A transcript showed a `nested_memory` entry for each of these when a matching file was read (measured).

| Rule | Globs |
|------|-------|
| decision-logging | `DECISIONS.md` |
| dependency-tracking | `.claude/**`, `system-01-data-pipelines/**`, `system-02-knowledge-graph/**` |
| system-design-patterns | `.claude/**`, `system-01-data-pipelines/**`, `system-02-knowledge-graph/**` |
| file-naming | `docs/**` |

## The budget and the mod

The shared mod `mod-context-budget` is an observer with zero standing tokens.

- On session start it reads the standing context: instruction files, skills listing, agents, and MCP tools.
- It compares the total with a budget of 13,900 tokens, which is the measured 12,597 plus 10 percent.
- Over budget, it shows a toast and sets the status line.
- `/context-budget` lists every instruction file with its tokens.
- The budget lives in `.claude/skills/mod-context-budget/hooks/config.ts` and changes only with a recorded reason.

The mod is listed in `docs/Agent_mods.md`.

## How to re-measure

Run this at the repository root:

```bash
claude -p "/context" < /dev/null
```

Compare the totals with the table above. Change the budget only after a new measurement and a recorded reason.

## Behaviour check

Measured October 4, 2026. The same frozen cases and rubric ran before and after the change, three runs per case, with no turn cap and the same judge model. A case passes only when all three runs pass (pass^3). The evaluation itself is kept outside this repository.

| Measure | Before | After |
|---|---|---|
| Cases passing pass^3 | 12/14 | 11/14 |
| Cost per run | $0.23 | $0.18 |
| Latency per run | 19.4 s | 16.1 s |
| Cache-read tokens per run | 116,845 | 86,585 |

- `de-provenance-drop` read 2/3 instead of 3/3. The reply text is byte-identical to a scoring that passed 3/3, and baseline replies had the same shape, so this is judge variance on a borderline reply rather than a behaviour change.
- `de-commit-format` missed once because a regex matched a reply telling the user to leave out the trailer; it passed 3/3 when rerun.
- A single judge call per run can flip on a borderline reply. A majority of three judge calls would remove that, and is not adopted yet.

## Known gaps

1. One measurement: the budget comes from a single run on October 4, 2026. Run to run variation is not measured.
2. Headless versus interactive: the figures come from a headless `/context` call. An interactive session may load more or less.
3. Local only reference files: `.claude/rules-reference/` is gitignored, so another clone does not have the long rule text. Its pointer rules lead nowhere there.
4. Eval coverage: the behaviour check covers only its own cases, so it does not show that every trimmed rule still changes behaviour.
5. Account drift: a skill enabled on the claude.ai account grows the skills listing here with no repository change. When the mod flags an overage, check the `claude.ai sync` rows in `/context` first.
