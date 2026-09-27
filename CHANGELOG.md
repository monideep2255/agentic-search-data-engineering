# Changelog

Every release of the data engineering repository (Systems 1 and 2),
newest first. Generated on each push to `production` by
`.github/workflows/release.yml` from the Conventional Commit subjects
since the previous tag, and carried into `develop` by that release's
back-merge pull request. Do not hand-edit a released section: correct
the commit history or add a new entry instead.

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
