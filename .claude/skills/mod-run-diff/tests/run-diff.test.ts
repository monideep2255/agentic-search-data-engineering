import { test, expect } from 'claude-code/testing'
import { compare, entryFrom, isCounterKey, parseCounts, parseScripts, reportPathFrom } from '../hooks/counts.ts'

const ENTRIES = ['gene-etl', 'merge-etl', 'taxonomy-etl', 'age-load']

const TOML = `[project]
name = "x"

[project.scripts]
gene-etl = "a.b:main"
merge-etl = "c.d:main"
age-load = "e.f:main"

[tool.pytest.ini_options]
testpaths = ["tests"]
`

function out(text: string) {
  return { result: 'ran', text } as never
}

const MERGE_LOG = [
  '2026-10-04 10:00:00,001 merge.pipeline INFO 5-database merge complete: nodes=1000 edges=2000 stubs=10 validation_passed=True nodes_path=/x/n.tsv edges_path=/x/e.tsv report_path=/x/merge_report.md',
].join('\n')

function reportOf(gene: number, mentioned: number, dangling: number) {
  return `# 5-database merge report\n\n## Summary\n- Total nodes: 1,000\n- Dangling endpoints (resolved via stubs): ${dangling}\n- Validation passed: True\n- Missing provenance on nodes: 5 (stubs count here)\n\n## Node categories\n- biolink:Gene: ${gene}\n\n## Edge predicates\n- biolink:mentioned_in: ${mentioned}\n`
}

type World = { toasts: string[]; store: Map<string, unknown>; report: { text: string | undefined }; now: number }

