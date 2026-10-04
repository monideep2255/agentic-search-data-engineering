import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { basename, segments, program } from './kit/shell.ts'
import { config } from './config.ts'

import type { DockerProbe } from '../types/index.d.ts'

const docker = atom({ plugin: 'mod-pytest-markers', key: 'docker' } as const, null)

// Launchers that run the next word as a program: `uv run pytest`, `poetry run pytest`, `pipenv run pytest`.
const RUNNERS = new Set(['uv', 'poetry', 'pipenv'])

// Index in the program words just after the pytest invocation, or -1 when it is not pytest.
function afterPytest(words: string[]): number {
  let start = 0
  if (words.length > 1 && RUNNERS.has(basename(words[0])) && words[1] === 'run') {
    start = 2
    while (start < words.length && words[start].startsWith('-')) start++
  }
  const p = words.slice(start)
  if (p.length === 0) return -1
  const first = basename(p[0])
  if (first === 'pytest' || first === 'py.test') return start + 1
  if (/^python[\d.]*$/.test(first) && p[1] === '-m' && (p[2] === 'pytest' || p[2] === 'py.test')) return start + 3
  return -1
}

// `tests`, `tests/` and `./tests` all name the configured test folder.
function normalize(path: string): string {
  return path.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
}

// A bare run has no marker option and names no specific test file or subfolder.
// The configured test folders count as bare.
function isBare(args: string[]): boolean {
  for (const a of args) {
    if (a === '-m' || a.startsWith('-m=') || (/^-m.+/.test(a) && !a.startsWith('--'))) return false
    if (a.startsWith('-')) continue
    if (config.testPaths.includes(normalize(a))) continue
    if (a.includes('.py') || a.includes('::') || a.includes('/')) return false
  }
  return true
}

// Returns the command with the filter added to the first bare pytest segment, or undefined.
function rewrite(command: string): string | undefined {
  for (const seg of segments(command)) {
    const p = program(seg)
    if (p.length === 0) continue
    const at = afterPytest(p)
    if (at === -1 || !isBare(p.slice(at))) continue
    const m = seg.match(/(?:^|\s)(\S*(?:pytest|py\.test))(?=\s|$)/)
    if (!m || m.index === undefined) continue
    const end = seg.indexOf(m[1], m.index) + m[1].length
    const edited = `${seg.slice(0, end)} -m "${config.filter}"${seg.slice(end)}`
    return command.replace(seg, edited)
  }
  return undefined
}

async function dockerIsUp($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  const cached = (await read($, docker)) as DockerProbe | null
  if (cached && now - cached.at < config.probeCacheMs) return cached.isUp
  let isUp: boolean
  try {
    const r = await $.process.run(['docker', 'info'], { timeoutMs: config.probeTimeoutMs })
    isUp = r.exitCode === 0
  } catch {
    isUp = false
  }
  await update($, docker, () => ({ isUp, at: now }))
  return isUp
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const changed = rewrite(e.command)
    if (changed === undefined) return next(e)
    if (await dockerIsUp($)) return next(e)
    $.ui.toast('Docker is down: skipped integration and docker tests. This run is partial, not a full pass.')
    return next({ ...e, command: changed })
  })
}
