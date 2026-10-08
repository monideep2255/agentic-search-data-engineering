// Per-repository settings for mod-provenance-guard.
export const config = {
  // Python files under this folder are checked.
  pipelineRoot: 'system-01-data-pipelines',
  // Code here must never assign source or source_url (downstream code never rewrites provenance).
  mergePaths: ['system-01-data-pipelines/merge/', 'system-01-data-pipelines/shared/merger.py'],
  // The provenance fields.
  fields: ['source', 'source_url'],
}
