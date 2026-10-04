# Agent reference index

Reference material moved out of `CLAUDE.md` and `AGENTS.md`, which load on every turn of a coding agent session. Nothing was removed: each section below is the text those files carried before the move.

## Table of contents

- [Reference docs](#reference-docs)
- [Canonical reference pipeline](#canonical-reference-pipeline)
- [Data source adapter pattern](#data-source-adapter-pattern)

## Reference docs

| Doc | What it is | Read when |
|-----|-----------|-----------|
| `System_1_data_engineering_plan.md` | Detailed build plan for all 5 ETL pipelines | Before writing any pipeline code |
| `NCBI_databases_and_APIs_reference.md` | Raw data on all 39 NCBI databases, FTP paths, record counts | Checking FTP URLs and file formats |
| `architecture/Biolink_repos_explained.md` | BioLink/LinkML reference | Schema design |
| `architecture/Three_layer_data_architecture.md` | Layer 1 (graph), Layer 2 (on-demand API), Layer 3 (enrichment). What this repository does vs System 3. | Understanding system boundaries |
| `architecture/Merge_logic_explained.md` | First-principles walkthrough of the 5-database merge: streaming passes, dedup strategy, stub injection, dangling-edge detection | Before modifying merger.py or writing Phase 3 loader code |
| `architecture/AGE_loader_explained.md` | First-principles walkthrough of the Phase 3 AGE loader: KG structure, why AGE over Neo4j, performance expectations, hosting comparison (Hetzner vs Netcup vs Contabo, US vs EU) | Before writing any Phase 3 loader or Phase 4 cloud-deploy code |
| `context/Innovation_proposal_2026.md` | Full system proposal (local only, not published) | Context and framing |
| `bossman_execution_plan.md` | Phase-by-phase execution plan for System 1 pipelines (bossman mode reference) | Before starting any bossman phase |
| `context/setup/setup-03_windows_laptop.md` | One-time setup guide for Windows laptop (repository clone, symlinks, venv, data rsync) | When setting up a new local dev environment |
| `context/setup/setup-04_hetzner_vps.md` | End-to-end Hetzner CPX42 provisioning: SSH keys from personal computer and work laptop, rsync install, PostgreSQL + AGE install, pre-Phase-4.0 verification | Before Phase 4.0 cloud deploy work |
| `context/setup/setup-05_rsync_windows.md` | First-principles rsync on a locked-down Windows laptop: Scoop + cwRsync install, cygdrive path format, cwRsync vs Windows OpenSSH pipe incompatibility, HOME env var fix, exact working command, transfer time estimate | Before running Phase 4.0 rsync from the work laptop |
| `Knowledge_graph_on_server_reference.md` | A-Z operations reference for the live V1 graph on Hetzner CPX42: SSH access, Cypher query examples, index listing, node/edge counts, cost breakdown, snapshot procedure | Before querying or maintaining the live graph |
| `Context_budget.md` | Standing context before and after the trim, path-scoped rules, the budget and how to re-measure it | Before adding to `CLAUDE.md`, `AGENTS.md`, a rule, or a skill description |
| `Project_overview_A_to_Z.md` | Single-source-of-truth navigation hub with pointers into every other doc | First doc to read for project orientation |
| `architecture/Data_mapping_and_ontology_explained.md` | A-Z walkthrough of how raw NCBI data becomes a BioLink graph: CURIEs, per-pipeline mapping rules, merge logic, BioLink 4.x compliance | Before writing any new pipeline or auditing existing mapping |
| `architecture/Technical_reference_data_engineering.md` | End-to-end technical walkthrough of the V1 system: architecture, schema, indexing, Cypher patterns, performance baselines, lessons | Engineering deep-dive on what was built and why |
| `visualizations/Architecture_diagram.md` + `visualizations/Schema_visualization.md` | Mermaid diagrams of system architecture, ETL flow, deployment, and BioLink schema with sample CURIEs | When orienting visually, in slides, or onboarding others |

## Canonical reference pipeline

The most valuable reference is an existing 9-step BioLink pipeline at:

`reference-repos/ncbi_ai_agents/KG/pipeline/src/glucose_metabolism_kg/`

Patterns to copy directly:

- `utils.py:91-104` - idempotent FTP download with cache
- `utils.py:35-86` - NCBI Entrez retry with exponential backoff and rate limiting
- `assembly.py` - dedup, dangling-edge validation, MONDO stub injection
- `export.py` - KGX TSV + JSON-LD + Neo4j CSV export (Neo4j CSV part needs adapting for AGE)
- `config.py` - dataclass-based configuration with `__post_init__` directory creation
- `variants.py` - chunked DataFrame processing for large gzipped files

Reference BioLink schema (8 categories, 15 predicates) is encoded in `assembly.py` and `export.py`. Copy categories and predicates verbatim where they apply.

Reference repository's own CLAUDE.md (full architecture and file map) is at `reference-repos/ncbi_ai_agents/CLAUDE.md`. Skim it before designing new pipelines.

## Data source adapter pattern

When adding new NCBI data sources, use optional adapters instead of a monolithic interface. Each data source implements only the adapters that apply to its capabilities. Derived from OpenClaw's channel plugin architecture (see `reference-repos/personal-os/Reference-repos/openclaw-Deep-Dive/`).

Adapter types:
- `QueryAdapter` (required): accepts a structured query, returns results
- `FacetAdapter` (optional): supports faceted search (PubMed has this; Gene does not)
- `CitationAdapter` (optional): returns structured citation metadata (PubMed, ClinVar)
- `RelationshipAdapter` (optional): can traverse entity relationships (Gene, MedGen)
- `StreamingAdapter` (optional): supports streaming large result sets (dbSNP)

Apply when: designing the System 3 data source abstraction or adding a new NCBI database to the pipeline. The ETL pipelines (System 1) follow the 5-step pattern above. The adapter pattern applies to query-time interfaces in System 3.

The core query pipeline checks adapter availability before attempting operations. If a source lacks `FacetAdapter`, the search agent skips faceted refinement for that source. No "not implemented" exceptions, no silent no-ops.
