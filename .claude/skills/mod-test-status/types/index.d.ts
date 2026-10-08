export type TestRun = { passed: number; failed: number; skipped: number; deselected?: number; markers: string | null; at: number }

declare module 'claude-code' {
  interface PluginState {
    'mod-test-status': { run: TestRun | null; lastEditAt: number | null }
  }
}
