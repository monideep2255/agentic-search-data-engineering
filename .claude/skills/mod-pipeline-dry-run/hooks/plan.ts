import { segments, words, basename } from './kit/shell.ts'
import { config } from './config.ts'

export type Planned = { entry: string; args: string[]; env: Record<string, string> }

const LEADERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'nice', 'caffeinate', 'uv', 'poetry', 'pipenv', 'run'])
const HELP = new Set(['--help', '-h', '--version'])
const SECRET_FLAGS = new Set(['--dsn'])

function isLeader(w: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || w.startsWith('-') || LEADERS.has(w)
}

function envOf(prefix: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const w of prefix) {
    const m = w.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s)
    if (m) env[m[1]] = m[2]
  }
  return env
}

function entryForModule(module: string): string | undefined {
  for (const [name, row] of Object.entries(config.entryPoints)) {
    if (row.modules.some(m => module === m || module.endsWith('.' + m))) return name
  }
  return undefined
}

/** Every ETL entry point a command line starts, with its arguments. Help and version calls are left out. */
export function plan(command: string): Planned[] {
  const found: Planned[] = []
  for (const seg of segments(command)) {
    const ws = words(seg)
    for (let i = 0; i < ws.length; i++) {
      const name = basename(ws[i])
      let entry: string | undefined
      let args: string[] = []
      if (config.entryPoints[name]) {
        entry = name
        args = ws.slice(i + 1)
      } else if (/^(python[0-9.]*|py)$/.test(name)) {
        const k = ws.indexOf('-m', i + 1)
        if (k !== -1 && k <= i + 3 && ws[k + 1]) {
          entry = entryForModule(ws[k + 1])
          args = ws.slice(k + 2)
        }
      }
      if (entry) {
        if (ws.slice(0, i).every(isLeader) && !args.some(a => HELP.has(a))) {
          found.push({ entry, args, env: envOf(ws.slice(0, i)) })
        }
        break
      }
      if (!isLeader(ws[i])) break
    }
  }
  return found
}

/** The value of a long option written `--name value` or `--name=value`. */
export function option(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) return args[i + 1]
    if (args[i].startsWith(name + '=')) return args[i].slice(name.length + 1)
  }
  return undefined
}

/** Arguments as shown to the person, with secret values hidden. */
export function showArgs(args: string[]): string {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const flag = a.split('=')[0]
    if (SECRET_FLAGS.has(flag)) {
      out.push(a.includes('=') ? flag + '=<hidden>' : a)
      if (!a.includes('=') && i + 1 < args.length) { out.push('<hidden>'); i++ }
    } else out.push(a)
  }
  const text = out.join(' ')
  return text.length > 160 ? text.slice(0, 157) + '...' : text
}

export type Dirs = { reads: string[]; writes: string[]; overrides: string[] }

/** Directories one planned call uses, with environment and argument overrides applied. */
export function directories(p: Planned): Dirs {
  const row = config.entryPoints[p.entry]
  const overrides: string[] = []
  const pick = (key: 'data' | 'ftp_cache' | 'kgx' | 'raw', fallback: string) => {
    const name = config.envNames[key]
    const value = p.env[name]
    if (value) { overrides.push(`${name}=${value}`); return value }
    return fallback
  }
  const data = pick('data', config.defaults.data)
  const sub = (tpl: string) => tpl.replace('{data}', data)
  const ftp = pick('ftp_cache', sub(config.defaults.ftp_cache))
  const kgx = pick('kgx', sub(config.defaults.kgx))
  const fill = (tpl: string) => tpl.replace('{ftp_cache}', ftp).replace('{kgx}', kgx).replace('{data}', data)
  const reads = row.reads.map(fill)
  const writes = row.writes.map(fill)
  if (row.isMerge) {
    const dbs = (option(p.args, '--databases') ?? config.mergeDatabases.join(',')).split(',').map(s => s.trim()).filter(Boolean)
    const subdir = option(p.args, '--output-subdir')
    if (subdir) overrides.push(`--output-subdir=${subdir}`)
    if (option(p.args, '--databases')) overrides.push('--databases')
    for (const db of dbs) reads.push(`${kgx}/${db}`)
    writes.push(`${kgx}/${subdir ?? config.mergeDefaultSubdir}`)
  }
  if (row.isLoader) {
    const dir = option(p.args, '--kgx-dir')
    if (dir) overrides.push(`--kgx-dir=${dir}`)
    reads.push(dir ?? '(--kgx-dir is required and was not given)')
  }
  if (row.downloads && !p.args.includes('--skip-download') && !writes.includes(ftp)) writes.push(ftp)
  return { reads, writes, overrides }
}
