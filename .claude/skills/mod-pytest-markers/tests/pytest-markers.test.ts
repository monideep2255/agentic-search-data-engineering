import { test, expect } from 'claude-code/testing'

const FILTER = '-m "not integration and not docker"'

function setup(on: any, docker: 'up' | 'down' | 'throws', clock = { now: 1_000_000 }) {
  const seen = { commands: [] as string[], toasts: [] as string[], probes: 0 }
  on('tool.call', (_: unknown, e: { command: string }) => { seen.commands.push(e.command); return { result: 'ran' } as never })
  on('ui.toast', (_: unknown, e: { text: string }) => { seen.toasts.push(e.text); return { value: undefined } })
  on('clock.now', () => ({ value: clock.now }))
  on('process.run', () => {
    seen.probes++
    if (docker === 'throws') throw new Error('no docker')
    return { value: { exitCode: docker === 'up' ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return seen
}

test('Docker down rewrites a bare pytest and toasts', async ($, on) => {
  const seen = setup(on, 'down')
  await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
  expect(seen.commands).toEqual([`pytest ${FILTER} -q`])
  expect(seen.toasts).toEqual(['Docker is down: skipped integration and docker tests. This run is partial, not a full pass.'])
})

test('python -m pytest and a path to python are rewritten inside a compound command', async ($, on) => {
  const seen = setup(on, 'down')
  await $.tool.call({ tool: 'Bash', command: 'cd sub && ./venv/bin/python3 -m pytest -q' })
  expect(seen.commands[0]).toBe(`cd sub && ./venv/bin/python3 -m pytest ${FILTER} -q`)
})

test('a probe that fails to run counts as Docker down', async ($, on) => {
  const seen = setup(on, 'throws')
  await $.tool.call({ tool: 'Bash', command: 'python -m pytest' })
  expect(seen.commands[0]).toContain(FILTER)
})

test('Docker up passes the command through untouched', async ($, on) => {
  const seen = setup(on, 'up')
  await $.tool.call({ tool: 'Bash', command: 'pytest -q' })
  expect(seen.commands).toEqual(['pytest -q'])
  expect(seen.toasts).toEqual([])
})

test('an existing -m is untouched and Docker is not probed', async ($, on) => {
  const seen = setup(on, 'down')
  await $.tool.call({ tool: 'Bash', command: 'pytest -m integration' })
  await $.tool.call({ tool: 'Bash', command: 'pytest -m"not docker"' })
  expect(seen.commands).toEqual(['pytest -m integration', 'pytest -m"not docker"'])
  expect(seen.probes).toBe(0)
  expect(seen.toasts).toEqual([])
})

test('specific test files are untouched', async ($, on) => {
  const seen = setup(on, 'down')
  await $.tool.call({ tool: 'Bash', command: 'pytest tests/test_merge.py -q' })
  await $.tool.call({ tool: 'Bash', command: 'pytest tests/test_merge.py::test_one' })
  expect(seen.commands.every(c => !c.includes('not integration'))).toBe(true)
  expect(seen.probes).toBe(0)
})

test('commands that are not pytest are untouched', async ($, on) => {
  const seen = setup(on, 'down')
  await $.tool.call({ tool: 'Bash', command: 'ls -la && echo pytest' })
  expect(seen.commands).toEqual(['ls -la && echo pytest'])
  expect(seen.probes).toBe(0)
})

test('the Docker probe is cached for 60 seconds', async ($, on) => {
  const clock = { now: 1_000_000 }
  const seen = setup(on, 'down', clock)
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  clock.now += 30_000
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(seen.probes).toBe(1)
  clock.now += 31_000
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  expect(seen.probes).toBe(2)
})

test('the configured test folder counts as a bare run', async ($, on) => {
  const seen = setup(on, 'down')
  await $.tool.call({ tool: 'Bash', command: 'pytest tests/' })
  await $.tool.call({ tool: 'Bash', command: 'pytest ./tests' })
  await $.tool.call({ tool: 'Bash', command: 'pytest tests' })
  expect(seen.commands).toEqual([`pytest ${FILTER} tests/`, `pytest ${FILTER} ./tests`, `pytest ${FILTER} tests`])
})

test('a runner in front of pytest is unwrapped and keeps its options', async ($, on) => {
  const seen = setup(on, 'down')
  await $.tool.call({ tool: 'Bash', command: 'uv run pytest tests/ -q' })
  await $.tool.call({ tool: 'Bash', command: 'uv run python -m pytest -q' })
  await $.tool.call({ tool: 'Bash', command: 'poetry run pytest' })
  await $.tool.call({ tool: 'Bash', command: 'pipenv run pytest -x' })
  expect(seen.commands).toEqual([
    `uv run pytest ${FILTER} tests/ -q`,
    `uv run python -m pytest ${FILTER} -q`,
    `poetry run pytest ${FILTER}`,
    `pipenv run pytest ${FILTER} -x`,
  ])
})

test('a file or a subfolder under tests stays untouched', async ($, on) => {
  const seen = setup(on, 'down')
  await $.tool.call({ tool: 'Bash', command: 'pytest tests/loader/test_x.py' })
  await $.tool.call({ tool: 'Bash', command: 'uv run pytest tests/loader/ -q' })
  expect(seen.commands.every(c => !c.includes('not integration'))).toBe(true)
  expect(seen.probes).toBe(0)
})
