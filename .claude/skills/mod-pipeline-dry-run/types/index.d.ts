export type DryRunReport = { lines: string[]; isBand: boolean } | null

declare module 'claude-code' {
  interface PluginState {
    'mod-pipeline-dry-run': { report: DryRunReport }
  }
}
