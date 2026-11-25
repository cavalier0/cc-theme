import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentRun, BgTask, Beat, EnvInfo, EnvKind, Plan, PlanStep, Prefs, SessionStatus, UsageSnap } from '../types'
import { DEFAULT_COLORS, ENV_LABEL, PRESETS, SCENE, SECTIONS, defaultPrefs, isHex, lookFor, sceneSvg } from './look'
import { SHELLS, replyWithTables, segmentsOf, shellCard, shellOutOf } from './cards'
import { ackSessions, hideSession, isWaiting, liveBeats, readAcks, readHostRecord, prefsStamp, publishBeat, readBeats, readHidden, readPrefs, readSamples, writePrefs, writeSamples } from './shared'
import { addSample, dur, tokens, windowsOf } from './usage'

type $ = EngineInterface

const PANE = 'cockpit'
const TITLE = 'Cockpit'
const STEP_TOOL = 'mcp__cavalier0-theme__step'
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'
const STEP_BRIEF =
  `\n\n(Progress: as you work, call ${STEP_TOOL} with done/total steps and a short note so the person can follow along. Optional and silent.)`

const envA = atom({ plugin: 'cavalier0-theme', key: 'env' } as const, null, { shape: 'env-1' })
const prefsA = atom({ plugin: 'cavalier0-theme', key: 'prefs' } as const, null, { shape: 'prefs-3' })
const usageA = atom({ plugin: 'cavalier0-theme', key: 'usage' } as const, null, { shape: 'usage-1' })
const tasksA = atom({ plugin: 'cavalier0-theme', key: 'tasks' } as const, [], { shape: 'tasks-1' })
const agentsA = atom({ plugin: 'cavalier0-theme', key: 'agents' } as const, [], { shape: 'agents-1' })
const planA = atom({ plugin: 'cavalier0-theme', key: 'plan' } as const, null, { shape: 'plan-1' })
const sessionsA = atom({ plugin: 'cavalier0-theme', key: 'sessions' } as const, [], { shape: 'sessions-1' })
const acksA = atom({ plugin: 'cavalier0-theme', key: 'acks' } as const, {}, { shape: 'acks-1' })
const hiddenA = atom({ plugin: 'cavalier0-theme', key: 'hidden' } as const, {}, { shape: 'hidden-1' })
const meA = atom({ plugin: 'cavalier0-theme', key: 'me' } as const, null, { shape: 'me-1' })
const viewA = atom({ plugin: 'cavalier0-theme', key: 'view' } as const, 'main')
const nowA = atom({ plugin: 'cavalier0-theme', key: 'now' } as const, 0)
const commandA = atom({ plugin: 'cavalier0-theme', key: 'command' } as const, '')
const outOpenA = atom({ plugin: 'cavalier0-theme', key: 'outOpen' } as const, false)

// ---------------------------------------------------------------- environment

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const base = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? p

const detectEnv = async ($: $): Promise<EnvInfo> => {
  const remote = await $.env.get('CLAUDE_CODE_REMOTE')
  const info = await $.session.info()
  const cwd = await $.session.cwd()
  const repo = await $.session.repo().catch(() => null)
  if (remote === 'true' || info.isHosted === true) {
    return { kind: 'cloud', detail: repo?.name ?? base(repo?.root ?? cwd) }
  }
  const c = norm(cwd)
  const isWorktree =
    (repo !== null && !c.startsWith(norm(repo.root))) || /\/\.claude\/worktrees\/|\/\.git\/worktrees\/|\/worktrees\//.test(c + '/')
  if (isWorktree) return { kind: 'worktree', detail: base(cwd) }
  return { kind: 'local', detail: base(repo?.root ?? cwd) }
}

// ---------------------------------------------------------------- prefs + look

let prefsSeen = 0

const savePrefs = async ($: $, fn: (p: Prefs) => Prefs) => {
  const next = await update($, prefsA, p => fn(p ?? defaultPrefs()))
  if (next) {
    await writePrefs($, next)
    prefsSeen = await prefsStamp($)
  }
  return next
}

/** Another session changed the shared settings: take them up and repaint. */
const followPrefs = async ($: $) => {
  const stamp = await prefsStamp($)
  if (stamp === 0 || stamp === prefsSeen) return
  prefsSeen = stamp
  const prefs = await readPrefs($)
  const had = await read($, prefsA)
  if (JSON.stringify(had) === JSON.stringify(prefs)) return
  await update($, prefsA, () => prefs)
  await applyLook($)
}

const applyLook = async ($: $) => {
  const env = await read($, envA)
  const prefs = (await read($, prefsA)) ?? defaultPrefs()
  if (!env) return
  const { args, problems } = lookFor(env.kind, prefs, true)
  const unpainted = problems.find(l => l.startsWith("Desktop won't paint"))
  if (unpainted) $.ui.log(`cavalier0-theme: ${unpainted}`)
  try {
    // Not drawn yet is normal: a session starts before the app's window attaches, and the
    // theme stands and draws once it does. Nothing to tell the person.
    await $.theme.set(args)
  } catch (err) {
    // A build that does not take `sound` yet: set the look again without it, quietly.
    const { args: plain } = lookFor(env.kind, prefs, false)
    await $.theme.set(plain).catch(again => $.ui.log(`cavalier0-theme: ${String(err)} / ${String(again)}`))
  }
}

const accentOf = async ($: $): Promise<string> => {
  const env = await read($, envA)
  const prefs = await read($, prefsA)
  const kind: EnvKind = env?.kind ?? 'local'
  return prefs?.colors[kind] ?? DEFAULT_COLORS[kind]
}

// ---------------------------------------------------------------- usage

const refreshUsage = async ($: $, given?: Awaited<ReturnType<$['session']['usage']>>) => {
  const u = given ?? (await $.session.usage())
  const at = await $.clock.now()
  const five = u.rateLimits.find(l => l.kind === 'five_hour')
  const week = u.rateLimits.find(l => l.kind === 'seven_day')
  let samples = await readSamples($)
  if (five || week) {
    const grown = addSample(samples, {
      at,
      five: five?.percentUsed,
      fiveReset: five?.resetsAt,
      week: week?.percentUsed,
      weekReset: week?.resetsAt,
    })
    if (grown !== samples) {
      samples = grown
      await writeSamples($, samples)
    }
  }
  const model = await $.session.model().catch(() => undefined)
  const snap: UsageSnap = {
    ...windowsOf(u.rateLimits, samples, at),
    contextTokens: u.context.tokens,
    contextWindow: u.context.window,
    contextPercent: u.context.percent,
    costUsd: u.cost?.usd,
    model,
  }
  await update($, usageA, () => snap)
}

