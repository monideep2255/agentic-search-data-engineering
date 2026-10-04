import { test, expect } from 'claude-code/testing'

const file = (name: string) => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })

type Setup = {
  answer?: 'Proceed' | 'Cancel' | 'throw'
  dirs?: Record<string, string[]>
  isPlaced?: boolean
  broken?: boolean
}

function fake(on: any, s: Setup = {}) {
  const seen: { questions: string[]; listed: string[]; opened: string[] } = { questions: [], listed: [], opened: [] }
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions[0].question as string
      seen.questions.push(q)
      if (s.answer === 'throw') throw new Error('dismissed')
      return { result: { questions: e.questions, answers: { [q]: s.answer ?? 'Proceed' } } } as never
    }
    return { result: 'ran' } as never
  })
  on('session.repo', () => { if (s.broken) throw new Error('boom'); return { value: { root: '/repo', remote: null, internal: false } } })
  on('session.cwd', () => { if (s.broken) throw new Error('boom'); return { value: '/repo' } })
  on('fs.list', (_: unknown, e: { path: string }) => {
    seen.listed.push(e.path)
    const names = s.dirs?.[e.path]
    if (!names) throw new Error('missing')
    return { value: names.map(file) }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    seen.opened.push(e.id)
    return { value: s.isPlaced === false ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  return seen
}

const run = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

test('gene-etl asks, lists default directories, and proceeds on Proceed', async ($, on) => {
  const seen = fake(on, { dirs: { '/repo/data/kgx/gene': ['nodes.tsv', 'edges.tsv'], '/repo/data/ftp_cache': ['a.gz'] } })
  const r = await run($, 'gene-etl --tax-id 9606')
  expect(r.deny).toBeUndefined()
  expect(seen.questions.length).toBe(1)
  expect(seen.questions[0]).toContain('gene-etl')
  expect(seen.listed).toContain('/repo/data/kgx/gene')
  expect(seen.listed).toContain('/repo/data/ftp_cache')
  expect(seen.opened).toEqual(['pipeline-dry-run'])
})

test('python -m form triggers and a venv path triggers', async ($, on) => {
  const seen = fake(on)
  expect((await run($, 'python -m system_01_data_pipelines.clinvar.cli --skip-download')).deny).toBeUndefined()
  expect((await run($, './venv/bin/taxonomy-etl')).deny).toBeUndefined()
  expect(seen.questions.length).toBe(2)
})

test('--help and --version pass without a pane or a question', async ($, on) => {
  const seen = fake(on)
  expect((await run($, 'gene-etl --help')).deny).toBeUndefined()
  expect((await run($, 'age-load --version')).deny).toBeUndefined()
  expect(seen.questions.length).toBe(0)
  expect(seen.opened.length).toBe(0)
})

test('unrelated commands pass through', async ($, on) => {
  const seen = fake(on)
  expect((await run($, 'git status')).deny).toBeUndefined()
  expect((await run($, 'echo gene-etl')).deny).toBeUndefined()
  expect(seen.questions.length).toBe(0)
})

test('Cancel denies', async ($, on) => {
  fake(on, { answer: 'Cancel' })
  const r = await run($, 'merge-etl')
  expect(r.deny).toContain('mod-pipeline-dry-run')
})

test('a dismissed question denies', async ($, on) => {
  fake(on, { answer: 'throw' })
  const r = await run($, 'pubmed-etl')
  expect(r.deny).toBeDefined()
})

test('an environment override replaces the default output directory', async ($, on) => {
  const seen = fake(on)
  await run($, 'KGX_OUTPUT_DIR=/scratch/out gene-etl --skip-download')
  expect(seen.listed).toContain('/scratch/out/gene')
  expect(seen.listed).not.toContain('/repo/data/kgx/gene')
})

test('merge shows the input databases and the output subdirectory override', async ($, on) => {
  const seen = fake(on)
  await run($, 'merge-etl --databases gene,clinvar --output-subdir trial')
  expect(seen.listed).toContain('/repo/data/kgx/gene')
  expect(seen.listed).toContain('/repo/data/kgx/clinvar')
  expect(seen.listed).not.toContain('/repo/data/kgx/pubmed')
  expect(seen.listed).toContain('/repo/data/kgx/trial')
})

test('age-load shows its --kgx-dir override', async ($, on) => {
  const seen = fake(on)
  await run($, 'age-load --kgx-dir /scratch/merged --dsn postgresql://user:pw@host/db')
  expect(seen.listed).toContain('/scratch/merged')
})

test('a narrow terminal still asks (band fallback)', async ($, on) => {
  const seen = fake(on, { isPlaced: false })
  const r = await run($, 'medgen-etl')
  expect(r.deny).toBeUndefined()
  expect(seen.questions.length).toBe(1)
})

test('a guard that breaks still denies', async ($, on) => {
  fake(on, { broken: true })
  const r = await run($, 'gene-etl')
  expect(r.deny).toBeDefined()
})
