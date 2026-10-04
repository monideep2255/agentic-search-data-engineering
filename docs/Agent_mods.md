# Agent mods guide

Quick answer: type `/mods` in a session to list every mod with its trigger.
This file is the full reference: what each mod does, how it starts, what it blocks, and where it lives.

## Contents

- [How mods load](#how-mods-load)
- [The mods](#the-mods)
- [Slash commands at a glance](#slash-commands-at-a-glance)
- [Turning one off](#turning-one-off)
- [What a mod is not](#what-a-mod-is-not)
- [Known limits](#known-limits)
- [Maintenance](#maintenance)

## How mods load

A mod is a folder under `.claude/skills/mod-<name>/` that holds a plugin manifest. Claude Code loads it automatically as `mod-<name>@skills-dir`.

- Trust: you trust the repository once, when Claude Code asks.
- Start location: start the session at the repository root, not in a subfolder.
- Version: the CLI must be 2.1.287 or later.
- Check: run `/plugin` to see which mods loaded.
- Meaning of Auto: the mod runs on its own, and there is nothing to call.

The mod folders are tracked in git through a narrow `.gitignore` exception, so a change to code that runs at session start shows up as a diff. The rest of `.claude/` stays local.

## The mods

Fourteen mods: six shared with the other agentic search repositories, and eight built for this repository.

### Shared (in all three repositories)

| Mod | What it does | How it starts | What it blocks | Notes |
|-----|--------------|---------------|----------------|-------|
| mod-blast-radius | Dry-runs a risky Bash command, shows what it would touch in a pane, and asks before it runs | Auto, then asks Proceed or Cancel | A risky command until you press Proceed: recursive or forced delete, `find -delete`, destructive git commands, migrations, `psql` with DROP or TRUNCATE | Extra rules here: `ssh` to a remote host, `age-load`, `psql` with write Cypher or DELETE FROM, and the knowledge graph loader command line |
| mod-context-weather | Shows context fullness as a weather band above the prompt, with a sparkline, last-turn change, and cache warmth. Nudges you to compact when you step away while the cache is warm | Auto, and `/precompact` | Nothing | Cache window is 5 minutes here, and the nudge fires after 4 idle minutes above 60,000 tokens |
| mod-help | Lists the installed mods, warns when an unknown plugin auto-loads from `.claude/skills`, and reminds you once a day | `/mods` or `/mods <mod-name>` | Nothing | Points at this guide |
| mod-public-repo-guard | Guards `git commit` and `git push` in the public repositories | Auto | Skipped hooks (`--no-verify`, `-n`), force pushes, `--all` and `--mirror`, pushes to `production`, `main`, or `develop`, and any commit or push when the leak scanner fails or is missing | The leak scanner is `scripts/check_public_leaks.py`. This repository has no confirm-listed branch, so it never asks |
| mod-replay-theater | Records the file edits of each turn and steps through them one diff at a time in a pane | Auto hint after a turn with edits, or `/replay` | Nothing | Keeps the last 100 steps and 200 diff lines per step |
| mod-secrets-scan | Denies tool calls that carry secret-shaped text, and toasts when a tool result shows one | Auto | Bash, Edit, Write, and NotebookEdit calls holding a key, token, or private key header, in any file type | Read and WebFetch results only toast. No extra patterns or allowed paths are set here |

### This repository only

| Mod | What it does | How it starts | What it blocks | Notes |
|-----|--------------|---------------|----------------|-------|
| mod-code-lint | After a Python edit under the pipelines or knowledge graph folders, warns about SQL or Cypher built with string formatting and about logging calls that include secret-like names | Auto | Nothing | Warns with a toast, up to 3 findings |
| mod-dependency-check | Before a Python package is installed or added to requirements or `pyproject.toml`, shows its requested version, the latest release, and the upload date from PyPI, and flags unpinned, brand new, or missing packages | Auto, then asks Proceed or Cancel | An install or dependency edit until you press Proceed | A release under 14 days old counts as new. Checks up to 10 packages per call |
| mod-long-run-pane | Runs a pipeline entry point from `pyproject.toml` and streams elapsed time, the last log lines, and row counters into a pane with a Stop button | `/longrun <entry point> [args]` | Nothing | Shows the last 20 output lines |
| mod-pipeline-dry-run | Before an ETL entry point runs, shows its arguments, the directories it reads and writes, and what each output directory already holds | Auto, then asks Proceed or Cancel | An ETL run until you press Proceed | Covers the five ETL entry points, `merge-etl`, and `age-load` |
| mod-provenance-guard | Warns after an edit to a pipeline Python file removes a `source` or `source_url` assignment, or adds one inside the merge code | Auto | Nothing | Warns only. Downstream code must never rewrite provenance |
| mod-pytest-markers | When Docker is not running, adds a marker filter to a bare pytest command so integration and docker tests are skipped, and says the run is partial | Auto on a pytest command | Nothing | It rewrites the command rather than blocking it. The filter is `not integration and not docker` |
| mod-run-diff | After a pipeline or merge run, compares its counts with the previous run of the same entry point and flags drops and validation counters that rose | Auto toast after the run, or `/rundiff` | Nothing | A count that falls by more than 5 percent is flagged |
| mod-test-status | Shows the last pytest result in the status line, whether it was a quick or full run, its age, and whether Python files changed since | Auto after a pytest run | Nothing | A run that excludes integration or docker is called quick |

## Slash commands at a glance

- `/mods`: list every mod with its trigger, or `/mods <mod-name>` for one.
- `/replay`: step through the last turn's file edits.
- `/precompact`: compact the conversation now, while the cache is warm.
- `/longrun <entry point> [args]`: run a pipeline entry point and stream its progress.
- `/rundiff`: show how the last pipeline run compares with the one before.

## Turning one off

Add `"mod-<name>@skills-dir": false` under `enabledPlugins` in one of two files:

- `.claude/settings.local.json`: this machine only.
- `.claude/settings.json`: everyone who uses the repository.

Example: `{ "enabledPlugins": { "mod-code-lint@skills-dir": false } }`.

## What a mod is not

A guard reads command text. It is a safety net and not a security boundary, because a determined command can be written to slip past a text match. Commit hooks, branch protection, and CI stay the real controls.

- Risky commands: `.claude/settings.json` holds a permissions list and no hooks block here. mod-blast-radius adds a prompt before a risky command, and the permission list stays the first line of control.
- Secret guard: the `.claude/hooks/` folder is untracked in this repository, so shell hooks there do not ship with a clone. mod-secrets-scan is the only repository-shipped secret guard.
- Public pushes: mod-public-repo-guard complements the commit hooks, the leak scan that `/ship` runs, and the branch protection rulesets on `develop` and `production`.
- Dependencies: mod-dependency-check complements the supply chain review and does not replace it.

## Known limits

- Context weather: cache warmth is an estimate from the cache window setting and the time since the last turn, not a reading from the server.
- `/precompact`: it compacts on a short timer after it replies, because the engine refuses a compaction started inside the command. If no after count follows, run `/compact`.
- Replay theater: it does not record notebook edits.
- mod-help: it marks a mod loaded only when that mod registers a slash command. A mod with no command shows "not seen" even when it is running.
- Guards that ask: they ask through the engine's question dialog. Dismissing the dialog counts as Cancel, and a run with no one to ask also cancels.
- Public repository guard: it fails closed. A missing or failing leak scanner holds the commit or push.
- Dependency check: it needs to reach PyPI. A package it cannot look up is listed as not checked, and only the first 10 packages in a call are checked.
- Pipeline dry run: the directory and entry point table is a copy of the pipeline configuration. A new entry point needs a row in the mod's `config.ts` before the preview is accurate.
- Pytest markers: it only rewrites a bare pytest command, and it probes Docker once a minute, so a Docker start inside that minute is not seen.
- Test status: quick or full comes from the marker names in the configuration, so a new slow marker needs adding there.
- Run diff: it compares only with the previous run of the same entry point. The first run has nothing to compare.
- Long run pane: it runs the entry point directly. Set the launcher word in `config.ts` when entry points are not on the path.
- Code lint and provenance guard: both read edited text with patterns, so a query built in an unusual way can pass unseen.

## Maintenance

The six shared mods are maintained in a separate source and copied into this repository. Edit them through that source, not here, or the next copy overwrites the change. The `hooks/config.ts` file in each shared mod holds this repository's own settings and is never overwritten by the copy. The eight mods listed under This repository only are built and edited here.

Each mod must pass `claude plugin validate` and `claude plugin test` before it is committed.
