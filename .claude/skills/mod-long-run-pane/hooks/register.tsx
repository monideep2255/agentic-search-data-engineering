import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RunView } from '../types/index.d.ts'
import { config } from './config.ts'
import { applyLine, clock, emptyCounters, parseScripts, splitLines } from './progress.ts'
import { words } from './kit/shell.ts'

const PANE = 'long-run'
const run = atom({ plugin: 'mod-long-run-pane', key: 'run' } as const, null)

// The live stream of the one run, so Stop can end it. Not state: it cannot be serialized.
let current: { return: (value?: never) => Promise<unknown> } | undefined

async function openPane($: EngineInterface, id: string, title: string, fallback: string) {
  const opened = await $.ui.open({ id, title })
  if (!opened.isPlaced) $.ui.toast(fallback)
  return opened.isPlaced
}

async function entryPoints($: EngineInterface): Promise<string[] | undefined> {
  try {
    const repo = await $.session.repo()
    const text = await $.fs.read(repo === null ? 'pyproject.toml' : `${repo.root}/pyproject.toml`)
    return typeof text === 'string' ? parseScripts(text) : undefined
  } catch {
    return undefined
  }
}

async function patch($: EngineInterface, change: (r: RunView) => RunView) {
  await update($, run, r => (r === null ? r : change(r)))
}

async function requestStop($: EngineInterface) {
  const r = await read($, run)
  if (r === null || r.status !== 'running') return
  await patch($, x => ({ ...x, isStopRequested: true, note: 'Stopping' }))
  const stream = current
  if (stream !== undefined) stream.return().catch(() => undefined)
}

async function drive($: EngineInterface, argv: string[], startedAt: number) {
  const name = $.plugin.name
  const timer = $.clock.every(1000, () => {
    void (async () => {
      const now = await $.clock.now()
      await patch($, r => (r.status === 'running' ? { ...r, elapsedSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)) } : r))
    })()
  })
  let pending = ''
  let code: number | null = null
  let status: RunView['status'] = 'finished'
  let note = ''
  const take = async (lines: string[]) => {
    if (lines.length === 0) return
    await patch($, r => {
      let counters = r.counters
      for (const l of lines) counters = applyLine(counters, l)
      return { ...r, counters, lines: [...r.lines, ...lines].slice(-config.maxLines) }
    })
  }
  try {
    const stream = $.process.spawn({ argv })
    current = stream as unknown as typeof current
    while (true) {
      const step = await stream.next()
      if (step.done === true) {
        code = step.value.code
        if (step.value.signal !== null) note = `Ended by signal ${step.value.signal}`
        break
      }
      const r = await read($, run)
      if (r !== null && r.isStopRequested) {
        status = 'stopped'
        await stream.return(undefined as never)
        break
      }
      const split = splitLines(pending, step.value.text)
      pending = split.rest
      await take(split.lines)
    }
  } catch (err) {
    status = 'failed'
    note = `Could not run: ${err instanceof Error ? err.message : String(err)}`
  }
  current = undefined
  timer.cancel()
  if (pending.trim() !== '') await take([pending])
  const wasStopped = (await read($, run))?.isStopRequested === true
  if (wasStopped) status = 'stopped'
  if (status === 'finished' && code !== 0) status = 'failed'
  const now = await $.clock.now()
  await patch($, r => ({
    ...r,
    status,
    exitCode: code,
    note: status === 'stopped' ? 'Stopped by you' : note,
    elapsedSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)),
  }))
  const entry = argv[config.launcher.length]
  if (status === 'stopped') $.ui.toast(`${name}: ${entry} stopped`)
  else if (status === 'failed') $.ui.toast(`${name}: ${entry} failed${code === null ? '' : ` with exit code ${code}`}`)
  else $.ui.toast(`${name}: ${entry} finished with exit code ${code}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await update($, run, () => null)
    await $.command.register({ name: 'longrun', description: 'Run a pipeline entry point and stream its progress: /longrun <entry point> [args]' })
    return r
  })

  on('command.run', { command: 'longrun' }, async ($, e) => {
    const name = $.plugin.name
    const given = words(e.args)
    const entries = await entryPoints($)
    if (entries === undefined) return { text: `${name}: could not read the entry point list from pyproject.toml, so nothing was started` }
    const held = await read($, run)
    if (given.length === 0) {
      if (held !== null) {
        await openPane($, PANE, 'Long run', `${name}: widen the terminal to see the run`)
        return { text: `Showing the ${held.status} run of ${held.entry}` }
      }
      return { text: `Usage: /longrun <entry point> [args]. Entry points: ${entries.join(', ')}` }
    }
    const entry = given[0]
    if (!entries.includes(entry)) {
      return { text: `${name}: "${entry}" is not an entry point in pyproject.toml. Choose one of: ${entries.join(', ')}` }
    }
    if (held !== null && held.status === 'running') {
      return { text: `${name}: ${held.entry} is still running. Stop it first, since only one run is allowed at a time` }
    }
    const placed = await openPane($, PANE, 'Long run', `${name}: widen the terminal to see the run`)
    if (!placed) return { text: `${name}: the pane could not be shown, so nothing was started` }
    const args = given.slice(1)
    const startedAt = await $.clock.now()
    await update($, run, () => ({
      entry,
      args,
      status: 'running',
      startedAt,
      elapsedSeconds: 0,
      lines: [],
      counters: emptyCounters(),
      exitCode: null,
      isStopRequested: false,
      note: '',
    }))
    void drive($, [...config.launcher, entry, ...args], startedAt)
    return { text: `Started ${entry}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const r = await read($, run)
    if (r === null) return <Text dimColor>No run yet. Use /longrun with an entry point.</Text>
    const c = r.counters
    const shown = (n: number | null) => (n === null ? 'not reported' : n.toLocaleString('en-US'))
    return (
      <Box flexDirection="column">
        <Text bold>
          {r.entry} {r.args.join(' ')}
        </Text>
        <Text>
          {r.status === 'running' ? 'Running' : r.status === 'finished' ? 'Finished' : r.status === 'stopped' ? 'Stopped' : 'Failed'}, elapsed {clock(r.elapsedSeconds)}
          {r.status !== 'running' && r.exitCode !== null ? `, exit code ${r.exitCode}` : ''}
          {r.status !== 'running' && r.exitCode === null ? ', no exit code' : ''}
        </Text>
        {r.note !== '' && <Text dimColor>{r.note}</Text>}
        <Text>
          Rows written {shown(c.written)}, rejected {shown(c.rejected)}, dangling {shown(c.dangling)}
        </Text>
        {r.lines.map((line, i) => (
          <Text key={`l${i}`} dimColor>
            {line}
          </Text>
        ))}
        <Box>
          {r.status === 'running' && <Button key="stop" label="Stop" hotkey="s" onPress={() => requestStop($)} />}
          <Button key="close" label="Close" hotkey="c" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
