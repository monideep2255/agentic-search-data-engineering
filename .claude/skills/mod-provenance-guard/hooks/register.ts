import type { EngineInterface, Register } from 'claude-code'
import { config } from './config.ts'

type Finding = { line: number | null; what: string }

const ROOT = `/${config.pipelineRoot}/`

function relative(path: string): string {
  const i = path.indexOf(ROOT)
  return i === -1 ? path : path.slice(i + 1)
}

function isCheckedFile(path: string): boolean {
  if (!path.endsWith('.py') || !path.includes(ROOT)) return false
  const rel = relative(path)
  const name = rel.split('/').pop() ?? ''
  if (rel.split('/').includes('tests') || name.startsWith('test_') || name.endsWith('_test.py') || name === 'conftest.py') return false
  return true
}

function isMergeFile(path: string): boolean {
  const rel = relative(path)
  return config.mergePaths.some(p => (p.endsWith('/') ? rel.startsWith(p) : rel === p))
}

// Counts of a field written by assignment, keyword argument, subscript assignment, or dict key.
function countWrites(text: string, field: string, withDictKeys: boolean): number {
  const assign = new RegExp(`(?<![\\w])${field}\\s*=(?!=)`, 'g')
  const subscript = new RegExp(`["']${field}["']\\]\\s*=(?!=)`, 'g')
  const dictKey = new RegExp(`["']${field}["']\\s*:`, 'g')
  let n = (text.match(assign)?.length ?? 0) + (text.match(subscript)?.length ?? 0)
  if (withDictKeys) n += text.match(dictKey)?.length ?? 0
  return n
}

function lineOf(text: string, needle: string): number | null {
  if (!needle) return null
  const i = text.indexOf(needle)
  return i === -1 ? null : text.slice(0, i).split('\n').length
}

function compare(path: string, before: string, after: string, locate: (field: string) => number | null): Finding[] {
  const found: Finding[] = []
  for (const field of config.fields) {
    const was = countWrites(before, field, true)
    const now = countWrites(after, field, true)
    if (now < was) found.push({ line: locate(field), what: `${field} was removed and not re-added` })
  }
  if (isMergeFile(path)) {
    for (const field of config.fields) {
      if (countWrites(after, field, false) > countWrites(before, field, false)) {
        found.push({ line: locate(field), what: `merge code assigns ${field}, downstream code must never rewrite provenance` })
      }
    }
  }
  return found
}

async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  try {
    const r = await $.fs.read(path)
    return typeof r === 'string' ? r : ''
  } catch {
    return ''
  }
}

function warn($: EngineInterface, path: string, findings: Finding[]) {
  for (const f of findings) $.ui.toast(`provenance: ${relative(path)}:${f.line ?? '?'} ${f.what}`)
}

export const register: Register = on => {
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!isCheckedFile(e.file_path)) return next(e)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const after = await readOrEmpty($, e.file_path)
    const findings = compare(e.file_path, e.old_string, e.new_string, () => lineOf(after, e.new_string))
    warn($, e.file_path, findings)
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!isCheckedFile(e.file_path)) return next(e)
    const before = await readOrEmpty($, e.file_path)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const findings = compare(e.file_path, before, e.content, field => {
      const m = before.split('\n').findIndex(l => countWrites(l, field, true) > 0)
      return m === -1 ? null : m + 1
    })
    warn($, e.file_path, findings)
    return ran
  })
}
