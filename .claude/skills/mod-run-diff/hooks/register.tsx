import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Comparison } from '../types/index.d.ts'
import { asCounts, compare, entryFrom, parseCounts, parseScripts, reportPathFrom } from './counts.ts'
import { config } from './config.ts'

const PANE = 'run-diff'
const last = atom({ plugin: 'mod-run-diff', key: 'last' } as const, null)

async function openPane($: EngineInterface, id: string, title: string, fallback: string) {
  const opened = await $.ui.open({ id, title })
  if (!opened.isPlaced) $.ui.toast(fallback)
  return opened.isPlaced
}

async function entryPoints($: EngineInterface): Promise<string[]> {
  try {
    const repo = await $.session.repo()
    const path = repo === null ? 'pyproject.toml' : `${repo.root}/pyproject.toml`
    const text = await $.fs.read(path)
    if (typeof text === 'string') {
      const names = parseScripts(text)
      if (names.length > 0) return names
    }
  } catch {
    // fall through to the configured list
  }
  return [...config.fallbackEntryPoints]
}

function outputOf(ran: { text?: string; result?: unknown }): string {
  if (typeof ran.text === 'string') return ran.text
  const r = ran.result
  if (typeof r === 'string') return r
  if (typeof r === 'object' && r !== null) {
    const o = r as { stdout?: unknown; stderr?: unknown }
    return [o.stdout, o.stderr].filter(x => typeof x === 'string').join('\n')
  }
  return ''
}

async function observe($: EngineInterface, entry: string, output: string) {
  const name = $.plugin.name
  let counts = parseCounts(output)
  const reportPath = reportPathFrom(output)
  if (reportPath !== undefined) {
    try {
      const report = await $.fs.read(reportPath)
      if (typeof report === 'string') counts = { ...counts, ...parseCounts(report) }
    } catch {
      // the log lines alone are used
    }
  }
  if (Object.keys(counts).length === 0) {
    $.ui.toast(`${name}: no counts found in the output of ${entry}, so nothing was compared and the baseline is unchanged`)
    return
  }
  const before = asCounts(await $.store.get(`baseline:${entry}`))
  const comparison = compare(entry, before, counts, config.dropThresholdPercent)
  await $.store.set(`baseline:${entry}`, counts)
  await $.store.set('last', comparison)
  await update($, last, () => comparison)
  if (comparison.isBaseline) {
    $.ui.toast(`${name}: no baseline yet for ${entry}: stored this run as the baseline`)
  } else {
    const hint = comparison.flaggedCount > 0 ? ', see /rundiff' : ''
    $.ui.toast(`${name}: ${entry}: ${comparison.changes.length} changes, ${comparison.flaggedCount} flagged${hint}`)
  }
}

async function lastComparison($: EngineInterface): Promise<Comparison | null> {
  const held = await read($, last)
  if (held !== null) return held
  const stored = await $.store.get('last')
  if (typeof stored === 'object' && stored !== null) {
    const c = stored as Comparison
    await update($, last, () => c)
    return c
  }
  return null
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    let entry: string | undefined
    try {
      const found = entryFrom(e.command, await entryPoints($))
      if (found === 'several') {
        const ran = await next(e)
        if (ran.deny === undefined && ran.isError !== true) {
          $.ui.toast(`${$.plugin.name}: several entry points ran in one command, so their output was not compared`)
        }
        return ran
      }
      entry = found
    } catch {
      entry = undefined
    }
    const ran = await next(e)
    if (entry === undefined || ran.deny !== undefined || ran.isError === true) return ran
    try {
      await observe($, entry, outputOf(ran))
    } catch {
      // an observer never breaks the call
    }
    return ran
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'rundiff', description: 'Show how the last pipeline run compares with the one before' })
    return r
  })

  on('command.run', { command: 'rundiff' }, async $ => {
    const c = await lastComparison($)
    if (c === null) return { text: 'No pipeline run has been seen yet' }
    await openPane($, PANE, 'Run diff', 'mod-run-diff: widen the terminal to see the run diff')
    return { text: c.isBaseline ? `${c.entry}: no baseline yet, nothing compared` : `${c.entry}: ${c.changes.length} changes, ${c.flaggedCount} flagged` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const c = await lastComparison($)
    if (c === null) return <Text dimColor>No pipeline run has been seen yet.</Text>
    const shown = c.changes.slice(0, config.maxRows)
    const more = c.changes.length - shown.length
    return (
      <Box flexDirection="column">
        <Text bold>Run diff: {c.entry}</Text>
        {c.isBaseline ? (
          <Text>No baseline yet: stored this run as the baseline. Nothing was compared.</Text>
        ) : (
          <Text>
            {c.changes.length} changes, {c.flaggedCount} flagged (drop threshold {c.thresholdPercent} percent)
          </Text>
        )}
        {!c.isBaseline && c.changes.length === 0 && <Text dimColor>Every reported count matches the previous run.</Text>}
        {shown.map((x, i) => (
          <Text key={`c${i}`} color={x.isFlagged ? 'red' : undefined} dimColor={!x.isFlagged}>
            {x.isFlagged ? '! ' : '  '}
            {x.key}: {x.before ?? 'none'} to {x.after ?? 'none'}
            {x.dropPercent !== null ? ` (-${x.dropPercent.toFixed(1)}%)` : ''} {x.reason}
          </Text>
        ))}
        {more > 0 && <Text dimColor>{more} more changes</Text>}
        <Box>
          <Button key="close" label="Close" hotkey="c" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
