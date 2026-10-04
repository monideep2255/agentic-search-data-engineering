// Per-repository settings for mod-pipeline-dry-run.
//
// Directory defaults mirror shared/config.py in the pipelines package: every
// directory sits under the data root unless its own environment variable is
// set. Paths are relative to the repository root.
export const config = {
  envNames: { data: 'DATA_DIR', ftp_cache: 'FTP_CACHE_DIR', kgx: 'KGX_OUTPUT_DIR', raw: 'RAW_DATA_DIR' },
  defaults: { data: 'data', ftp_cache: '{data}/ftp_cache', kgx: '{data}/kgx', raw: '{data}/raw' },
  // Databases the merge step reads when --databases is not given.
  mergeDatabases: ['gene', 'clinvar', 'medgen', 'pubmed', 'taxonomy'],
  mergeDefaultSubdir: 'merged',
  // One row per [project.scripts] entry. `modules` are the dotted names a
  // `python -m` call can use. `reads` and `writes` are directory templates.
  // `downloads` means the FTP cache is also written unless --skip-download.
  entryPoints: {
    'gene-etl': { modules: ['gene.cli'], reads: ['{ftp_cache}'], writes: ['{kgx}/gene'], downloads: true },
    'clinvar-etl': { modules: ['clinvar.cli'], reads: ['{ftp_cache}'], writes: ['{kgx}/clinvar'], downloads: true },
    'medgen-etl': { modules: ['medgen.cli'], reads: ['{ftp_cache}'], writes: ['{kgx}/medgen'], downloads: true },
    'pubmed-etl': { modules: ['pubmed.cli'], reads: ['{ftp_cache}'], writes: ['{kgx}/pubmed'], downloads: true },
    'taxonomy-etl': { modules: ['taxonomy.cli'], reads: ['{ftp_cache}'], writes: ['{kgx}/taxonomy'], downloads: true },
    'merge-etl': { modules: ['merge.cli'], reads: [] as string[], writes: [] as string[], downloads: false, isMerge: true },
    'age-load': { modules: ['loader.cli'], reads: [] as string[], writes: [] as string[], downloads: false, isLoader: true },
  } as Record<string, { modules: string[]; reads: string[]; writes: string[]; downloads: boolean; isMerge?: true; isLoader?: true }>,
}
