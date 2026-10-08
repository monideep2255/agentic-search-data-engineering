# Changelog

Every release of the data engineering repository (Systems 1 and 2),
newest first. Generated on each push to `production` by
`.github/workflows/release.yml` from the Conventional Commit subjects
since the previous tag, and carried into `develop` by that release's
back-merge pull request. Do not hand-edit a released section: correct
the commit history or add a new entry instead.

## v1.1.0 (2026-10-08)

### Features

- mods: Add 14 agent mods for this repository (76eb585)

### Fixes

- mods: Mirror the shell guard exactly before skipping a delete question (47de69f)
- mods: Apply the post-ship audit fixes and add mod-context-budget (aac7dba)

### Security

- Replace a person's name in five Windows home paths (6de1806)
- ship: Scan every outgoing commit and read every file a push publishes (81852a8)
- ship: Add a scan for secrets and private values before a push (e3b64d5)

Plus 11 internal changes not listed individually (11 maintenance): chores, documentation, tests, refactors and build configuration.

Full diff: `v1.0.0..v1.1.0`

## v1.0.0 (2026-09-27)

The first release, tagged by hand. It says what the repository does today,
because there is no previous version to compare against. The graph it built
went live on 2026-04-22 and has not changed since.

WHAT IT DOES: downloads five NCBI databases in bulk, maps them to the BioLink
model, and loads them into one knowledge graph that the search agent queries.

- Five pipelines, one per database: Gene, ClinVar, MedGen, PubMed and
  Taxonomy, each read from NCBI's bulk FTP files.
- Every node and edge is mapped to BioLink, validated with LinkML, and keeps a
  link to the NCBI record it came from.
- The graph holds 115,406,761 nodes and 693,295,991 edges in PostgreSQL 15
  with Apache AGE 1.5.0, queryable with openCypher.
- The loader builds the indexes and runs the tuning the live graph needs, so a
  fresh load needs no manual steps.

WHY THIS ENTRY IS HAND-WRITTEN, and it is the only one that is. A first
release has no previous tag, so the generator would read the whole history,
and no commit before this release uses the Conventional Commit types it
counts: it would have called this v0.0.1. The full history is in git. Every
later release is generated.
