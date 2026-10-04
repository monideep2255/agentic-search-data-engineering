// Per-repository settings for mod-run-diff.
export const config = {
  /** A count that falls by more than this percent is flagged. */
  dropThresholdPercent: 5,
  /** Most changed rows shown in the pane. The rest becomes "N more". */
  maxRows: 30,
  /** Used only when pyproject.toml cannot be read. */
  fallbackEntryPoints: ['gene-etl', 'clinvar-etl', 'medgen-etl', 'pubmed-etl', 'taxonomy-etl', 'merge-etl', 'age-load'],
}