function world(on: any, reportText?: string): World {
  const w: World = { toasts: [], store: new Map(), report: { text: reportText }, now: new Date(2026, 9, 4, 12).getTime() }
  on('clock.now', () => ({ value: w.now }))
  on('fs.read', (_: unknown, e: any) => {
    if (String(e.path).endsWith('pyproject.toml')) return { value: TOML }
    if (w.report.text !== undefined) return { value: w.report.text }
    throw new Error('ENOENT')
  })
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }) as never)
  on('store.get', (_: unknown, e: any) => ({ value: w.store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => { w.store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('ui.toast', (_: unknown, e: any) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  return w
}

test('parser reads key=value pairs and labelled report lines', () => {
  const c = parseCounts(MERGE_LOG + '\n' + reportOf(900, 50, 7))
  expect(c['nodes']).toBe(1000)
  expect(c['stubs']).toBe(10)
  expect(c['biolink:Gene']).toBe(900)
  expect(c['biolink:mentioned_in']).toBe(50)
  expect(c['Dangling endpoints (resolved via stubs)']).toBe(7)
  expect(c['Missing provenance on nodes']).toBe(5)
  expect(reportPathFrom(MERGE_LOG)).toBe('/x/merge_report.md')
})

test('parser numbers a repeated key and reads validation lines', () => {
  const c = parseCounts('Gene ETL pipeline complete: nodes=5 (gene=3, go=2), edges=9 (taxon=1, go=8)')
  expect(c['go']).toBe(2)
  expect(c['go_2']).toBe(8)
  const v = parseCounts('WARNING dangling=3 duplicates=0 missing_prov_nodes=1 missing_prov_edges=0')
  expect(v['dangling']).toBe(3)
  expect(isCounterKey('missing_prov_nodes')).toBe(true)
  expect(isCounterKey('Duplicate nodes dropped')).toBe(true)
  expect(isCounterKey('nodes')).toBe(false)
})

test('pyproject scripts and entry detection', () => {
  expect(parseScripts(TOML)).toEqual(['gene-etl', 'merge-etl', 'age-load'])
  expect(entryFrom('merge-etl --databases gene', ENTRIES)).toBe('merge-etl')
  expect(entryFrom('uv run gene-etl', ENTRIES)).toBe('gene-etl')
  expect(entryFrom('.venv/bin/merge-etl', ENTRIES)).toBe('merge-etl')
  expect(entryFrom('ls -la', ENTRIES)).toBeUndefined()
  expect(entryFrom('echo merge-etl', ENTRIES)).toBeUndefined()
  expect(entryFrom('gene-etl && merge-etl', ENTRIES)).toBe('several')
})

test('compare flags a drop over the threshold and not a small one', () => {
  const c = compare('x', { a: 100, b: 100, dangling: 2 }, { a: 90, b: 98, dangling: 2 }, 5)
  expect(c.changes.map(x => [x.key, x.isFlagged])).toEqual([['a', true], ['b', false]])
  expect(c.flaggedCount).toBe(1)
})

test('compare flags a counter that rose and a label that vanished', () => {
  const c = compare('x', { a: 10, dangling: 0 }, { dangling: 4 }, 5)
  expect(c.changes.filter(x => x.isFlagged).map(x => x.key).sort()).toEqual(['a', 'dangling'])
})

test('a first run stores the baseline and never says clean', async ($, on) => {
  const w = world(on, reportOf(900, 50, 7))
  on('tool.call', () => out(MERGE_LOG))
  await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  expect(w.toasts.join('\n')).toContain('no baseline yet')
  expect(w.toasts.join('\n')).toContain('stored this run as the pinned baseline')
  expect(w.toasts.join('\n')).not.toContain('clean')
  const r = await $.command.run({ command: 'rundiff', args: '' })
  expect(r.text).toContain('baseline pinned 2026-10-04')
})

test('a ten percent drop on the second run is flagged and shown', async ($, on) => {
  const w = world(on, reportOf(1000, 50, 7))
  on('tool.call', () => out(MERGE_LOG))
  await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  w.report.text = reportOf(900, 50, 7)
  w.toasts.length = 0
  await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  expect(w.toasts.join('\n')).toContain('1 changes, 1 flagged')
  await $.command.run({ command: 'rundiff', args: '' })
  const pane = await $.ui.mount({ plugin: 'mod-run-diff', surface: 'terminal', component: 'Pane', props: { title: 'Run diff', isFocused: true }, requestId: 'run-diff', viewport: { columns: 100, rows: 40 } })
  expect(await pane.find({ type: 'Text', text: /biolink:Gene: 1000 to 900/ })).toBeDefined()
})

test('a small drop is a change but not flagged', async ($, on) => {
  const w = world(on, reportOf(1000, 50, 7))
  on('tool.call', () => out(MERGE_LOG))
  await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  w.report.text = reportOf(980, 50, 7)
  w.toasts.length = 0
  await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  expect(w.toasts.join('\n')).toContain('1 changes, 0 flagged')
})

test('a validation counter that rose is flagged', async ($, on) => {
  const w = world(on, reportOf(1000, 50, 7))
  on('tool.call', () => out(MERGE_LOG))
  await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  w.report.text = reportOf(1000, 50, 9)
  w.toasts.length = 0
  await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  expect(w.toasts.join('\n')).toContain('1 changes, 1 flagged')
})

test('a command that is not an entry point is ignored', async ($, on) => {
  const w = world(on)
  on('tool.call', () => out('nodes=5'))
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(w.toasts).toEqual([])
  expect(w.store.size).toBe(0)
})

test('a failed run is ignored and the call passes through', async ($, on) => {
  const w = world(on)
  on('tool.call', () => ({ result: 'boom', text: 'nodes=5', isError: true }) as never)
  const r = await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  expect(r.deny).toBeUndefined()
  expect(w.toasts).toEqual([])
  expect(w.store.size).toBe(0)
})

test('output with no counts is reported as not compared', async ($, on) => {
  const w = world(on)
  on('tool.call', () => out('done'))
  await $.tool.call({ tool: 'Bash', command: 'gene-etl' })
  expect(w.toasts.join('\n')).toContain('nothing was compared')
  expect(w.store.has('baseline:gene-etl')).toBe(false)
})

test('several entry points in one command are not compared', async ($, on) => {
  const w = world(on)
  on('tool.call', () => out('nodes=5'))
  await $.tool.call({ tool: 'Bash', command: 'gene-etl && merge-etl' })
  expect(w.toasts.join('\n')).toContain('several entry points')
  expect(w.store.size).toBe(0)
})

test('the stored baseline holds counts only', async ($, on) => {
  const w = world(on, reportOf(900, 50, 7))
  on('tool.call', () => out(MERGE_LOG))
  await $.tool.call({ tool: 'Bash', command: 'merge-etl' })
  const text = JSON.stringify(w.store.get('baseline:merge-etl'))
  expect(text).not.toContain('/x/')
  expect(text).not.toContain('merge_report')
  expect(Object.values(w.store.get('baseline:merge-etl') as object).every(v => typeof v === 'number')).toBe(true)
})

test('rundiff before any run says so', async ($, on) => {
  world(on)
  const r = await $.command.run({ command: 'rundiff', args: '' })
  expect(r.text).toBe('No pipeline run has been seen yet')
})

const run = ($: any) => $.tool.call({ tool: 'Bash', command: 'merge-etl' })
const baselineOf = (w: World) => (w.store.get('baseline:merge-etl') as Record<string, number>)['biolink:Gene']

test('pinned baseline: first run pins, a drop flags without moving it, a third run still flags', async ($, on) => {
  const w = world(on, reportOf(1000, 50, 7))
  on('tool.call', () => out(MERGE_LOG))
  await run($)
  expect(baselineOf(w)).toBe(1000)
  w.report.text = reportOf(900, 50, 7)
  w.toasts.length = 0
  await run($)
  expect(w.toasts.join('\n')).toContain('1 flagged')
  expect(baselineOf(w)).toBe(1000)
  w.report.text = reportOf(920, 50, 7)
  w.toasts.length = 0
  await run($)
  expect(w.toasts.join('\n')).toContain('1 flagged')
  expect(baselineOf(w)).toBe(1000)
})

test('accept moves the baseline and the same counts are then clean', async ($, on) => {
  const w = world(on, reportOf(1000, 50, 7))
  on('tool.call', () => out(MERGE_LOG))
  await run($)
  w.report.text = reportOf(900, 50, 7)
  await run($)
  w.now = new Date(2026, 9, 6, 12).getTime()
  const r = await $.command.run({ command: 'rundiff', args: 'accept' })
  expect(r.text).toContain('baseline replaced')
  expect(r.text).toContain('2026-10-06')
  expect(baselineOf(w)).toBe(900)
  w.toasts.length = 0
  await run($)
  expect(w.toasts.join('\n')).toContain('0 changes, 0 flagged')
})

test('/rundiff shows the last comparison and the baseline date', async ($, on) => {
  const w = world(on, reportOf(1000, 50, 7))
  on('tool.call', () => out(MERGE_LOG))
  await run($)
  w.report.text = reportOf(900, 50, 7)
  await run($)
  const r = await $.command.run({ command: 'rundiff', args: '' })
  expect(r.text).toContain('1 flagged against the baseline of 2026-10-04')
})

test('accept before any run says there is nothing to accept', async ($, on) => {
  world(on)
  const r = await $.command.run({ command: 'rundiff', args: 'accept' })
  expect(r.text).toContain('nothing to accept')
})