// ---------------------------------------------------------------- mission control

const setStatus = async ($: $, status: SessionStatus) => {
  const at = await $.clock.now()
  await update($, meA, m => (m?.status === status ? m : { slot: -1, startedAt: at, ...m, status, since: at }))
}

/**
 * When this session's reply was last drawn on screen. A drawing may not write state,
 * so the render hook notes it here and the heartbeat acts on it. A turn that ends while
 * you watch is drawn just before it completes: the grace covers that.
 */
const seen = { at: 0 }
/** The desktop app's session ids, as its `claude://code/continue?session=` link takes them. */
const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/
/** A session that has sat read or untouched this long goes into the Idle group. */
const IDLE_MS = 60 * 60_000

/** The branch checked out in the session's folder, or undefined outside a repository. */
async function branchOf($: $): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined)
  const name = r && r.exitCode === 0 ? String(r.stdout).trim() : ''
  return name && name !== 'HEAD' ? name : undefined
}

/** Task notices seen while drawing (a drawing may not write state); the heartbeat applies them. */
const endedTasks = new Map<string, BgTask['status']>()
/** A background task we never hear back about is dropped after this long. */
const TASK_MAX_MS = 6 * 3600_000

async function settleTasks($: $) {
  const at = await $.clock.now()
  const list = await read($, tasksA)
  if (!list.some(t => t.status === 'running')) return
  const next = list.map(t => {
    if (t.status !== 'running') return t
    const ended = endedTasks.get(t.id)
    if (ended) return { ...t, status: ended, endedAt: at }
    if ((t.deadline && at > t.deadline + 60_000) || at - t.startedAt > TASK_MAX_MS) return { ...t, status: 'done' as const, endedAt: at }
    return t
  })
  if (JSON.stringify(next) !== JSON.stringify(list)) await update($, tasksA, () => next)
}

async function stopTask($: $, id: string) {
  try {
    await $.tool.call({ tool: 'TaskStop', task_id: id } as never)
    const at = await $.clock.now()
    await update($, tasksA, list => list.map(t => (t.id === id ? { ...t, status: 'stopped' as const, endedAt: at } : t)))
  } catch {
    $.ui.toast('Could not stop that task')
  }
}

/** Records a command or watcher the main loop left running, from its call and its result. */
async function recordBackground($: $, tool: string, input: Record<string, unknown>, result: unknown) {
  const isMonitor = tool === 'Monitor'
  if (!isMonitor && input.run_in_background !== true) return
  const out = (result ?? {}) as Record<string, unknown>
  const id = str(out.backgroundTaskId) ?? str(out.taskId)
  if (!id) return
  const at = await $.clock.now()
  const timeout = typeof out.timeoutMs === 'number' && out.timeoutMs > 0 ? out.timeoutMs : undefined
  const task: BgTask = {
    id,
    kind: isMonitor ? 'monitor' : 'shell',
    label: clip(str(input.description) ?? str(input.command) ?? tool, 80),
    startedAt: at,
    ...(timeout ? { deadline: at + timeout } : {}),
    status: 'running',
  }
  await update($, tasksA, list => [...list.filter(t => t.id !== id), task].slice(-30))
}

/** Marks sessions handled, so they stop counting as waiting on you until they finish again. */
async function clearWaiting($: $, done: Beat[]) {
  if (done.length === 0) return
  const live = (await read($, sessionsA)).map(b => b.id)
  const acks = await ackSessions($, done, live)
  await update($, acksA, () => acks)
}

/** Brings the desktop app to that session, through the app's own deep link. */
async function openSession($: $, hostId: string) {
  if (!HOST_ID.test(hostId)) return
  // explorer.exe hands a claude:// link to the desktop app; it exits 1 even when it worked.
  await $.process.run(['explorer.exe', `claude://code/continue?session=${hostId}`]).catch(() => $.ui.toast('Could not switch to that session'))
}
const SEEN_GRACE_MS = 3000

/** The desktop app's record of this session, re-read every 15 seconds. */
const host: { at: number; title?: string; isArchived: boolean; focusedAt?: number } = { at: 0, isArchived: false }

/** A first prompt as a label: without the tags the app wraps around it, and not a resumed session's summary. */
const promptLabel = (text: string): string | undefined => {
  const plain = text.replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/\s+/g, ' ').trim()
  if (!plain || plain.startsWith('<') || plain.startsWith('This session is being continued')) return undefined
  return plain
}

let lastBeat = ''
let lastBeatAt = 0

