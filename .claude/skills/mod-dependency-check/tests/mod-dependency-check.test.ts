import { test, expect } from 'claude-code/testing'

const NOW = Date.parse('2026-10-04T00:00:00Z')
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
const pkg = (version: string, ageDays: number) =>
  JSON.stringify({ info: { version }, urls: [{ upload_time_iso_8601: day(ageDays) }] })

type Setup = {
  answer?: 'Proceed' | 'Cancel' | 'throw'
  pypi?: Record<string, { status: number; text?: string } | 'throw'>
  files?: Record<string, string>
  onAsk?: () => Promise<void>
  broken?: boolean
}

function fake($: any, on: any, s: Setup = {}) {
  const seen = { questions: [] as string[], urls: [] as string[] }
  on('tool.call', async (_: unknown, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions[0].question as string
      seen.questions.push(q)
      if (s.onAsk) await s.onAsk()
      if (s.answer === 'throw') throw new Error('dismissed')
      return { result: { questions: e.questions, answers: { [q]: s.answer ?? 'Proceed' } } } as never
    }
    return { result: 'ran' } as never
  })
  on('http.fetch', (_: unknown, e: { url: string }) => {
    seen.urls.push(e.url)
    const hit = s.pypi?.[e.url]
    if (hit === 'throw') throw new Error('offline')
    const r = hit ?? { status: 404, text: '' }
    return { value: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: {}, text: r.text ?? '' } }
  })
  on('clock.now', () => { if (s.broken) throw new Error('boom'); return { value: NOW } })
  on('fs.read', (_: unknown, e: { path: string }) => {
    const f = s.files?.[e.path]
    if (f === undefined) throw new Error('missing')
    return { value: f }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  return seen
}

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })
const URL = (n: string, v?: string) => `https://pypi.org/pypi/${n}/${v ? v + '/' : ''}json`

test('pip install with a package triggers a lookup and asks', async ($, on) => {
  const seen = fake($, on, { pypi: { [URL('requests')]: { status: 200, text: pkg('2.32.0', 200) } } })
  const r = await bash($, 'pip install requests')
  expect(r.deny).toBeUndefined()
  expect(seen.urls).toEqual([URL('requests')])
  expect(seen.questions[0]).toContain('requests')
  expect(seen.questions[0]).toContain('supply-chain')
})

test('every supported installer triggers', async ($, on) => {
  const seen = fake($, on)
  for (const c of ['pip3 install a1', 'uv add a2', 'uv pip install a3', 'poetry add a4', 'python3 -m pip install a5']) {
    expect((await bash($, c)).deny).toBeUndefined()
  }
  expect(seen.questions.length).toBe(5)
})

test('requirements-file and editable installs pass without a question', async ($, on) => {
  const seen = fake($, on)
  expect((await bash($, 'pip install -r requirements.txt')).deny).toBeUndefined()
  expect((await bash($, 'pip install -e .')).deny).toBeUndefined()
  expect((await bash($, 'git status')).deny).toBeUndefined()
  expect(seen.questions.length).toBe(0)
  expect(seen.urls.length).toBe(0)
})

test('option values are not read as packages, and a bare number or word value never asks', async ($, on) => {
  const seen = fake($, on)
  for (const c of ['pip install --timeout 30 --retries 3 --progress-bar off -r requirements.txt', 'pip install --retries 3 -e .']) {
    expect((await bash($, c)).deny).toBeUndefined()
  }
  expect(seen.questions.length).toBe(0)
  expect(seen.urls.length).toBe(0)
})

test('a package beside value options is still named', async ($, on) => {
  const seen = fake($, on)
  await bash($, 'pip install --timeout 30 --progress-bar off requests')
  expect(seen.questions.length).toBe(1)
  expect(seen.questions[0]).toContain('requests')
  expect(seen.questions[0]).not.toContain('"30"')
  expect(seen.urls).toEqual([URL('requests')])
})

test('upgrading pip, setuptools or wheel unpinned does not ask, a pinned one does', async ($, on) => {
  const seen = fake($, on)
  expect((await bash($, 'pip install --upgrade pip')).deny).toBeUndefined()
  expect((await bash($, 'python3 -m pip install --upgrade pip setuptools wheel')).deny).toBeUndefined()
  expect(seen.questions.length).toBe(0)
  await bash($, 'pip install pip==24.0')
  expect(seen.questions.length).toBe(1)
  expect(seen.questions[0]).toContain('pip')
})

