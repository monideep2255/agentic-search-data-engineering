# AGENTS.md

Instructions for `agentic-search-data-engineering`. For all AI agents (Gemini, Copilot, Codex, GPT, etc.). Same content as CLAUDE.md, plus the compact skills index below.

This repository covers System 1 (data pipelines) and System 2 (knowledge graph) only. System 3 (search agent, FastAPI, LangGraph, UI, delivery channels) lives in a separate repository. Do not add System 3 dependencies or code here.

Stack: Python 3.11+, LinkML, BioLink 4.x, KGX, PostgreSQL 15 + Apache AGE.

This repository has been public since 2026-09-24. Everything committed is world-readable and effectively permanent, including history, commit messages, and author metadata. Before committing anything:

- No secrets: keys, tokens, passwords, or connection strings with credentials. Use environment variables and `env.example` placeholders.
- No personal data about anyone, and no work identity details such as work email addresses or internal usernames. Commit with a GitHub noreply address.
- No employer-internal material: internal proposals, budgets, strategy notes, Jira keys, internal hosts, or internal IP addresses. The innovation proposal stays local and gitignored; never re-add it.
- No colleague names, local machine paths, private repository names, or server addresses with login commands. Use placeholders such as `<repo-root>`, `<you>`, and `<server-ip>`.
- Never bypass a pre-commit hook with `--no-verify`. If something slips, remove it, tell the owner, and rotate any exposed secret at once.

The fuller version of these rules is `.claude/rules/public-repository-privacy.md` where that folder is present.

Branch model: phase branches named `phase/N.M-short-description`, one pull request into `develop` after the owner approves, no direct push to `develop` or `production`; `production` moves only by a merged release pull request.

---

## Current focus

| Priority | System | Status |
|----------|--------|--------|
| 1 | System 1: data pipelines | V1 complete (2026-04-22), Gate 3 passed. The 5-database AGE graph is live on a Hetzner CPX42 (<server-ip>): 115,406,761 nodes and 693,295,991 edges, 11 vertex labels, 14 edge labels. All 7 Cypher smoke queries pass. The loader's `index_builder.py` runs all four index passes plus ANALYZE as Steps 7 and 8. Details: `docs/Knowledge_graph_on_server_reference.md`. |
| 2 | System 2: knowledge graph | AGE graph live on the cloud VPS, queryable via openCypher. Same reference doc. |
| 3 | System 3: search agent | Separate repository. Do not build here. |

---

## Architecture

```
System 1: data pipelines (this repo)
  NCBI FTP -> parse -> BioLink map -> LinkML validate -> KGX files

System 2: knowledge graph (this repo)
  KGX files -> normalize -> merge -> PostgreSQL + AGE -> openCypher
```

This repository builds Layer 1 (fully ingested knowledge graph) of a three-layer data architecture. Layers 2 and 3 (on-demand API, enrichment) are query-time concerns in a separate repository. See `docs/architecture/Three_layer_data_architecture.md`.

---

## Build order (System 1)

Phase 1 first: Gene + ClinVar + MedGen. These three form the core triangle and share cross-references (`mim2gene_medgen` maps all three). Build them together before adding PubMed or Taxonomy.

```
Phase 1 (weeks 1-2):  Gene ETL -> ClinVar ETL -> MedGen ETL -> first merge test  [DONE 2026-04-14]
Phase 2 (weeks 3-4):  PubMed ETL -> Taxonomy ETL -> five-database merge  [DONE 2026-04-17]
Phase 3 (weeks 5-6):  AGE loader code -> Cypher validation (loader code only; no local load)  [DONE 2026-04-19]
Phase 4 (week 7):     Cloud deploy: provision Hetzner VPS -> rsync KGX from laptop -> load into AGE on cloud -> Gate 3 = V1 complete  [DONE 2026-04-22: V1 complete, 7 Cypher smoke queries passed, post-load tuning (GIN + edge B-tree + ANALYZE + postgres.conf) folded back into loader's index_builder.py]
```

System 3 (search agent, FastAPI, LangGraph, UI) is tracked in the separate repository. Do not build here.

---

## Pipeline pattern (every ETL follows this)

```
Step 1: Download  - FTP bulk download, idempotent (skip if unchanged)
Step 2: Parse     - database-specific parser, output Python objects
Step 3: Map       - BioLink mapper: assign categories, predicates, canonical IDs
Step 4: Validate  - LinkML validator, reject with reason (never silent discard)
Step 5: Export    - KGX format: nodes.tsv + edges.tsv with provenance on every row
```

Shared utilities live in `system-01-data-pipelines/shared/`. Never duplicate across pipelines.

---

## Provenance: non-negotiable

Every node: `id`, `category`, `name`, `source`, `source_url`, `xrefs`
Every edge: `subject`, `predicate`, `object`, `source`, `source_url` + evidence fields

Every fact must be clickable back to its NCBI source record. This is the trust moat.

---

## Where the rest lives

- Reference docs table, canonical reference pipeline, and the data source adapter pattern: `docs/Agent_reference_index.md`. Read it before writing pipeline code or adding a data source.
- Agent mods: `docs/Agent_mods.md`. Standing context budget: `docs/Context_budget.md`. Rules: `.claude/rules/` where that folder is present.
- Log non-trivial decisions to `DECISIONS.md`.

---

## Skills index

Skills live in `.claude/skills/<name>/SKILL.md`. Read the file before doing that kind of work.

- bossman-mode: autonomous execution with agent teams (`/bossman`)
- ship: sync docs, scan for leaks, commit, push the phase branch (`/ship`)
- repo-dive: first-principles analysis of a `reference-repos/` repository (`/repo-dive <path>`)
- skill-adapt-verify: check an adapted skill for stale paths and style violations
- objective-review: critical feedback, not agreement
- first-principles: explain a concept from fundamentals
- socratic-questioning: question before answering a decision
- qa-gate: six-phase quality gate before any pipeline commit
- release-workflow: qa-gate then ship
- best-practices: session-start checklist and commit hygiene
- python-code-standards, testing-standards, architecture-patterns, documentation-standards, visualization-standards, eval-harness: standards read before the matching task
- mod-*: agent mods, hook plugins that load on their own (`docs/Agent_mods.md`)

Sub-agents in `.claude/agents/`: first-principles, socratic, objective-review, action-planner, git-sync, docs-sync.

---

Last updated: 2026-10-04
