import { programs, basename } from './kit/shell.ts'
import { matchesAny } from './kit/paths.ts'
import { config } from './config.ts'

export type Requested = { name: string; spec: string; pinned?: string }

// Options that take a value, so the value is not mistaken for a package.
const VALUE_FLAGS = new Set([
  '-r', '--requirement', '-e', '--editable', '-c', '--constraint', '-i', '--index-url', '--extra-index-url',
  '-f', '--find-links', '-t', '--target', '--python', '--prefix', '--root', '--group', '-G', '--extra',
  '--platform', '--python-version', '--implementation', '--abi', '--src', '--cache-dir', '--index', '--default-index',
])

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*/

/** Parse one requirement such as `requests[socks]>=2.0 ; python_version>"3"`. Undefined when it is not a plain package. */
export function parseSpec(raw: string): Requested | undefined {
  let s = raw.split(';')[0].trim()
  if (!s || s.includes('://') || s.startsWith('git+') || s.includes('/') || /\.(whl|tar\.gz|zip)$/.test(s)) return undefined
  const m = s.match(NAME)
  if (!m) return undefined
  const name = m[0]
  s = s.slice(name.length).replace(/^\[[^\]]*\]/, '').trim().replace(/^@\s*/, '')
  const pin = s.match(/^===?\s*([0-9][^\s,*]*)$/)
  return { name, spec: s, pinned: pin ? pin[1] : undefined }
}

const INSTALL: Record<string, (p: string[]) => number> = {
  pip: p => (p[1] === 'install' ? 2 : -1),
  pip3: p => (p[1] === 'install' ? 2 : -1),
  uv: p => (p[1] === 'add' ? 2 : p[1] === 'pip' && p[2] === 'install' ? 3 : -1),
  poetry: p => (p[1] === 'add' ? 2 : -1),
}

/** Packages named on the command line by install or add commands. */
export function fromCommand(command: string): Requested[] {
  const out: Requested[] = []
  for (const p of programs(command)) {
    let q = p
    const base = basename(p[0])
    if (/^python[0-9.]*$/.test(base) && p[1] === '-m' && (p[2] === 'pip' || p[2] === 'pip3')) q = p.slice(2)
    else if ((base === 'uv' || base === 'poetry') && p[1] === 'run') continue
    const start = INSTALL[basename(q[0])]?.(q) ?? -1
    if (start < 0) continue
    for (let i = start; i < q.length; i++) {
      const w = q[i]
      if (w.startsWith('-')) {
        if (VALUE_FLAGS.has(w)) i++
        continue
      }
      const r = parseSpec(w)
      if (r) out.push(r)
    }
  }
  return out
}

/** True for a path this mod treats as a dependency file. */
export function isDependencyFile(path: string): 'requirements' | 'pyproject' | undefined {
  if (basename(path) === config.projectFile) return 'pyproject'
  if (matchesAny(basename(path), config.requirementFiles)) return 'requirements'
  return undefined
}

/** Dependencies on lines present in `after` and absent from `before`. */
export function addedDependencies(kind: 'requirements' | 'pyproject', before: string, after: string): Requested[] {
  const had = new Set(before.split('\n').map(l => l.trim()))
  const out: Requested[] = []
  for (const line of after.split('\n')) {
    const t = line.trim()
    if (!t || had.has(t) || t.startsWith('#')) continue
    if (kind === 'requirements') {
      if (t.startsWith('-')) continue
      const r = parseSpec(t.split(/\s+#/)[0])
      if (r) out.push(r)
    } else {
      // Only quoted array items that carry a version operator count, so
      // metadata such as keywords is not mistaken for a dependency.
      const m = t.match(/^"([^"]+)"\s*,?\s*(#.*)?$/)
      if (m && /[<>=~!]/.test(m[1])) {
        const r = parseSpec(m[1])
        if (r) out.push(r)
      }
    }
  }
  return out
}
