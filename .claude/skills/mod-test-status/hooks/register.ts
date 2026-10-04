import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { basename, programs } from './kit/shell.ts'
import { config } from './config.ts'

import type { TestRun } from '../types/index.d.ts'

const run = atom({ plugin: 'mod-test-status', key: 'run' } as const, null)
const lastEditAt = atom({ plugin: 'mod-test-status', key: 'lastEditAt' } as const, null)

// The pytest words of a simple command, or undefined when it is not pytest.
function pytestArgs(words: string[]): string[] | undefined {
  // `uv run pytest`, `poetry run pytest` and `pipenv run pytest` run the next word as the program.
  let p = words
  if (p.length > 1 && ['uv', 'poetry', 'pipenv'].includes(basename(p[0])) && p[1] === 'run') {
    let at = 2
    while (at < p.length && p[at].startsWith('-')) at++
    p = p.slice(at)
    if (p.length === 0) return undefined
  }
  const first = basename(p[0])
  if (first === 'pytest' || first === 'py.test') return p.slice(1)
  if (/^python[\d.]*$/.test(first) && p[1] === '-m' && (p[2] === 'pytest' || p[2] === 'py.test')) return p.slice(3)
  return undefined
}

function markerExpression(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-m') return args[i + 1] ?? null
    if (a.startsWith('-m=')) return a.slice(3)
    if (/^-m.+/.test(a) && !a.startsWith('--')) return a.slice(2)
  }
  return null
}

function parseSummary(text: string): { passed: number; failed: number; skipped: number; deselected: number } | null {
  const lines = text.split('\n').reverse()
  for (const line of lines) {
    if (!/\b(passed|failed|skipped|errors?)\b/.test(line) || !/\bin [\d.]+s\b/.test(line)) continue
    const count = (word: string) => {
      const m = line.match(new RegExp(`(\\d+) ${word}\\b`))
      return m ? Number(m[1]) : 0
    }
    return { passed: count('passed'), failed: count('failed') + count('errors?'), skipped: count('skipped'), deselected: count('deselected') }
  }
  return null
}

async function declaredSlowMarkers($: EngineInterface): Promise<string[]> {
  try {
    const repo = await $.session.repo()
    const text = await $.fs.read(`${repo.root}/${config.pyproject}`)
    if (typeof text !== 'string') return config.slowMarkers
    const block = text.match(/markers\s*=\s*\[([\s\S]*?)\]/)
    if (!block) return config.slowMarkers
    const declared = [...block[1].matchAll(/["']\s*([A-Za-z_][\w]*)\s*[:"']/g)].map(m => m[1])
    const slow = config.slowMarkers.filter(m => declared.includes(m))
    return slow.length > 0 ? slow : config.slowMarkers
  } catch {
    return config.slowMarkers
  }
}

function isQuick(markers: string | null, slow: string[]): boolean {
  if (!markers) return false
  return slow.some(m => new RegExp(`\\bnot\\s+${m}\\b`).test(markers))
}

async function render($: EngineInterface) {
  const r = (await read($, run)) as TestRun | null
  if (!r) return
  const edited = (await read($, lastEditAt)) as number | null
  const slow = await declaredSlowMarkers($)
  const minutes = Math.max(0, Math.floor(((await $.clock.now()) - r.at) / 60_000))
  const age = minutes < 1 ? 'just now' : `${minutes}m ago`
  const stale = edited !== null && edited > r.at ? ' stale' : ''
  $.ui.status(`tests: ${r.passed} passed, ${r.failed} failed (${isQuick(r.markers, slow) ? 'quick' : (r.deselected ?? 0) > 0 ? 'filtered' : 'full'}, ${age})${stale}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(config.refreshMs, () => { void render($) })
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const calls = programs(e.command).map(pytestArgs).filter((a): a is string[] => a !== undefined)
    const ran = await next(e)
    if (calls.length === 0 || ran.deny !== undefined || typeof ran.text !== 'string') return ran
    const summary = parseSummary(ran.text)
    if (!summary) return ran
    const at = await $.clock.now()
    const entry: TestRun = { ...summary, markers: markerExpression(calls[calls.length - 1]), at }
    await update($, run, () => entry)
    await render($)
    return ran
  })

  for (const tool of ['Edit', 'Write'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)
      if (e.file_path.endsWith('.py') && ran.deny === undefined && ran.isError !== true) {
        const now = await $.clock.now()
        await update($, lastEditAt, () => now)
      }
      await render($)
      return ran
    })
  }
}
