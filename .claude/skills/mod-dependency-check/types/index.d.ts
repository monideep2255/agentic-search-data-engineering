export type DependencyReport = { lines: string[]; isBand: boolean } | null

declare module 'claude-code' {
  interface PluginState {
    'mod-dependency-check': { report: DependencyReport }
  }
}
