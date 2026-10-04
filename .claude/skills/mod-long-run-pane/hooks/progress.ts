import type { Counters } from '../types'

const LOG_PREFIX = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[,.]\d+)?\s+\S+\s+[A-Z]+\s+/
const WRITTEN_PAIR = /(?:^|[\s(,_])(?:nodes|edges|rows|records|rows_written|written)=(\d[\d,]*)/gi
const WRITTEN_PHRASE = /(\d[\d,]*)\s+(?:[A-Za-z]+\s+){0,2}?(?:nodes|edges|rows|records)\b/gi
const REJECTED_AFTER = /rejected(?:_rows)?\s*[=:]\s*(\d[\d,]*)/i
const REJECTED_BEFORE = /(\d[\d,]*)\s+(?:rows?\s+)?rejected/i
const DANGLING = /dangling(?:_[a-z]+)?\s*[=:]\s*(\d[\d,]*)/i

function num(text: string): number {
  return Number(text.replace(/,/g, ''))
}

export function emptyCounters(): Counters {
  return { written: null, rejected: null, dangling: null }
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
 * Updates the counters from one log line. Logs report running totals, so
 * a figure only replaces the old one when it is larger, except that
 * rejected and dangling take the latest value because a validation line
 * states the final count.
 */
export function applyLine(counters: Counters, rawLine: string): Counters {
  const line = rawLine.replace(LOG_PREFIX, '')
  let written = counters.written
  const seen: number[] = []
  for (const m of line.matchAll(WRITTEN_PAIR)) seen.push(num(m[1]))
  for (const m of line.matchAll(WRITTEN_PHRASE)) seen.push(num(m[1]))
  for (const n of seen) if (written === null || n > written) written = n
  let rejected = counters.rejected
  const r = REJECTED_AFTER.exec(line) ?? REJECTED_BEFORE.exec(line)
  if (r !== null) rejected = num(r[1])
  let dangling = counters.dangling
  const d = DANGLING.exec(line)
  if (d !== null) dangling = num(d[1])
  return { written, rejected, dangling }
}

/** Splits a stream chunk into whole lines and the unfinished remainder. */
export function splitLines(pending: string, text: string): { lines: string[]; rest: string } {
  const parts = (pending + text).split(/\r\n|\n|\r/)
  const rest = parts.pop() ?? ''
  return { lines: parts.filter(l => l.trim() !== ''), rest }
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
