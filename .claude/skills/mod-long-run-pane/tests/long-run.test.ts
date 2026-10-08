import { test, expect, mock } from 'claude-code/testing'
import { applyLine, clock, emptyCounters, parseScripts, splitLines } from '../hooks/progress.ts'

const TOML = `[project.scripts]
gene-etl = "a.b:main"
merge-etl = "c.d:main"

[tool.x]
y = 1
`

type Spawn = { argv: readonly string[] }

function world(on: any) {
  const w = { toasts: [] as string[], spawned: [] as Spawn[], toml: TOML as string | undefined, placed: true }
  on('fs.read', () => {
    if (w.toml === undefined) throw new Error('ENOENT')
    return { value: w.toml }
  })
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }) as never)
  on('ui.toast', (_: unknown, e: any) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: w.placed } }) as never)
  return w
}

function gate() {
  let open!: () => void
  const wait = new Promise<void>(r => { open = r })
  return { wait, open }
}

async function drawPane($: any) {
  return $.ui.mount({ plugin: 'mod-long-run-pane', surface: 'terminal', component: 'Pane', props: { title: 'Long run', isFocused: true }, requestId: 'long-run', viewport: { columns: 100, rows: 40 } })
}

test('pure helpers parse entry points, lines, and counters', () => {
  expect(parseScripts(TOML)).toEqual(['gene-etl', 'merge-etl'])
  expect(splitLines('par', 'tial\nnext\nhalf')).toEqual({ lines: ['partial', 'next'], rest: 'half' })
  let c = emptyCounters()
  c = applyLine(c, '2026-10-04 10:00:00,001 gene.pipeline INFO   gene_info: 1,000 gene nodes, 20 taxon edges so far')
  expect(c.written).toBe(1000)
  c = applyLine(c, 'edges=5000')
  expect(c.written).toBe(5000)
  c = applyLine(c, 'WARNING dangling=3 duplicates=0')
  expect(c.dangling).toBe(3)
  c = applyLine(c, 'rejected: 12')
  expect(c.rejected).toBe(12)
  c = applyLine(c, 'nothing to see')
  expect(c).toEqual({ written: 5000, rejected: 12, dangling: 3 })
  expect(clock(75)).toBe('01:15')
})

test('an unknown entry point is rejected and nothing is spawned', async ($, on) => {
  const w = world(on)
  mock.clock(on)
  on('process.spawn', async function* (_: unknown, e: any) { w.spawned.push(e); return { value: { code: 0, signal: null } } })
  const r = await $.command.run({ command: 'longrun', args: 'rm -rf /' })
  expect(r.text).toContain('is not an entry point')
  const r2 = await $.command.run({ command: 'longrun', args: 'gene-etl;ls' })
  expect(r2.text).toContain('is not an entry point')
  expect(w.spawned).toEqual([])
})

test('no arguments shows usage, and an unreadable list starts nothing', async ($, on) => {
  const w = world(on)
  mock.clock(on)
  expect((await $.command.run({ command: 'longrun', args: '' })).text).toContain('Usage: /longrun')
  w.toml = undefined
  expect((await $.command.run({ command: 'longrun', args: 'gene-etl' })).text).toContain('nothing was started')
})

test('a faked stream updates lines and counters, then shows the exit code', async ($, on) => {
  const w = world(on)
  const clk = mock.clock(on)
  const hold = gate()
  on('process.spawn', async function* (_: unknown, e: any) {
    w.spawned.push(e)
    yield { stream: 'stderr', text: '2026-10-04 10:00:00,001 gene.pipeline INFO gene_info: 1,000 gene nodes, 20 taxon edges so' }
    yield { stream: 'stderr', text: ' far\nWARNING dangling=3 duplicates=0\n' }
    await hold.wait
    yield { stream: 'stdout', text: 'rejected: 4\nlast line without newline' }
    return { value: { code: 0, signal: null } }
  })
  const r = await $.command.run({ command: 'longrun', args: 'gene-etl --skip-download' })
  expect(r.text).toBe('Started gene-etl')
  await clk.advance(3000)
  expect(w.spawned[0].argv).toEqual(['gene-etl', '--skip-download'])
  const pane = await drawPane($)
  expect(await pane.find({ type: 'Text', text: /Running, elapsed 00:03/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Rows written 1,000, rejected not reported, dangling 3/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /WARNING dangling=3/ })).toBeDefined()
  hold.open()
  await clk.advance(1000)
  expect(await pane.find({ type: 'Text', text: /Finished, elapsed 00:0\d, exit code 0/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /rejected 4/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'last line without newline' })).toBeDefined()
  expect(w.toasts.join('\n')).toContain('gene-etl finished with exit code 0')
})

