import type { Change, Comparison } from '../types'
import { basename, programs } from './kit/shell.ts'

export type Counts = Record<string, number>

const LOG_PREFIX = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[,.]\d+)?\s+\S+\s+[A-Z]+\s+/
const PAIR = /([A-Za-z][A-Za-z0-9_]*)=(\d[\d,]*)(?=$|[\s,;)\]])/g
const LABELLED = /^[-*]?\s*(.+?):\s+(\d[\d,]*)(?:\s*\([^)]*\))?$/
const COUNTER_KEY = /dangling|duplicate|missing_?prov/i
const WRAPPERS = new Set(['uv', 'poetry', 'pipenv', 'pdm', 'hatch'])

/** True for a validation counter: a number that should stay at zero or fall. */
export function isCounterKey(key: string): boolean {
  return COUNTER_KEY.test(key.replace(/\s+/g, '_'))
}

function toNumber(text: string): number {
  return Number(text.replace(/,/g, ''))
}

function put(counts: Counts, key: string, value: number): void {
  let k = key
  let n = 2
  while (Object.prototype.hasOwnProperty.call(counts, k)) k = `${key}_${n++}`
  counts[k] = value
}

/**
 * Reads counts from log lines (key=value pairs) and from report lines
 * ("Label: 1,234"). A key seen twice in one text gets a numbered suffix.
 */
export function parseCounts(text: string): Counts {
  const counts: Counts = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(LOG_PREFIX, '').trim()
    if (line === '') continue
    let isPair = false
    for (const m of line.matchAll(PAIR)) {
      put(counts, m[1], toNumber(m[2]))
      isPair = true
    }
    if (isPair || line.includes('=')) continue
    const l = LABELLED.exec(line)
    if (l !== null && l[1].length <= 80) put(counts, l[1].replace(/\s+/g, ' ').trim(), toNumber(l[2]))
  }
  return counts
}

/** The report file path named in the command output, when the run wrote one. */
export function reportPathFrom(text: string): string | undefined {
  let found: string | undefined
  for (const m of text.matchAll(/(?:report_path=|Wrote merge report to )(\S+)/g)) found = m[1]
  return found
}

/** The names under [project.scripts] in a pyproject.toml. */
export function parseScripts(toml: string): string[] {
  const out: string[] = []
  let inside = false
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inside = line === '[project.scripts]'
      continue
    }
    if (!inside) continue
    const m = /^([A-Za-z0-9_.-]+)\s*=/.exec(line)
    if (m !== null) out.push(m[1])
  }
  return out
}

/**
 * The entry point a Bash command ran, directly or through a runner such as
 * `uv run`. Undefined when none ran. A command that ran several different
 * entry points returns 'several' because one output cannot be split between them.
 */
export function entryFrom(command: string, entries: readonly string[]): string | 'several' | undefined {
  const set = new Set(entries)
  const seen = new Set<string>()
  for (const p of programs(command)) {
    let i = 0
    if (WRAPPERS.has(basename(p[0])) && p[1] === 'run') {
      i = 2
      while (i < p.length && p[i].startsWith('-')) i++
    }
    if (i < p.length && set.has(basename(p[i]))) seen.add(basename(p[i]))
  }
  if (seen.size === 0) return undefined
  return seen.size === 1 ? [...seen][0] : 'several'
}

/** Compares a run with the previous run of the same entry point. */
export function compare(entry: string, before: Counts | undefined, after: Counts, thresholdPercent: number, baselineAt: number | null = null): Comparison {
  if (before === undefined) return { entry, isBaseline: true, baselineAt, thresholdPercent, changes: [], flaggedCount: 0 }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changes: Change[] = []
  for (const key of keys) {
    const b = before[key]
    const a = after[key]
    const kind = isCounterKey(key) ? 'counter' : 'count'
    const from = b ?? (kind === 'counter' ? 0 : null)
    const to = a ?? (b === undefined ? null : 0)
    if (from === to) continue
    let isFlagged = false
    let reason = 'changed'
    let dropPercent: number | null = null
    if (kind === 'counter') {
      if ((to ?? 0) > (from ?? 0)) {
        isFlagged = true
        reason = 'validation counter rose'
      } else reason = 'validation counter fell'
    } else if (from === null) {
      reason = 'new'
    } else if ((to ?? 0) < from && from > 0) {
      dropPercent = ((from - (to ?? 0)) / from) * 100
      if (dropPercent > thresholdPercent) {
        isFlagged = true
        reason = to === null || to === 0 ? 'dropped to zero or is missing' : `dropped more than ${thresholdPercent} percent`
      } else reason = 'small drop'
    } else reason = 'rose'
    changes.push({ key, kind, before: from, after: to, dropPercent, isFlagged, reason })
  }
  changes.sort((x, y) => Number(y.isFlagged) - Number(x.isFlagged) || Math.abs((y.after ?? 0) - (y.before ?? 0)) - Math.abs((x.after ?? 0) - (x.before ?? 0)))
  return { entry, isBaseline: false, baselineAt, thresholdPercent, changes, flaggedCount: changes.filter(c => c.isFlagged).length }
}

/** Counts of the right shape from whatever the store held, or undefined. */
export function asCounts(value: unknown): Counts | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Counts = {}
  for (const [k, v] of Object.entries(value)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  return out
}

/** "2026-10-04" from milliseconds, or "an unknown date". */
export function dayOf(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'an unknown date'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