test('a pinned package fetches the version page too', async ($, on) => {
  const seen = fake($, on, {
    pypi: {
      [URL('pandas')]: { status: 200, text: pkg('2.3.0', 40) },
      [URL('pandas', '2.2.0')]: { status: 200, text: pkg('2.2.0', 300) },
    },
  })
  await bash($, 'pip install pandas==2.2.0')
  expect(seen.urls).toEqual([URL('pandas'), URL('pandas', '2.2.0')])
})

test('the report flags unpinned, new, and missing packages', async ($, on) => {
  let text = ''
  const seen = fake($, on, {
    pypi: { [URL('freshpkg')]: { status: 200, text: pkg('0.1.0', 3) } },
    onAsk: async () => {
      const ui = await $.ui.mount({ plugin: 'mod-dependency-check', surface: 'terminal', component: 'Pane', props: { title: 't', isFocused: false, bodyColumns: 100, placement: 'inline', scroll: {}, view: {} } as never, requestId: 'dependency-check' })
      text = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('\n')
      await ui.unmount()
    },
  })
  await bash($, 'pip install freshpkg ghostpkg')
  expect(seen.questions.length).toBe(1)
  expect(text).toContain('freshpkg | requested: unpinned | latest: 0.1.0')
  expect(text).toContain('uploaded 3 days ago')
  expect(text).toContain('ghostpkg')
  expect(text).toContain('package not found')
  expect(text).toContain('supply-chain checklist')
})

test('Cancel denies', async ($, on) => {
  fake($, on, { answer: 'Cancel' })
  expect((await bash($, 'pip install requests')).deny).toContain('mod-dependency-check')
})

test('a dismissed question denies', async ($, on) => {
  fake($, on, { answer: 'throw' })
  expect((await bash($, 'uv add requests')).deny).toBeDefined()
})

test('a network failure still asks', async ($, on) => {
  let text = ''
  const seen = fake($, on, {
    pypi: { [URL('requests')]: 'throw' },
    onAsk: async () => {
      const ui = await $.ui.mount({ plugin: 'mod-dependency-check', surface: 'terminal', component: 'Pane', props: { title: 't', isFocused: false, bodyColumns: 100, placement: 'inline', scroll: {}, view: {} } as never, requestId: 'dependency-check' })
      text = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join('\n')
      await ui.unmount()
    },
  })
  const r = await bash($, 'pip install requests')
  expect(r.deny).toBeUndefined()
  expect(seen.questions.length).toBe(1)
  expect(text).toContain('could not check PyPI')
})

test('an Edit that adds a requirements line triggers', async ($, on) => {
  const seen = fake($, on)
  const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/requirements.txt', old_string: 'click==8.1.7', new_string: 'click==8.1.7\nrequests>=2.0' })
  expect(r.deny).toBeUndefined()
  expect(seen.questions.length).toBe(1)
  expect(seen.urls).toEqual([URL('requests')])
})

test('an Edit that adds nothing new passes', async ($, on) => {
  const seen = fake($, on)
  const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/requirements.txt', old_string: 'click==8.1.7', new_string: '# pinned\nclick==8.1.7' })
  expect(r.deny).toBeUndefined()
  expect(seen.questions.length).toBe(0)
})

test('a Write that changes nothing passes, and one that adds a line triggers', async ($, on) => {
  const seen = fake($, on, { files: { '/repo/requirements-dev.txt': 'pytest==8.0.0\n' } })
  const same = await $.tool.call({ tool: 'Write', file_path: '/repo/requirements-dev.txt', content: 'pytest==8.0.0\n' })
  expect(same.deny).toBeUndefined()
  expect(seen.questions.length).toBe(0)
  await $.tool.call({ tool: 'Write', file_path: '/repo/requirements-dev.txt', content: 'pytest==8.0.0\nblack==24.1.0\n' })
  expect(seen.questions.length).toBe(1)
  expect(seen.urls).toContain(URL('black', '24.1.0'))
})

test('a pyproject Edit that adds a dependency triggers, metadata does not', async ($, on) => {
  const seen = fake($, on)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/pyproject.toml', old_string: '  "click>=8",', new_string: '  "click>=8",\n  "rich>=13",' })
  expect(seen.questions.length).toBe(1)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/pyproject.toml', old_string: 'version = "0.1.0"', new_string: 'version = "0.2.0"\nkeywords = ["etl"]' })
  expect(seen.questions.length).toBe(1)
})

test('other files pass through untouched', async ($, on) => {
  const seen = fake($, on)
  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/notes.txt', content: 'requests>=2.0' })
  expect(r.deny).toBeUndefined()
  expect(seen.questions.length).toBe(0)
})

test('a guard that breaks still denies', async ($, on) => {
  fake($, on, { broken: true })
  const r = await $.tool.call({ tool: 'Bash', command: 'pip install requests' })
  expect(r.deny).toBeDefined()
})