test('the pane keeps only the last 20 lines', async ($, on) => {
  const w = world(on)
  const clk = mock.clock(on)
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: Array.from({ length: 30 }, (_, i) => `row ${i}`).join('\n') + '\n' }
    return { value: { code: 0, signal: null } }
  })
  await $.command.run({ command: 'longrun', args: 'merge-etl' })
  await clk.advance(1000)
  const pane = await drawPane($)
  expect(await pane.find({ type: 'Text', text: 'row 9' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'row 10' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'row 29' })).toBeDefined()
  void w
})

test('Stop ends the run and the pane says stopped', async ($, on) => {
  const w = world(on)
  const clk = mock.clock(on)
  const hold = gate()
  let isClosed = false
  on('process.spawn', async function* () {
    try {
      yield { stream: 'stdout', text: 'started\n' }
      await hold.wait
      yield { stream: 'stdout', text: 'after stop\n' }
      return { value: { code: 0, signal: null } }
    } finally {
      isClosed = true
    }
  })
  await $.command.run({ command: 'longrun', args: 'gene-etl' })
  await clk.advance(2000)
  const pane = await drawPane($)
  await pane.press({ key: 'stop' })
  hold.open()
  await clk.advance(1000)
  expect(isClosed).toBe(true)
  expect(await pane.find({ type: 'Text', text: /Stopped/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'after stop' })).toBeUndefined()
  expect(w.toasts.join('\n')).toContain('gene-etl stopped')
})

test('a non-zero exit code is shown as failed', async ($, on) => {
  const w = world(on)
  const clk = mock.clock(on)
  on('process.spawn', async function* () {
    yield { stream: 'stderr', text: 'boom\n' }
    return { value: { code: 2, signal: null } }
  })
  await $.command.run({ command: 'longrun', args: 'merge-etl' })
  await clk.advance(1000)
  const pane = await drawPane($)
  expect(await pane.find({ type: 'Text', text: /Failed, elapsed 00:00, exit code 2/ })).toBeDefined()
  expect(w.toasts.join('\n')).toContain('failed with exit code 2')
})

test('a child that cannot start is reported', async ($, on) => {
  const w = world(on)
  const clk = mock.clock(on)
  on('process.spawn', async function* () {
    throw new Error('spawn failed')
    yield { stream: 'stdout', text: '' }
    return { value: { code: 0, signal: null } }
  })
  await $.command.run({ command: 'longrun', args: 'gene-etl' })
  await clk.advance(1000)
  const pane = await drawPane($)
  expect(await pane.find({ type: 'Text', text: /Could not run/ })).toBeDefined()
  expect(w.toasts.join('\n')).toContain('gene-etl failed')
})

test('only one run at a time', async ($, on) => {
  const w = world(on)
  const clk = mock.clock(on)
  const hold = gate()
  on('process.spawn', async function* (_: unknown, e: any) {
    w.spawned.push(e)
    await hold.wait
    return { value: { code: 0, signal: null } }
  })
  await $.command.run({ command: 'longrun', args: 'gene-etl' })
  await clk.advance(1000)
  const r = await $.command.run({ command: 'longrun', args: 'merge-etl' })
  expect(r.text).toContain('still running')
  expect(w.spawned.length).toBe(1)
  hold.open()
  await clk.advance(1000)
  const r2 = await $.command.run({ command: 'longrun', args: 'merge-etl' })
  expect(r2.text).toBe('Started merge-etl')
  await clk.advance(1000)
})

test('a pane that cannot be seated starts nothing', async ($, on) => {
  const w = world(on)
  mock.clock(on)
  w.placed = false
  on('process.spawn', async function* (_: unknown, e: any) { w.spawned.push(e); return { value: { code: 0, signal: null } } })
  const r = await $.command.run({ command: 'longrun', args: 'gene-etl' })
  expect(r.text).toContain('nothing was started')
  expect(w.spawned).toEqual([])
})

test('the command never touches the model tool calls', async ($, on) => {
  world(on)
  mock.clock(on)
  on('tool.call', () => ({ result: 'ran' }) as never)
  const r = await $.tool.call({ tool: 'Bash', command: 'gene-etl' })
  expect(r.deny).toBeUndefined()
})