/** Writes this session's beat (when it changed, or every 30s to stay live) and reads everyone's. */
const pulse = async ($: $) => {
  const at = await $.clock.now()
  const me = await read($, meA)
  const env = await read($, envA)
  if (!me || !env) return
  const plan = await read($, planA)
  const agents = await read($, agentsA)
  const usage = await read($, usageA)
  const steps = plan?.steps ?? []
  const current = steps.find(s => s.status === 'in_progress')
  const id = await $.session.id()
  const hostId = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  const isHosted = !!hostId && HOST_ID.test(hostId)
  if (isHosted && at - host.at > 15_000) {
    const rec = await readHostRecord($, hostId)
    Object.assign(host, { at, title: rec?.title, isArchived: rec?.isArchived ?? false, focusedAt: rec?.lastFocusedAt })
  }
  // You switched to this session since it finished: it is no longer waiting on you.
  if (me.status === 'waiting' && host.focusedAt !== undefined && host.focusedAt >= me.since) {
    await setStatus($, 'seen')
    return pulse($)
  }
  const beat: Beat = {
    id,
    ...(isHosted ? { hostId } : {}),
    ...(host.title ? { title: host.title } : {}),
    kind: env.kind,
    detail: env.detail,
    label: clip(host.title ?? current?.content ?? me.firstPrompt ?? 'New session', 80),
    status: host.isArchived ? 'ended' : me.status,
    since: me.since,
    startedAt: me.startedAt,
    stepsDone: steps.filter(s => s.status === 'completed').length,
    stepsTotal: steps.length,
    agents: agents.filter(a => a.status === 'running').length,
    contextPercent: usage?.contextPercent,
    costUsd: usage?.costUsd,
    at,
  }
  const shape = JSON.stringify({ ...beat, at: 0 })
  if (shape !== lastBeat || at - lastBeatAt > 30_000 || me.slot < 0) {
    const slot = await publishBeat($, beat, me.slot)
    lastBeat = shape
    lastBeatAt = at
    if (slot !== me.slot) await update($, meA, m => (m ? { ...m, slot } : m))
  }
  const live = liveBeats(await readBeats($), at)
  // This session's own row is drawn from its live state, not from what it last wrote.
  const merged = live.some(b => b.id === id) ? live.map(b => (b.id === id ? beat : b)) : [...live, beat]
  const hidden = await readHidden($)
  if (JSON.stringify(hidden) !== JSON.stringify(await read($, hiddenA))) await update($, hiddenA, () => hidden)
  const acks = await readAcks($)
  if (JSON.stringify(acks) !== JSON.stringify(await read($, acksA))) await update($, acksA, () => acks)
  const before = await read($, sessionsA)
  if (JSON.stringify(before) !== JSON.stringify(merged)) await update($, sessionsA, () => merged)
}

// ---------------------------------------------------------------- agents

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** What a tool call is doing, in a few words. */
const describe = (tool: string, input: Record<string, unknown>): string => {
  const file = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path)
  switch (tool) {
    case 'Read':
      return `Reading ${file ? base(file) : 'a file'}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${file ? base(file) : 'a file'}`
    case 'Write':
      return `Writing ${file ? base(file) : 'a file'}`
    case 'Grep':
      return `Searching for "${clip(str(input.pattern) ?? '', 40)}"`
    case 'Glob':
      return `Finding ${clip(str(input.pattern) ?? 'files', 40)}`
    case 'Bash':
    case 'PowerShell':
      return str(input.description) ?? `Running ${clip(str(input.command) ?? 'a command', 50)}`
    case 'WebFetch':
      return `Fetching ${clip(str(input.url) ?? 'a page', 50)}`
    case 'WebSearch':
      return `Searching the web: ${clip(str(input.query) ?? '', 40)}`
    case 'Agent':
    case 'Task':
      return `Delegating: ${clip(str(input.description) ?? 'a subagent', 40)}`
    case STEP_TOOL:
      return 'Reporting progress'
    default:
      return tool.startsWith('mcp__') ? `Using ${tool.split('__').slice(1).join(' ')}` : `Using ${tool}`
  }
}

const syncAgents = async ($: $) => {
  const list = await read($, agentsA)
  if (!list.some(a => a.status === 'running')) return
  const infos = await $.agent.list().catch(() => [])
  const at = await $.clock.now()
  await update($, agentsA, runs =>
    runs.map(a => {
      const info = infos.find(i => i.id === a.id)
      if (!info) return a
      const ended = info.status === 'completed' || info.status === 'failed' || info.status === 'killed'
      return {
        ...a,
        model: info.model ?? a.model,
        tokens: info.tokenCount || a.tokens,
        contextWindow: info.contextWindowSize ?? a.contextWindow,
        costUsd: info.cost?.usd ?? a.costUsd,
        ...(ended && a.status === 'running'
          ? { status: info.status === 'completed' ? ('done' as const) : ('failed' as const), endedAt: at, action: undefined }
          : {}),
      }
    }),
  )
}

/** Opens the cockpit full size, or closes it when it is up. */
async function toggleCockpit($: $) {
  const isUp = (await $.ui.panes()).some(p => p.id === PANE)
  if (isUp) await $.ui.close({ id: PANE })
  else await $.ui.open({ id: PANE, title: TITLE })
}

const expand = async ($: $) => {
  await $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
}

// ---------------------------------------------------------------- plan

const applyPlan = (steps: PlanStep[], input: Record<string, unknown>, at: number): PlanStep[] => {
  const set = (s: PlanStep, status: PlanStep['status']): PlanStep =>
    s.status === status
      ? s
      : {
          ...s,
          status,
          ...(status === 'in_progress' ? { startedAt: s.startedAt ?? at } : {}),
          ...(status === 'completed' ? { endedAt: at, startedAt: s.startedAt ?? at } : {}),
        }
  let out = steps
  if (Array.isArray(input.items)) {
    out = (input.items as { content?: string; status?: string }[]).map((it, i) => {
      const status = (it.status === 'completed' || it.status === 'in_progress' ? it.status : 'pending') as PlanStep['status']
      const prev = steps.find(s => s.content === it.content) ?? steps[i]
      const kept = prev && prev.content === it.content ? prev : undefined
      return set({ content: String(it.content ?? ''), status: kept?.status ?? 'pending', startedAt: kept?.startedAt, endedAt: kept?.endedAt }, status)
    })
  }
  if (input.advance === true) {
    const cur = out.findIndex(s => s.status === 'in_progress')
    if (cur >= 0) out = out.map((s, i) => (i === cur ? set(s, 'completed') : s))
    const nxt = out.findIndex(s => s.status === 'pending')
    if (nxt >= 0) out = out.map((s, i) => (i === nxt ? set(s, 'in_progress') : s))
  }
  if (Array.isArray(input.done)) {
    const done = (input.done as number[]).map(n => n - 1)
    out = out.map((s, i) => (done.includes(i) ? set(s, 'completed') : s))
  }
  if (typeof input.start === 'number') {
    const st = input.start - 1
    out = out.map((s, i) => (i === st ? set(s, 'in_progress') : s))
  }
  return out
}

