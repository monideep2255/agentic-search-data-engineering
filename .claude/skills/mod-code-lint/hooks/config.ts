// Per-repository settings for mod-code-lint.
export const config = {
  // Python files under these folders are scanned after an edit.
  roots: ['system-01-data-pipelines/', 'system-02-knowledge-graph/'],
  maxFindings: 3,
  queryKeywords: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MATCH', 'CREATE', 'MERGE'],
  secretNames: ['password', 'passwd', 'secret', 'token', 'api_key', 'apikey', 'conn_str', 'dsn', 'connection'],
}
