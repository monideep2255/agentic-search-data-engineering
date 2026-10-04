import { test, expect } from 'claude-code/testing'

const PYPROJECT = 'markers = [\n    "integration: needs network",\n    "docker: needs Docker",\n]\n'

function setup(on: any, output: string, clock = { now: 1_000_000 }) {
  const statuses: (string | undefined)[] = []
  on('tool.call', () => ({ result: 'ran', text: output }) as never)
  on('ui.status', (_: unknown, e: { text?: string }) => { statuses.push(e.text); return { value: undefined } })
  on('clock.now', () => ({ value: clock.now }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('fs.read', () => ({ value: PYPROJECT }))
  return statuses
}

const last = (s: (string | undefined)[]) => s[s.length - 1]

test('a passing summary is parsed and shown as a full run', async ($, on) => {
  const s = setup(on, '...\n184 passed, 2 skipped in 3.1s\n')
  await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
  expect(last(s)).toBe('tests: 184 passed, 0 failed (full, just now)')
})

test('a failing summary counts failures and errors', async ($, on) => {
  const s = setup(on, '=== 1 failed, 183 passed, 1 error in 3.1s ===\n')
  await $.tool.call({ tool: 'Bash', command: 'python3 -m pytest' })
  expect(last(s)).toContain('183 passed, 2 failed')
})

test('a run that excludes integration and docker is quick', async ($, on) => {
  const s = setup(on, '10 passed in 1.0s\n')
  await $.tool.call({ tool: 'Bash', command: '/venv/bin/python -m pytest -m "not integration and not docker"' })
  expect(last(s)).toContain('(quick, just now)')
})

test('a run with another marker expression is full', async ($, on) => {
  const s = setup(on, '10 passed in 1.0s\n')
  await $.tool.call({ tool: 'Bash', command: 'pytest -m smoke' })
  expect(last(s)).toContain('(full, just now)')
})

test('the age follows the clock', async ($, on) => {
  const clock = { now: 1_000_000 }
  const s = setup(on, '5 passed in 1.0s\n', clock)
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  clock.now += 12 * 60_000
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.md', old_string: 'a', new_string: 'b' })
  expect(last(s)).toBe('tests: 5 passed, 0 failed (full, 12m ago)')
})

test('a python edit after the run marks it stale, a non-python edit does not', async ($, on) => {
  const clock = { now: 1_000_000 }
  const s = setup(on, '5 passed in 1.0s\n', clock)
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  clock.now += 5 * 60_000
  await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'a', new_string: 'b' })
  expect(last(s)).not.toContain('stale')
  clock.now += 60_000
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/a.py', content: 'x = 1\n' })
  expect(last(s)).toBe('tests: 5 passed, 0 failed (full, 6m ago) stale')
})

test('a new run clears stale', async ($, on) => {
  const clock = { now: 1_000_000 }
  const s = setup(on, '5 passed in 1.0s\n', clock)
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  clock.now += 1000
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.py', old_string: 'a', new_string: 'b' })
  expect(last(s)).toContain('stale')
  clock.now += 1000
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(last(s)).not.toContain('stale')
})

test('a non-pytest command changes nothing', async ($, on) => {
  const s = setup(on, '5 passed in 1.0s\n')
  await $.tool.call({ tool: 'Bash', command: 'echo hello' })
  expect(s).toEqual([])
})

test('unparseable pytest output changes nothing', async ($, on) => {
  const s = setup(on, 'no tests ran in 0.01s\n')
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(s).toEqual([])
})
