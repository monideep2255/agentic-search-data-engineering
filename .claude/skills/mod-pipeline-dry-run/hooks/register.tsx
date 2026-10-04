import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { DryRunReport } from '../types/index.d.ts'
import { directories, plan, showArgs } from './plan.ts'

const PANE = 'pipeline-dry-run'
const report = atom({ plugin: 'mod-pipeline-dry-run', key: 'report' } as const, null as DryRunReport)

function denyOnFailure($: EngineInterface) {
  return { deny: `${$.plugin.name}: the guard failed while checking this call, so it was held. Retry, or ask the person to run it.` }
}

// Ask the person; anything other than exactly Proceed, or a dismissal, is Cancel.
// The wait happens inside $.ui.ask, so it never counts against the hook's budget.
async function confirm($: EngineInterface, question: string, header: string): Promise<boolean> {
  try {
    const answer = await $.ui.ask(question, { header, options: ['Proceed', 'Cancel'] })
    return answer === 'Proceed'
  } catch {
    return false // dismissed, or no one to ask
  }
}

// Files directly inside a directory, or "does not exist". Never rejects.
async function describeDir($: EngineInterface, root: string, path: string): Promise<string> {
  const full = path.startsWith('/') ? path : `${root}/${path}`
  try {
    const entries = await $.fs.list(full)
    const files = entries.filter(x => x.kind === 'file').length
    return `${path}: exists, ${files} files`
  } catch {
    return `${path}: does not exist`
  }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const calls = plan(e.command)
    if (calls.length === 0) return next(e)

    const repo = await $.session.repo().catch(() => null)
    const root = repo?.root ?? (await $.session.cwd())
    const lines: string[] = []
    for (const p of calls) {
      const dirs = directories(p)
      lines.push(`Entry point: ${p.entry}`, `Arguments: ${showArgs(p.args) || '(none)'}`)
      if (dirs.overrides.length) lines.push(`Overrides: ${dirs.overrides.join(', ')}`)
      lines.push('Reads:')
      for (const d of dirs.reads) lines.push('  ' + (await describeDir($, root, d)))
      lines.push('Writes:')
      for (const d of dirs.writes) lines.push('  ' + (await describeDir($, root, d)))
      if (dirs.writes.length === 0) lines.push('  (database only, no files)')
      lines.push('')
    }

    await update($, report, () => ({ lines, isBand: false }))
    const opened = await $.ui.open({ id: PANE, title: 'Pipeline dry run' })
    if (!opened.isPlaced) await update($, report, () => ({ lines, isBand: true }))

    const names = calls.map(c => c.entry).join(', ')
    const ok = await confirm($, `Run ${names}? The report lists the directories it will use.`, 'Pipeline run')
    await $.ui.close({ id: PANE }).catch(() => undefined)
    await update($, report, () => null)

    return ok ? next(e) : { deny: `${$.plugin.name}: the person cancelled ${names}. Do not retry it; ask what to change first.` }
  }).catch(denyOnFailure)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, report)
    return (
      <Box flexDirection="column">
        {(r?.lines ?? ['No pipeline run is waiting.']).map(l => <Text>{l}</Text>)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, report)
    if (!r || !r.isBand || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {r.lines.slice(0, Math.max(1, e.props.maxRows - 1)).map(l => <Text>{l}</Text>)}
      </Box>
    )
  })
}
