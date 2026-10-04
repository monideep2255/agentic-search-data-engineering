import type { EngineInterface, Register } from 'claude-code'
import { config } from './config.ts'
import { scan, scannedPath } from './scan.ts'

// An observer: it lets the call run first, then warns. It never denies and has
// no .catch, so if it breaks it is skipped. Everything after next() is wrapped
// so a failure here can never make the engine run the edit a second time.
async function warn($: EngineInterface, path: string, text: string, startLine: number) {
  const shown = scannedPath(path)
  if (!shown) return
  const findings = scan(text)
  for (const f of findings.slice(0, config.maxFindings)) {
    $.ui.toast(`${shown}:${f.line + startLine - 1} ${f.rule}`)
  }
  if (findings.length > config.maxFindings) $.ui.toast(`${findings.length - config.maxFindings} more findings not shown`)
}

// First line of the edited text inside the file as it now stands (1 when it cannot be found).
async function startLineOf($: EngineInterface, path: string, text: string): Promise<number> {
  try {
    const whole = await $.fs.read(path)
    if (typeof whole !== 'string') return 1
    const at = whole.indexOf(text)
    return at < 0 ? 1 : whole.slice(0, at).split('\n').length
  } catch {
    return 1
  }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      if (scannedPath(e.file_path)) await warn($, e.file_path, e.new_string, await startLineOf($, e.file_path, e.new_string))
    } catch {
      // stay quiet: a warning is never worth disturbing the edit
    }
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      await warn($, e.file_path, e.content, 1)
    } catch {
      // stay quiet
    }
    return ran
  })
}
