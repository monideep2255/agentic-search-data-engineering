import { config } from './config.ts'

export type Finding = { line: number; rule: 'sql-string-building' | 'logs-secret-name' }

const KEYWORDS = new RegExp('\\b(' + config.queryKeywords.join('|') + ')\\b')
const SECRETS = new RegExp('(' + config.secretNames.join('|') + ')', 'i')

function lineOf(text: string, index: number): number {
  let n = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

// Query strings built by formatting: an f-string with a placeholder, a string
// followed by the % operator, or a string followed by .format(.
// Note: Apache AGE passes Cypher through cypher() as a string, so some string
// building is expected in the loader. That is why this only warns.
function sqlFindings(text: string): Finding[] {
  const out: Finding[] = []
  const fstring = /(?<![A-Za-z0-9_])(?:[fF][rR]?|[rR][fF])("""|'''|"|')((?:\\.|(?!\1)[\s\S])*)\1/g
  for (const m of text.matchAll(fstring)) {
    if (KEYWORDS.test(m[2]) && /\{[^{}]+\}/.test(m[2].replace(/\{\{|\}\}/g, ''))) out.push({ line: lineOf(text, m.index ?? 0), rule: 'sql-string-building' })
  }
  const plain = /(?<![A-Za-z0-9_])(["'])((?:\\.|(?!\1).)*)\1\s*(%\s*[(\w]|\.format\s*\()/g
  for (const m of text.matchAll(plain)) {
    if (KEYWORDS.test(m[2])) out.push({ line: lineOf(text, m.index ?? 0), rule: 'sql-string-building' })
  }
  return out
}

// The text of a call from its opening parenthesis to the matching one.
function callBody(text: string, open: number): string {
  let depth = 0
  for (let i = open; i < text.length && i < open + 600; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(open, i + 1) }
  }
  return text.slice(open, open + 600)
}

// Keep only code names: plain string literals are dropped, f-string literals keep their {placeholders}.
function codeNames(args: string): string {
  return args.replace(/([fF][rR]?|[rR][fF])?("""|'''|"|')((?:\\.|(?!\2)[\s\S])*)\2/g, (_all, prefix, _q, body: string) =>
    prefix ? (body.match(/\{[^{}]*\}/g) ?? []).join(' ') : ' ',
  )
}

function loggingFindings(text: string): Finding[] {
  const out: Finding[] = []
  const call = /(?<![A-Za-z0-9_.])(?:(?:log|logger|logging)\.[A-Za-z_]+|print)\(/g
  for (const m of text.matchAll(call)) {
    const open = (m.index ?? 0) + m[0].length - 1
    if (SECRETS.test(codeNames(callBody(text, open)))) out.push({ line: lineOf(text, m.index ?? 0), rule: 'logs-secret-name' })
  }
  return out
}

export function scan(text: string): Finding[] {
  const seen = new Set<string>()
  return [...sqlFindings(text), ...loggingFindings(text)]
    .sort((a, b) => a.line - b.line)
    .filter(f => !seen.has(f.line + f.rule) && seen.add(f.line + f.rule))
}

/** True for a Python file under one of the scanned folders; returns the path from that folder on. */
export function scannedPath(path: string): string | undefined {
  if (!path.endsWith('.py')) return undefined
  for (const root of config.roots) {
    const i = path.indexOf('/' + root)
    if (i !== -1) return path.slice(i + 1)
    if (path.startsWith(root)) return path
  }
  return undefined
}
