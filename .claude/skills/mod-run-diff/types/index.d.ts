export type Change = {
  /** A label, predicate, or counter name exactly as the run reported it. */
  key: string
  kind: 'count' | 'counter'
  before: number | null
  after: number | null
  /** Percent drop for a count that fell, otherwise null. */
  dropPercent: number | null
  isFlagged: boolean
  reason: string
}

export type Comparison = {
  entry: string
  /** True when there was no earlier run, so nothing was compared. */
  isBaseline: boolean
  /** When the pinned baseline was stored or last accepted, in milliseconds. Null when unknown. */
  baselineAt: number | null
  thresholdPercent: number
  changes: Change[]
  flaggedCount: number
}

declare module 'claude-code' {
  interface PluginState {
    'mod-run-diff': {
      last: Comparison | null
    }
  }
}