// ---------------------------------------------------------------- register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, envA, () => null)
    const env = await detectEnv($).catch((): EnvInfo => ({ kind: 'local', detail: '' }))
    const prefs = await readPrefs($)
    prefsSeen = await prefsStamp($)
    await update($, envA, () => env)
    const branch = await branchOf($).catch(() => undefined)
    if (branch) await update($, envA, en => (en ? { ...en, branch } : en))
    await update($, prefsA, () => prefs)
    await applyLook($)

    await $.command.register({ name: 'cockpit', description: 'Open the cockpit pane (usage, agents, plan); `/cockpit settings` for colours and toggles' })
    await $.tool.register({
      name: 'step',
      description:
        'For subagents: report progress on your own task to the cockpit pane. Call it with `total` (your plan in 3-8 steps) and `done: 0` once you have a plan, then again as each step finishes. Cheap and silent.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      isDeferred: false,
    })

    await refreshUsage($).catch(() => undefined)
    void $.ui.open({ id: PANE, title: TITLE, placement: 'widget' })

    const startedAt = (await $.session.usage().catch(() => undefined))?.startedAt || (await $.clock.now())
    const kept = await read($, meA)
    if (!kept) await update($, meA, () => ({ status: 'starting' as const, since: startedAt, startedAt, slot: -1 }))
    // A session resumed or already open before the mod loaded: label it by its first prompt.
    if (!(await read($, meA))?.firstPrompt) {
      const first = (await $.session.messages().catch(() => []))
        .filter(m => m.role === 'user')
        .map(m => promptLabel(m.text))
        .find(text => text !== undefined)
      if (first) await update($, meA, m => (m ? { ...m, firstPrompt: clip(first, 80) } : m))
    }
    await pulse($).catch(() => undefined)

    // A light heartbeat: clocks for running agents every second, usage every minute.
    let ticks = 0
    $.clock.every(1000, () => {
      void (async () => {
        ticks++
        const t = await $.clock.now()
        const list = await read($, agentsA)
        const running = list.some(a => a.status === 'running')
        if (running || ticks % 30 === 0) await update($, nowA, () => t)
        if (running && ticks % 2 === 0) await syncAgents($)
        if (ticks % 60 === 0) await refreshUsage($).catch(() => undefined)
        // You opened this session and its reply was on screen: it is no longer waiting on you.
        const me = await read($, meA)
        if (me?.status === 'waiting' && seen.at >= me.since - SEEN_GRACE_MS) {
          await setStatus($, 'seen')
          await pulse($).catch(() => undefined)
        }
        if (ticks % 30 === 0) {
          const branch = await branchOf($).catch(() => undefined)
          await update($, envA, en => (en && en.branch !== branch ? { ...en, branch } : en))
        }
        if (ticks % 3 === 0) await settleTasks($).catch(() => undefined)
        if (ticks % 5 === 0) {
          await pulse($).catch(() => undefined)
          await followPrefs($).catch(() => undefined)
          await update($, nowA, () => t)
        }
      })()
    })
    const t = await $.clock.now()
    await update($, nowA, () => t)
    return started
  })

  on('session.measure', async ($, e, next) => {
    await refreshUsage($, { startedAt: 0, context: e.context, rateLimits: e.rateLimits, cost: e.cost }).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async ($, e) => {
    const wantsSettings = (e.args ?? '').trim().startsWith('settings')
    await update($, viewA, () => (wantsSettings ? 'settings' : 'main'))
    await expand($)
    return { text: wantsSettings ? 'Cockpit settings opened.' : 'Cockpit opened.' }
  })

  // ---- subagents
  on('agent.spawn', async ($, e, next) => {
    const started = await next({ ...e, prompt: e.prompt + STEP_BRIEF })
    if (started.deny !== undefined) return started
    const at = await $.clock.now()
    const run: AgentRun = {
      id: started.agentId ?? e.tool_use_id,
      type: e.subagentType,
      description: e.description,
      brief: clip(e.prompt.replace(/\s+/g, ' ').trim(), 280),
      model: started.model,
      status: 'running',
      startedAt: at,
      actions: 0,
      tokens: 0,
    }
    await update($, agentsA, list => [...list.filter(a => a.id !== run.id), run].slice(-50))
    await update($, nowA, () => at)
    await expand($)
    return started
  })

  // ---- background commands and watchers
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId) await recordBackground($, 'Bash', e as unknown as Record<string, unknown>, ran.result).catch(() => undefined)
    return ran
  })
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId) await recordBackground($, 'PowerShell', e as unknown as Record<string, unknown>, ran.result).catch(() => undefined)
    return ran
  })
  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId) await recordBackground($, 'Monitor', e as unknown as Record<string, unknown>, ran.result).catch(() => undefined)
    return ran
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as Record<string, unknown>
    const id = str(input.task_id) ?? str(input.shell_id)
    if (id) endedTasks.set(id, 'stopped')
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const task = e.props.task
    if (e.props.origin.kind === 'task-notification' && task?.id) {
      const s = String(task.status ?? '')
      endedTasks.set(task.id, s === 'failed' ? 'failed' : s === 'killed' ? 'stopped' : 'done')
    }
    return next(e)
  })

  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    await update($, agentsA, list =>
      list.map(a => {
        if (a.id !== agentId) return a
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, stepTotal: total || undefined, stepDone: total ? Math.min(total, done) : done, stepNote: str(input.note) }
      }),
    )
    return { result: 'ok' }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>

    if (SHELLS.has(tool) && typeof input.command === 'string') {
      const command = input.command.replace(/\s+/g, ' ').trim()
      await update($, memberOf(commandA, { requestId: e.tool_use_id }), () => command)
    }

    if (e.agentId && tool !== STEP_TOOL) {
      const id = e.agentId
      const action = describe(tool, input)
      await update($, agentsA, list => (list.some(a => a.id === id) ? list.map(a => (a.id === id ? { ...a, action, actions: a.actions + 1 } : a)) : list))
    }

    if (!e.agentId && (tool === PLAN_TOOL || tool === 'TodoWrite')) {
      const at = await $.clock.now()
      const plan =
        tool === 'TodoWrite'
          ? {
              items: ((input.todos as { content?: string; status?: string }[] | undefined) ?? []).map(t => ({ content: t.content, status: t.status })),
            }
          : input
      const had = await read($, planA)
      const updated = await update($, planA, p => ({ steps: applyPlan(p?.steps ?? [], plan, at), updatedAt: at }))
      if (!had?.steps.length && updated?.steps.length) await expand($)
    }
    if (!e.agentId && tool === WRAP_TOOL) {
      const at = await $.clock.now()
      await update($, planA, p => (p ? { steps: p.steps.map(s => (s.status === 'completed' ? s : { ...s, status: 'completed' as const, endedAt: at })), updatedAt: at } : p))
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // an observer: a failure here never blocks the call

  // ---- this session's status, for mission control
  on('prompt.submit', async ($, e, next) => {
    const text = promptLabel(e.text)
    if (text && !e.isMeta) await update($, meA, m => (m && !m.firstPrompt ? { ...m, firstPrompt: clip(text, 80) } : m))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await setStatus($, 'working')
      void pulse($).catch(() => undefined)
    }
    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    await setStatus($, 'asking')
    void pulse($).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      await setStatus($, 'working')
    }
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await setStatus($, 'ended')
    await pulse($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await setStatus($, 'waiting')
      void pulse($).catch(() => undefined)
    }
    if (e.agentId) {
      const id = e.agentId
      const at = await $.clock.now()
      await update($, agentsA, list =>
        list.map(a =>
          a.id === id && a.status === 'running'
            ? { ...a, status: e.reason === 'answer' ? ('done' as const) : ('failed' as const), endedAt: at, action: undefined }
            : a,
        ),
      )
      await syncAgents($).catch(() => undefined)
    }
    return next(e)
  })

  // ---- transcript cards (desktop and mobile; the terminal keeps its own rows)
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || !SHELLS.has(String(e.props.tool))) return next(e)
    const out = shellOutOf(e.props.output)
    if (!out) return next(e)
    const ui = $.ui.resolve(e)
    const open = memberOf(outOpenA, e)
    return shellCard(ui, await accentOf($), await read($, memberOf(commandA, e)), out, e.props.isErrored === true, await read($, open), () =>
      void update($, open, v => !v),
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.onScreen) seen.at = await $.clock.now()
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const segments = segmentsOf(e.props.text)
    if (!segments) return next(e)
    return replyWithTables($.ui.resolve(e), await accentOf($), segments)
  })

  // ---- the band above the prompt: sessions at a glance, usage, and the cockpit's toggle
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prefs = (await read($, prefsA)) ?? defaultPrefs()
    if (e.props.hasSurvey || !prefs.band) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const hidden = await read($, hiddenA)
    const sessions = (await read($, sessionsA)).filter(b => !(hidden[b.id] !== undefined && b.since <= hidden[b.id]!))
    const usage = await read($, usageA)
    const meId = (await read($, meA)) ? await $.session.id() : ''
    const acks = await read($, acksA)
    const waiting = sessions.filter(b => b.id !== meId && isWaiting(b, acks))
    const tone = (pct: number | undefined) => (pct === undefined ? undefined : pct >= 90 ? 'error' : pct >= 75 ? 'warning' : undefined)
    const pct = (w: UsageSnap['fiveHour']) => (w ? `${Math.round(w.percent)}%` : '–')
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} alignItems="center">
          {sessions.length > 1
            ? sessions.map(b => (
                <Text key={`bd-${b.id}`} color={prefs.colors[b.kind] ?? DEFAULT_COLORS[b.kind]}>
                  {b.id !== meId && isWaiting(b, acks) ? '◉' : b.status === 'working' ? '●' : '○'}
                </Text>
              ))
            : null}
          {waiting.length > 0 ? <Text color="warning">{`${waiting.length} waiting on you`}</Text> : null}
          {waiting.length > 0 ? <Button key="clear-waiting" plain dimColor label="✓" onPress={() => void clearWaiting($, waiting)} /> : null}
          <Text dimColor>·</Text>
          <Text dimColor={!tone(usage?.fiveHour?.percent)} color={tone(usage?.fiveHour?.percent)}>{`5h ${pct(usage?.fiveHour)}`}</Text>
          <Text dimColor={!tone(usage?.week?.percent)} color={tone(usage?.week?.percent)}>{`wk ${pct(usage?.week)}`}</Text>
          {usage?.contextPercent !== undefined ? (
            <Text dimColor={!tone(usage.contextPercent)} color={tone(usage.contextPercent)}>{`ctx ${Math.round(usage.contextPercent)}%`}</Text>
          ) : null}
        </Box>
        <Button key="cockpit-toggle" label="Cockpit" onPress={() => void toggleCockpit($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'ContextMenu' }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Button key="toggle-cockpit" onPress={() => void toggleCockpit($)}>
          Toggle cockpit <Text dimColor>Usage, sessions, agents, plan</Text>
        </Button>
      </Box>
    )
  })

  // ---- backdrop
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE) return next(e)
    const { Svg } = $.ui.resolve(e)
    return <Svg source={sceneSvg(await accentOf($))} alt="Slow drifting light, tinted by environment" />
  })

  // ---- the cockpit
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Progress, Select, Input } = $.ui.resolve(e)
    const env = await read($, envA)
    const prefs = (await read($, prefsA)) ?? defaultPrefs()
    const usage = await read($, usageA)
    const agents = await read($, agentsA)
    const plan = await read($, planA)
    const view = await read($, viewA)
    const hidden = await read($, hiddenA)
    const sessions = (await read($, sessionsA)).filter(b => !(hidden[b.id] !== undefined && b.since <= hidden[b.id]!))
    const meId = (await read($, meA)) ? await $.session.id() : ''
    const now = (await read($, nowA)) || Date.now()
    const kind: EnvKind = env?.kind ?? 'local'
    const accent = prefs.colors[kind] ?? DEFAULT_COLORS[kind]
    const isWidget = e.props.placement === 'widget'

    const level = (pct: number | undefined) => (pct === undefined ? accent : pct >= 90 ? 'error' : pct >= 75 ? 'warning' : accent)
    const chip = (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text backgroundColor={accent} color="#101010" bold>
          {` ${ENV_LABEL[kind]} `}
        </Text>
        {env?.detail ? <Text dimColor wrap="truncate">{env.branch ? `${env.detail} · ${env.branch}` : env.detail}</Text> : null}
      </Box>
    )

    const windowRow = (key: string, label: string, w: UsageSnap['fiveHour']) => {
      if (!w) return <Text key={key} dimColor>{label}: no reading yet</Text>
      const beatsReset = w.fullInMin !== undefined && (w.resetInMin === undefined || w.fullInMin < w.resetInMin)
      return (
        <Box key={key} flexDirection="column">
          <Progress label={label} value={w.percent} max={100} valueText={`${Math.round(w.percent)}% · resets ${dur(w.resetInMin)}`} color={level(w.percent)} />
          {!isWidget && (
            <Text size="footnote" color={beatsReset ? 'warning' : undefined} dimColor={!beatsReset}>
              {w.fullInMin === undefined
                ? 'Pace: steady'
                : beatsReset
                  ? `At this pace: full in ${dur(w.fullInMin)}, before it resets`
                  : `At this pace: ${dur(w.fullInMin)} to full, resets first`}
            </Text>
          )}
        </Box>
      )
    }

    const ctxPct = usage?.contextPercent ?? (usage?.contextTokens && usage.contextWindow ? (100 * usage.contextTokens) / usage.contextWindow : undefined)
    const contextRow = (
      <Progress
        key="ctx"
        label="Context"
        value={ctxPct ?? 0}
        max={100}
        valueText={ctxPct === undefined ? '–' : `${Math.round(ctxPct)}% · ${tokens(usage?.contextTokens ?? 0)}/${tokens(usage?.contextWindow ?? 0)}`}
        color={level(ctxPct)}
      />
    )

    const running = agents.filter(a => a.status === 'running')

    // ---- mission control: every live session on this machine
    const acks = await read($, acksA)
    const needsYou = (b: Beat) => isWaiting(b, acks)
    const waiting = sessions.filter(b => b.id !== meId && needsYou(b))
    const colorOfKind = (k: EnvKind) => prefs.colors[k] ?? DEFAULT_COLORS[k]
    const statusOf = (b: Beat): { text: string; color?: string; dim?: boolean } => {
      const ago = dur((now - b.since) / 60_000)
      switch (b.status) {
        case 'asking':
          return { text: `needs an answer · ${ago}`, color: 'warning' }
        case 'waiting':
          return { text: `your move · ${ago}`, color: 'warning' }
        case 'seen':
          return { text: `read · ${ago}`, dim: true }
        case 'working':
          return { text: `working · ${ago}`, color: colorOfKind(b.kind) }
        default:
          return { text: 'new', dim: true }
      }
    }
    const dots =
      sessions.length > 1 ? (
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          {sessions.map(b => (
            <Text key={`dot-${b.id}`} color={colorOfKind(b.kind)} bold={b.id === meId}>
              {needsYou(b) && b.id !== meId ? '◉' : b.status === 'working' ? '●' : '○'}
            </Text>
          ))}
          <Text dimColor size="footnote">
            {waiting.length ? `${waiting.length} waiting on you` : `${sessions.length} sessions`}
          </Text>
          {waiting.length ? <Button key="clear-waiting" plain dimColor label="✓" onPress={() => void clearWaiting($, waiting)} /> : null}
        </Box>
      ) : null
    const sessionRow = (b: Beat) => {
      const st = statusOf(b)
      const isMe = b.id === meId
      const facts = [
        b.detail,
        b.stepsTotal ? `${b.stepsDone}/${b.stepsTotal} steps` : '',
        b.agents ? `${b.agents} agent${b.agents > 1 ? 's' : ''}` : '',
        b.contextPercent !== undefined ? `ctx ${Math.round(b.contextPercent)}%` : '',
        b.costUsd !== undefined ? `~$${b.costUsd.toFixed(2)}` : '',
      ].filter(Boolean)
      const room = Math.max(12, (e.props.bodyColumns ?? 40) - 8)
      const title = (
        <Text bold={!isMe || needsYou(b)} wrap="truncate-end">
          {clip(isMe ? `${b.label} (this session)` : b.label, room)}
        </Text>
      )
      const hostId = b.hostId
      const live = sessions.map(x => x.id)
      return (
        <Box key={`s-${b.id}`} flexDirection="row" gap={1} width="100%">
          <Box flexShrink={0}>
            {needsYou(b) && !isMe ? (
              <Button key={`ack-${b.id}`} plain onPress={() => void clearWaiting($, [b])}>
                <Text color={colorOfKind(b.kind)}>◉</Text>
              </Button>
            ) : (
              <Text color={colorOfKind(b.kind)}>▌</Text>
            )}
          </Box>
          <Box flexDirection="column" flexShrink={1} flexGrow={1} minWidth={0} overflow="hidden">
            {!isMe && hostId ? (
              <Button key={`go-${b.id}`} plain onPress={() => void openSession($, hostId)}>
                {title}
              </Button>
            ) : (
              title
            )}
            <Text size="footnote" color={st.color} dimColor={st.dim}>
              {`${ENV_LABEL[b.kind].toLowerCase()} · ${st.text}`}
            </Text>
            <Text size="footnote" dimColor wrap="truncate-end">
              {clip(facts.join(' · '), room + 6)}
            </Text>
          </Box>
          <Box flexShrink={0}>
          <Button
            key={`hide-${b.id}`}
            plain
            dimColor
            label="✕"
            onPress={() =>
              void (async () => {
                await hideSession($, b.id, b.since, live)
                await update($, hiddenA, h => ({ ...h, [b.id]: b.since }))
              })()
            }
          />
          </Box>
        </Box>
      )
    }
    const isIdle = (b: Beat) => b.id !== meId && (b.status === 'seen' || b.status === 'starting') && now - b.since > IDLE_MS
    const order = (list: Beat[]) => [...list.filter(b => needsYou(b) && b.id !== meId), ...list.filter(b => !(needsYou(b) && b.id !== meId))]
    const active = order(sessions.filter(b => !isIdle(b)))
    const idle = sessions.filter(isIdle)

    if (isWidget && view !== 'settings') {
      return (
        <Box flexDirection="column" gap={1}>
          {chip}
          {dots}
          {windowRow('5h', '5h', usage?.fiveHour)}
          {windowRow('wk', 'Week', usage?.week)}
          {contextRow}
          {running.length > 0 && <Text color={accent}>{`${running.length} agent${running.length > 1 ? 's' : ''} working`}</Text>}
        </Box>
      )
    }

    // ---- settings view
    if (view === 'settings') {
      const kinds: EnvKind[] = ['local', 'cloud', 'worktree']
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>Settings</Text>
            <Button key="back" label="Done" onPress={() => void update($, viewA, () => 'main')} />
          </Box>
          <Text dimColor size="footnote">Colours are saved on this machine and used by every session here.</Text>
          {kinds.map(k => {
            const cur = prefs.colors[k] ?? DEFAULT_COLORS[k]
            const preset = PRESETS.find(p => p.hex.toLowerCase() === cur.toLowerCase())
            return (
              <Box key={`env-${k}`} flexDirection="column" gap={0}>
                <Box flexDirection="row" gap={1}>
                  <Text backgroundColor={cur} color="#101010" bold>{` ${ENV_LABEL[k]} `}</Text>
                  {k === kind ? <Text dimColor>(this session)</Text> : null}
                </Box>
                <Select
                  key={`sel-${k}`}
                  label="Colour"
                  value={preset?.hex ?? 'custom'}
                  options={[...PRESETS.map(p => ({ value: p.hex, label: p.label })), { value: 'custom', label: preset ? 'Custom…' : `Custom (${cur})` }]}
                  onSelect={value => {
                    if (!isHex(value)) return
                    void (async () => {
                      await savePrefs($, p => ({ ...p, colors: { ...p.colors, [k]: value } }))
                      await applyLook($)
                    })()
                  }}
                />
                <Input
                  key={`hex-${k}`}
                  label="Hex"
                  placeholder="#3fb3a8"
                  value={cur}
                  submitLabel="Set"
                  onSubmit={text => {
                    const v = text.trim()
                    if (!isHex(v)) return
                    void (async () => {
                      await savePrefs($, p => ({ ...p, colors: { ...p.colors, [k]: v.toLowerCase() } }))
                      await applyLook($)
                    })()
                  }}
                />
              </Box>
            )
          })}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button
              key="sound"
              label={`Sounds: ${prefs.sound ? 'on' : 'off'}`}
              onPress={() =>
                void (async () => {
                  await savePrefs($, p => ({ ...p, sound: !p.sound }))
                  await applyLook($)
                })()
              }
            />
            <Button
              key="backdrop"
              label={`Backdrop: ${prefs.backdrop ? 'on' : 'off'}`}
              onPress={() =>
                void (async () => {
                  await savePrefs($, p => ({ ...p, backdrop: !p.backdrop }))
                  await applyLook($)
                })()
              }
            />
            <Button key="band" label={`Band: ${prefs.band ? 'on' : 'off'}`} onPress={() => void savePrefs($, p => ({ ...p, band: !p.band }))} />
            <Button
              key="reset"
              label="Reset colours"
              onPress={() =>
                void (async () => {
                  await savePrefs($, p => ({ ...p, colors: { ...DEFAULT_COLORS } }))
                  await applyLook($)
                })()
              }
            />
          </Box>
          <Text dimColor size="footnote">Sounds play once you turn on the speaker in the session's title bar.</Text>
          <Text bold>Section order</Text>
          {prefs.order.map((id, i) => {
            const move = (to: number) =>
              void savePrefs($, p => {
                const o = [...p.order]
                const [it] = o.splice(i, 1)
                if (it !== undefined) o.splice(to, 0, it)
                return { ...p, order: o }
              })
            return (
              <Box key={`ord-${id}`} flexDirection="row" gap={1} alignItems="center">
                <Box flexGrow={1}>
                  <Text>{`${i + 1}. ${SECTIONS.find(s => s.id === id)?.title ?? id}`}</Text>
                </Box>
                {i > 0 ? <Button key={`up-${id}`} plain label="↑" onPress={() => move(i - 1)} /> : null}
                {i < prefs.order.length - 1 ? <Button key={`down-${id}`} plain label="↓" onPress={() => move(i + 1)} /> : null}
              </Box>
            )
          })}
        </Box>
      )
    }

    // ---- main view
    const isFolded = (id: string) => prefs.folded.includes(id)
    const header = (id: string, title: string, extra?: string) => (
      <Button
        key={`h-${id}`}
        plain
        onPress={() => void savePrefs($, p => ({ ...p, folded: p.folded.includes(id) ? p.folded.filter(x => x !== id) : [...p.folded, id] }))}
      >
        <Text bold>{`${isFolded(id) ? '▸' : '▾'} ${title}`}</Text>
        {extra ? <Text dimColor>{`  ${extra}`}</Text> : ''}
      </Button>
    )

    const agentCard = (a: AgentRun) => {
      const elapsed = ((a.endedAt ?? now) - a.startedAt) / 60_000
      const dot = a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✕'
      const dotColor = a.status === 'running' ? accent : a.status === 'done' ? 'success' : 'error'
      const ctx = a.contextWindow && a.tokens ? ` · ctx ${Math.min(100, Math.round((100 * a.tokens) / a.contextWindow))}%` : ''
      return (
        <Box key={`a-${a.id}`} flexDirection="column" borderStyle="round" borderColor={a.status === 'running' ? accent : undefined} borderDimColor={a.status !== 'running'} paddingX={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={dotColor}>{dot}</Text>
            <Text bold wrap="truncate">{a.description || a.type}</Text>
          </Box>
          {a.status === 'running' && <Text color={accent} wrap="truncate">{a.stepNote ?? a.action ?? 'Thinking…'}</Text>}
          {a.stepTotal ? <Progress label="Steps" value={a.stepDone ?? 0} max={a.stepTotal} valueText={`${a.stepDone ?? 0}/${a.stepTotal}`} color={accent} /> : null}
          {!isFolded('briefs') && <Text dimColor size="footnote" maxLines={2}>{a.brief}</Text>}
          <Text dimColor size="footnote">
            {`${a.model ?? a.type} · ${dur(elapsed)} · ${a.actions} actions · ${tokens(a.tokens)} tok${ctx}${a.costUsd !== undefined ? ` · ~$${a.costUsd.toFixed(2)}` : ''}`}
          </Text>
        </Box>
      )
    }

    const tasks = await read($, tasksA)
    const liveTasks = tasks.filter(t => t.status === 'running')
    const pastTasks = tasks.filter(t => t.status !== 'running').slice(-3).reverse()
    const taskRow = (t: BgTask) => {
      const isLive = t.status === 'running'
      const took = dur(((t.endedAt ?? now) - t.startedAt) / 60_000)
      const mark = isLive ? '●' : t.status === 'done' ? '✓' : t.status === 'failed' ? '✕' : '■'
      const markColor = isLive ? accent : t.status === 'done' ? 'success' : t.status === 'failed' ? 'error' : undefined
      return (
        <Box key={`t-${t.id}`} flexDirection="row" gap={1} width="100%">
          <Box flexShrink={0}>
            <Text color={markColor} dimColor={!isLive && t.status === 'stopped'}>{mark}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text dimColor={!isLive} wrap="truncate-end">{clip(t.label, Math.max(12, (e.props.bodyColumns ?? 40) - 12))}</Text>
            <Text size="footnote" dimColor>{`${t.kind === 'monitor' ? 'watcher' : 'command'} · ${isLive ? 'running' : t.status} · ${took}`}</Text>
          </Box>
          {isLive ? (
            <Box flexShrink={0}>
              <Button key={`stop-${t.id}`} plain dimColor label="■ Stop" onPress={() => void stopTask($, t.id)} />
            </Box>
          ) : null}
        </Box>
      )
    }
    const finished = agents.filter(a => a.status !== 'running').slice(-5).reverse()
    const agentsCost = agents.reduce((sum, a) => sum + (a.costUsd ?? 0), 0)
    const agentsSummary = agents.length
      ? [
          running.length ? `${running.length} running` : '',
          `${agents.length} total`,
          agents.some(a => a.costUsd !== undefined) ? `~$${agentsCost.toFixed(2)}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : 'none'
    const steps = plan?.steps ?? []
    const doneCount = steps.filter(s => s.status === 'completed').length
    const idleOpen = prefs.folded.includes('idle:open')

    const blocks: Record<string, RenderChildren> = {
      sessions: (
        <Box key="b-sessions" flexDirection="column" gap={1}>
          {header('sessions', 'Sessions', `${sessions.length} live${waiting.length ? ` · ${waiting.length} waiting on you` : ''}`)}
          {!isFolded('sessions') && (
            <Box flexDirection="column" gap={1}>
              {waiting.length > 0 && (
                <Button key="clear-waiting" plain onPress={() => void clearWaiting($, waiting)}>
                  <Text dimColor>{`✓ Mark ${waiting.length === 1 ? 'it' : `all ${waiting.length}`} handled`}</Text>
                </Button>
              )}
              {active.map(sessionRow)}
              {idle.length > 0 && (
                <Button
                  key="idle-toggle"
                  plain
                  onPress={() => void savePrefs($, p => ({ ...p, folded: idleOpen ? p.folded.filter(x => x !== 'idle:open') : [...p.folded, 'idle:open'] }))}
                >
                  <Text dimColor>{`${idleOpen ? '▾' : '▸'} Idle · ${idle.length}`}</Text>
                </Button>
              )}
              {idleOpen && idle.map(sessionRow)}
              {sessions.length <= 1 && <Text dimColor size="footnote">Other sessions on this PC show up here once they run this mod.</Text>}
            </Box>
          )}
        </Box>
      ),
      usage: (
        <Box key="b-usage" flexDirection="column" gap={1}>
          {header('usage', 'Usage', usage?.model)}
          {!isFolded('usage') && (
            <Box flexDirection="column" gap={1}>
              {windowRow('5h', '5-hour', usage?.fiveHour)}
              {windowRow('wk', 'Weekly', usage?.week)}
              {contextRow}
              {usage?.costUsd !== undefined && <Text dimColor size="footnote">{`This session ≈ $${usage.costUsd.toFixed(2)} at API prices`}</Text>}
            </Box>
          )}
        </Box>
      ),
      agents: (
        <Box key="b-agents" flexDirection="column" gap={1}>
          {header('agents', 'Agents', agentsSummary)}
          {!isFolded('agents') && (
            <Box flexDirection="column" gap={1}>
              {agents.length === 0 && <Text dimColor size="footnote">Subagents show up here with what they're doing.</Text>}
              {running.map(agentCard)}
              {finished.map(agentCard)}
            </Box>
          )}
        </Box>
      ),
      tasks: (
        <Box key="b-tasks" flexDirection="column" gap={1}>
          {header('tasks', 'Background', liveTasks.length ? `${liveTasks.length} running` : 'none')}
          {!isFolded('tasks') && (
            <Box flexDirection="column" gap={1}>
              {tasks.length === 0 && <Text dimColor size="footnote">Commands and watchers left running in the background show up here.</Text>}
              {liveTasks.map(taskRow)}
              {pastTasks.map(taskRow)}
            </Box>
          )}
        </Box>
      ),
      plan: (
        <Box key="b-plan" flexDirection="column" gap={1}>
          {header('plan', 'Plan', steps.length ? `${doneCount}/${steps.length}` : 'none yet')}
          {!isFolded('plan') && (
            <Box flexDirection="column">
              {steps.length === 0 && <Text dimColor size="footnote">The current plan's steps show up here.</Text>}
              {steps.map((s, i) => {
                const took = s.startedAt ? dur(((s.endedAt ?? now) - s.startedAt) / 60_000) : ''
                return (
                  <Box key={`p-${i}`} flexDirection="row" gap={1}>
                    <Text color={s.status === 'completed' ? 'success' : s.status === 'in_progress' ? accent : undefined} dimColor={s.status === 'pending'}>
                      {s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '▸' : '○'}
                    </Text>
                    <Text bold={s.status === 'in_progress'} dimColor={s.status === 'completed'}>
                      {s.content}
                    </Text>
                    {took && s.status !== 'pending' ? <Text dimColor size="footnote">{took}</Text> : null}
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      ),
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          {chip}
          <Button key="settings" label="Settings" onPress={() => void update($, viewA, () => 'settings')} />
        </Box>

        {prefs.order.map(id => blocks[id] ?? null)}
      </Box>
    )
  })
}
