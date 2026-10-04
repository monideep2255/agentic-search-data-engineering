import { test, expect } from 'claude-code/testing'

const P = '/repo/system-01-data-pipelines/gene/load.py'

function fake(on: any, opts: { failed?: boolean; fileText?: string; broken?: boolean } = {}) {
  const toasts: string[] = []
  on('tool.call', () => (opts.failed ? { result: 'nope', isError: true } : { result: 'ran' }) as never)
  on('ui.toast', (_: unknown, e: { text: string }) => { if (opts.broken) throw new Error('boom'); toasts.push(e.text); return { value: undefined } })
  on('fs.read', () => { if (opts.fileText === undefined) throw new Error('missing'); return { value: opts.fileText } })
  return toasts
}

const write = ($: any, file_path: string, content: string) => $.tool.call({ tool: 'Write', file_path, content })

test('an f-string building SQL warns with file and line', async ($, on) => {
  const toasts = fake(on)
  const r = await write($, P, 'x = 1\nq = f"SELECT * FROM genes WHERE id = {gene_id}"\n')
  expect(r.deny).toBeUndefined()
  expect(toasts).toEqual(['system-01-data-pipelines/gene/load.py:2 sql-string-building'])
})

test('percent and format building of SQL and Cypher warn', async ($, on) => {
  const toasts = fake(on)
  await write($, P, 'a = "INSERT INTO t VALUES (%s)" % value\nb = "MATCH (n {{id: {}}}) RETURN n".format(i)\n')
  expect(toasts.length).toBe(2)
  expect(toasts[0]).toContain(':1 sql-string-building')
  expect(toasts[1]).toContain(':2 sql-string-building')
})

test('a multi-line f-string query warns once', async ($, on) => {
  const toasts = fake(on)
  await write($, P, 'q = f"""\nMERGE (n:Gene {{id: {gid}}})\n"""\n')
  expect(toasts.length).toBe(1)
})

test('a parameterized query is silent', async ($, on) => {
  const toasts = fake(on)
  await write($, P, 'cur.execute("SELECT * FROM genes WHERE id = %s", (gene_id,))\nlabel = f"loaded {n} rows"\n')
  expect(toasts).toEqual([])
})

test('logging a secret-like name warns, logging prose does not', async ($, on) => {
  const toasts = fake(on)
  await write($, P, 'log.info("connecting")\nlog.info("connection ok")\nlogger.debug("dsn is %s", dsn)\nprint(f"token={token}")\n')
  expect(toasts).toEqual([
    'system-01-data-pipelines/gene/load.py:3 logs-secret-name',
    'system-01-data-pipelines/gene/load.py:4 logs-secret-name',
  ])
})

test('findings are capped at three', async ($, on) => {
  const toasts = fake(on)
  const lines = [1, 2, 3, 4, 5].map(i => `q${i} = f"SELECT {col}"`).join('\n')
  await write($, P, lines + '\n')
  expect(toasts.filter(t => t.includes('sql-string-building')).length).toBe(3)
  expect(toasts.some(t => t.includes('2 more'))).toBe(true)
})

test('a path outside the two system folders is silent', async ($, on) => {
  const toasts = fake(on)
  await write($, '/repo/scripts/tool.py', 'q = f"SELECT {x}"\n')
  await write($, '/repo/system-01-data-pipelines/notes.md', 'q = f"SELECT {x}"\n')
  expect(toasts).toEqual([])
})

test('a failed edit is silent', async ($, on) => {
  const toasts = fake(on, { failed: true })
  await write($, P, 'q = f"SELECT {x}"\n')
  expect(toasts).toEqual([])
})

test('an Edit reports the line inside the whole file', async ($, on) => {
  const toasts = fake(on, { fileText: 'a\nb\nc\nq = f"DELETE FROM t WHERE id = {i}"\n' })
  const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/system-02-knowledge-graph/loader/run.py', old_string: 'old', new_string: 'q = f"DELETE FROM t WHERE id = {i}"' })
  expect(r.deny).toBeUndefined()
  expect(toasts).toEqual(['system-02-knowledge-graph/loader/run.py:4 sql-string-building'])
})

test('an observer that breaks never denies', async ($, on) => {
  const toasts = fake(on, { broken: true })
  const r = await write($, P, 'q = f"SELECT {x}"\n')
  expect(r.deny).toBeUndefined()
  expect(toasts).toEqual([])
})
