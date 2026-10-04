import { test, expect } from 'claude-code/testing'

const PIPE = '/repo/system-01-data-pipelines'

function setup(on: any, existing: Record<string, string>) {
  const toasts: string[] = []
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (!(e.path in existing)) throw new Error('missing')
    return { value: existing[e.path] }
  })
  return toasts
}

test('a removed source_url warns', async ($, on) => {
  const file = `${PIPE}/gene/transform.py`
  const toasts = setup(on, { [file]: 'node = make(id=1)\n' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'node = make(id=1, source_url=url)', new_string: 'node = make(id=1)' })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('provenance: system-01-data-pipelines/gene/transform.py:1')
  expect(toasts[0]).toContain('source_url was removed')
})

test('a removed dict key warns', async ($, on) => {
  const file = `${PIPE}/gene/transform.py`
  const toasts = setup(on, { [file]: 'row = {}\n' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'row = {"source": "gene"}', new_string: 'row = {}' })
  expect(toasts[0]).toContain('source was removed')
})

test('an unchanged source_url is silent', async ($, on) => {
  const file = `${PIPE}/gene/transform.py`
  const toasts = setup(on, { [file]: 'x = 2\nnode = make(source_url=url)\n' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'x = 1', new_string: 'x = 2' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'make(source_url=a)', new_string: 'make(source_url=b)' })
  expect(toasts).toEqual([])
})

test('a merge file that assigns source warns', async ($, on) => {
  const file = `${PIPE}/merge/pipeline.py`
  const toasts = setup(on, { [file]: 'node["source"] = "x"\n' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'pass', new_string: 'node["source"] = "x"' })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('merge code assigns source')
})

test('the shared merger file counts as merge code', async ($, on) => {
  const file = `${PIPE}/shared/merger.py`
  const toasts = setup(on, { [file]: 'edge.source_url = u\n' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'pass', new_string: 'edge.source_url = u' })
  expect(toasts[0]).toContain('merge code assigns source_url')
})

test('an assignment outside merge code is silent', async ($, on) => {
  const file = `${PIPE}/gene/transform.py`
  const toasts = setup(on, { [file]: '' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'pass', new_string: 'node["source"] = "gene"' })
  expect(toasts).toEqual([])
})

test('test files and other folders are ignored', async ($, on) => {
  const toasts = setup(on, {})
  await $.tool.call({ tool: 'Edit', file_path: `${PIPE}/gene/test_transform.py`, old_string: 'a(source_url=1)', new_string: 'a()' })
  await $.tool.call({ tool: 'Edit', file_path: `${PIPE}/tests/helpers.py`, old_string: 'a(source_url=1)', new_string: 'a()' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/system-02-knowledge-graph/a.py', old_string: 'a(source_url=1)', new_string: 'a()' })
  await $.tool.call({ tool: 'Edit', file_path: `${PIPE}/gene/notes.md`, old_string: 'a(source_url=1)', new_string: 'a()' })
  expect(toasts).toEqual([])
})

test('a Write that drops source_url compares against the old contents', async ($, on) => {
  const file = `${PIPE}/pubmed/load.py`
  const toasts = setup(on, { [file]: 'a = 1\nrow = make(source_url=u)\n' })
  await $.tool.call({ tool: 'Write', file_path: file, content: 'a = 1\nrow = make()\n' })
  expect(toasts[0]).toContain('load.py:2 source_url was removed')
})

test('a Write that keeps provenance is silent, and a new merge file warns', async ($, on) => {
  const file = `${PIPE}/pubmed/load.py`
  const toasts = setup(on, { [file]: 'row = make(source=s)\n' })
  await $.tool.call({ tool: 'Write', file_path: file, content: 'row = make(source=s)\nb = 2\n' })
  expect(toasts).toEqual([])
  await $.tool.call({ tool: 'Write', file_path: `${PIPE}/merge/new.py`, content: 'n.source = s\n' })
  expect(toasts.length).toBe(1)
})

test('a denied or failing edit warns about nothing', async ($, on) => {
  const toasts: string[] = []
  on('tool.call', () => ({ deny: 'no' }) as never)
  on('ui.toast', (_: unknown, e: { text: string }) => { toasts.push(e.text); return { value: undefined } })
  on('fs.read', () => ({ value: '' }))
  const r = await $.tool.call({ tool: 'Edit', file_path: `${PIPE}/gene/a.py`, old_string: 'a(source=1)', new_string: 'a()' })
  expect(r.deny).toBe('no')
  expect(toasts).toEqual([])
})
