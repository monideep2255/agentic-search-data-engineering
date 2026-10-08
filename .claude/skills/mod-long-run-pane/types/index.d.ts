export type Counters = {
  /** Largest rows, nodes, edges, or records figure seen so far, or null. */
  written: number | null
  rejected: number | null
  dangling: number | null
}

export type RunView = {
  entry: string
  args: string[]
  status: 'running' | 'finished' | 'stopped' | 'failed'
  startedAt: number
  elapsedSeconds: number
  /** The last lines of output, newest last. */
  lines: string[]
  counters: Counters
  /** Null until the child exits, and null when a stop or a signal ended it. */
  exitCode: number | null
  isStopRequested: boolean
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'mod-long-run-pane': {
      run: RunView | null
    }
  }
}
