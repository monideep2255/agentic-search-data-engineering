import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { DependencyReport } from '../types/index.d.ts'
import { addedDependencies, fromCommand, isDependencyFile } from './plan.ts'
import type { Requested } from './plan.ts'
import { config } from './config.ts'

const PANE = 'dependency-check'
const report = atom({ plugin: 'mod-dependency-check', key: 'report' } as const, null as DependencyReport)

function denyOnFailure($: EngineInterface) {
  return { deny: `${$.plugin.name}: the guard failed while checking this call, so it was held. Retry, or ask the person to run it.` }
}

// Ask the person; anything other than exactly Proceed, or a dismissal, is Cancel.
// The wait happens inside $.ui.ask, so it never counts against the hook's budget.
async function confirm($: EngineInterface, question: string, header: string): Promise<boolean> {
  try {
    const answer = await $.ui.ask(question, { header, options: ['Proceed', 'Cancel'] })
    return answer === 'Proceed'
  } catch {
    return false // dismissed, or no one to ask
  }
}

type Release = { found: boolean; version?: string; uploaded?: number }

// One PyPI lookup. Never rejects: failed is true when PyPI could not be reached or read.
async function lookup($: EngineInterface, name: string, version?: string): Promise<{ failed: boolean; release: Release }> {
  const url = `${config.pypiBase}/${encodeURIComponent(name)}/${version ? encodeURIComponent(version) + '/' : ''}json`
  try {
    const res = await $.http.fetch(url)
    if (res.status === 404) return { failed: false, release: { found: false } }
    if (!res.ok) return { failed: true, release: { found: false } }
    const body = JSON.parse(res.text) as { info?: { version?: string }; urls?: { upload_time_iso_8601?: string }[] }
    const stamp = body.urls?.[0]?.upload_time_iso_8601
    const uploaded = stamp ? Date.parse(stamp) : NaN
    return { failed: false, release: { found: true, version: body.info?.version, uploaded: Number.isNaN(uploaded) ? undefined : uploaded } }
  } catch {
    return { failed: true, release: { found: false } }
  }
}

function days(now: number, then: number | undefined): number | undefined {
  return then === undefined ? undefined : Math.floor((now - then) / 86_400_000)
}

async function describePackage($: EngineInterface, r: Requested, now: number): Promise<string> {
  const requested = r.pinned ?? 'unpinned'
  const [latest, pinned] = await Promise.all([lookup($, r.name), r.pinned ? lookup($, r.name, r.pinned) : Promise.resolve(undefined)])
  if (latest.failed || pinned?.failed) return `${r.name} | requested: ${requested} | could not check PyPI`
  if (!latest.release.found) return `${r.name} | requested: ${requested} | latest: n/a | FLAG package not found`
  const flags: string[] = []
  if (!r.pinned) flags.push('unpinned')
  if (pinned && !pinned.release.found) flags.push('requested version not found')
  const age = days(now, latest.release.uploaded)
  const own = pinned?.release.found ? days(now, pinned.release.uploaded) : age
  if (own !== undefined && own < config.minAgeDays) flags.push(`uploaded ${own} days ago`)
  const when = age === undefined ? 'upload date unknown' : `uploaded ${age} days ago`
  return `${r.name} | requested: ${requested} | latest: ${latest.release.version ?? 'unknown'} (${when})${flags.length ? ' | FLAG ' + flags.join(', ') : ''}`
}

async function review($: EngineInterface, source: string, wanted: Requested[]): Promise<{ deny: string } | undefined> {
  const now = await $.clock.now()
  const shown = wanted.slice(0, config.maxPackages)
  const rows = await Promise.all(shown.map(r => describePackage($, r, now)))
  const lines = [`Source: ${source}`, ...rows]
  if (wanted.length > shown.length) lines.push(`${wanted.length - shown.length} more packages not checked`)
  lines.push('', 'Run the supply-chain checklist before Proceed.')

  await update($, report, () => ({ lines, isBand: false }))
  const opened = await $.ui.open({ id: PANE, title: 'Dependency check' })
  if (!opened.isPlaced) await update($, report, () => ({ lines, isBand: true }))
  const names = shown.map(r => r.name).join(', ')
  const ok = await confirm($, `Add ${names}? Run the supply-chain checklist first.`, 'Dependencies')
  await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, report, () => null)
  return ok ? undefined : { deny: `${$.plugin.name}: the person cancelled adding ${names}. Do not retry it; ask what to change first.` }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const wanted = fromCommand(e.command)
    if (wanted.length === 0) return next(e)
    const denied = await review($, 'command', wanted)
    return denied ?? next(e)
  }).catch(denyOnFailure)

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const kind = isDependencyFile(e.file_path)
    if (!kind) return next(e)
    const wanted = addedDependencies(kind, e.old_string, e.new_string)
    if (wanted.length === 0) return next(e)
    const denied = await review($, e.file_path, wanted)
    return denied ?? next(e)
  }).catch(denyOnFailure)

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const kind = isDependencyFile(e.file_path)
    if (!kind) return next(e)
    let before = ''
    try {
      const existing = await $.fs.read(e.file_path)
      if (typeof existing === 'string') before = existing
    } catch {
      before = '' // a new file: every dependency line is added
    }
    const wanted = addedDependencies(kind, before, e.content)
    if (wanted.length === 0) return next(e)
    const denied = await review($, e.file_path, wanted)
    return denied ?? next(e)
  }).catch(denyOnFailure)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, report)
    return (
      <Box flexDirection="column">
        {(r?.lines ?? ['No dependency change is waiting.']).map(l => <Text>{l}</Text>)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, report)
    if (!r || !r.isBand || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {r.lines.slice(0, Math.max(1, e.props.maxRows - 1)).map(l => <Text>{l}</Text>)}
      </Box>
    )
  })
}
