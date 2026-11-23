import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { segmentsOf } from './cards'
import { windowsOf } from './usage'

const PANE = {
  plugin: 'cavalier0-theme',
  component: 'Pane',
  requestId: 'cockpit',
  props: { title: 'Cockpit', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const RESET = new Date(Date.UTC(2030, 0, 1)).toISOString()

/** Stands in for the engine beneath the mod. */
const NOW = Date.UTC(2029, 11, 31, 20)

const engine = (
  on: On,
  opts: { remote?: boolean; cwd?: string; repoRoot?: string | null; files?: Record<string, string>; firstPrompt?: string } = {},
) => {
  const k = (p: string) => p.replace(/\\/g, '/')
  on('session.messages', () => ({
    value: opts.firstPrompt ? [{ role: 'user', text: '<system-reminder>x</system-reminder>', toolUses: [] }, { role: 'user', text: opts.firstPrompt, toolUses: [] }] : [],
  }))
  const files = new Map<string, string>(Object.entries(opts.files ?? {}))
  on('fs.exists', (_, e) => ({ value: files.has(k(e.path)) }))
  on('fs.read', (_, e) => {
    const text = files.get(k(e.path))
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(k(e.path), e.text)
    return { value: undefined }
  })
  on('fs.stat', (_, e) => {
    if (!files.has(k(e.path))) throw new Error('missing')
    return { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }
  })
  on('clock.sleep', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'me-session' }))
  const themes: unknown[] = []
  const opened: unknown[] = []
  const store = new Map<string, unknown>()
  const logs: string[] = []
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    logs.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : e.name === 'CLAUDE_CODE_REMOTE' && opts.remote ? 'true' : undefined }))
  on('session.info', () => ({ value: { transcriptPath: '', platform: 'windows', isHosted: false } }))
  on('session.cwd', () => ({ value: opts.cwd ?? 'C:/code/app' }))
  on('session.repo', () => ({
    value: opts.repoRoot === null ? null : { root: opts.repoRoot ?? 'C:/code/app', remote: null, internal: false, name: null },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 50_000, window: 200_000, percent: 25 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42, resetsAt: RESET },
        { kind: 'seven_day', percentUsed: 18, resetsAt: RESET },
      ],
      cost: { usd: 1.5 },
    },
  }))
  on('theme.set', (_, e) => {
    themes.push(e)
    return { value: { isDrawn: true, requestId: 't' } }
  })
  on('command.register', () => ({ value: { command: 'cockpit' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__cavalier0-theme__step' } }))
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  return { themes, opened, logs, files }
}

test('a cloud session gets the violet look and the widget shows CLOUD', async ($, on) => {
  const { themes, opened, logs } = engine(on, { remote: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(logs).toEqual([])

  expect(themes.length).toBeGreaterThan(0)
  expect(JSON.stringify(themes[0])).toContain('drift')
  expect(JSON.stringify(opened[0])).toContain('widget')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
  const chip = await ui.find({ type: 'Text', text: /CLOUD/ })
  expect(chip?.props.backgroundColor).toBe('#9a7fe0')
  const bar = (await ui.find({ text: /42%/ })) ?? (await ui.find({ type: 'Text', text: /42%/ }))
  expect(bar).toBeDefined()
  await ui.unmount()
})

test('a worktree is told apart from the main checkout', async ($, on) => {
  engine(on, { cwd: 'C:/code/app/.claude/worktrees/t-0003', repoRoot: 'C:/code/app' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /WORKTREE/ })).toBeDefined()
  await ui.unmount()
})

test('the plan follows update_plan calls', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Read the code', status: 'in_progress' },
      { content: 'Fix the bug', status: 'pending' },
    ],
  } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /1\/2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Fix the bug' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '▸' })).toBeDefined()
    await ui.unmount()
  }
})

test("a subagent's current action shows on its card", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Look through the save system', description: 'Audit saves', subagentType: 'Explore' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:/code/app/save_manager.ts', agentId: 'ag1' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Audit saves' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Reading save_manager.ts' })).toBeDefined()
  await ui.unmount()
})

test('settings change a colour and re-apply the look', async ($, on) => {
  const { themes } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  await ui.select({ key: 'sel-local', value: '#de8452' })
  expect(JSON.stringify(themes[themes.length - 1])).toContain('drift')
  expect(themes.length).toBeGreaterThan(1)
  await ui.unmount()
})

test('tables split out of a reply, code fences left alone', () => {
  const segs = segmentsOf('Intro\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n\n```\n| x | y |\n|---|---|\n```')
  expect(segs?.filter(s => s.kind === 'table').length).toBe(1)
  expect(segmentsOf('no tables here')).toBeNull()
})

test('pace forecast warns when the window fills before reset', () => {
  const now = Date.UTC(2030, 0, 1) - 3 * 3600_000
  const samples = [{ at: now - 30 * 60_000, five: 30, fiveReset: RESET }]
  const w = windowsOf([{ kind: 'five_hour', percentUsed: 60, resetsAt: RESET }], samples, now)
  // 30 points in 30 min -> 40 min to full, resets in 3h.
  expect(Math.round(w.fiveHour?.fullInMin ?? 0)).toBe(40)
})

const ROOT = 'C:/Users/me/.claude/cavalier0-theme'
const beat = (over: Record<string, unknown>) =>
  JSON.stringify({ id: 'other', kind: 'worktree', detail: 't-0003', label: 'Wire the save system', status: 'waiting', since: NOW - 12 * 60_000, startedAt: NOW - 3600_000, stepsDone: 2, stepsTotal: 5, agents: 0, at: NOW - 5_000, ...over })

test('mission control lists another session that is waiting on you, first', async ($, on) => {
  const { files } = engine(on, { files: { [`${ROOT}/beats/slot-0.json`]: beat({}) } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // This session claimed a free slot of its own, not the other session's.
  expect(JSON.parse(files.get(`${ROOT}/beats/slot-0.json`) ?? '{}').id).toBe('other')
  expect(JSON.parse(files.get(`${ROOT}/beats/slot-1.json`) ?? '{}').id).toBe('me-session')

  const dock = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await dock.find({ type: 'Text', text: 'Wire the save system' })).toBeDefined()
  expect(await dock.find({ type: 'Text', text: /your move · 12m/ })).toBeDefined()
  expect(await dock.find({ type: 'Text', text: /1 waiting on you/ })).toBeDefined()
  await dock.unmount()

  const widget = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
  expect(await widget.find({ type: 'Text', text: '◉' })).toBeDefined()
  await widget.unmount()
})

test('a session that stopped beating drops off, and its slot is reused', async ($, on) => {
  const { files } = engine(on, { files: { [`${ROOT}/beats/slot-0.json`]: beat({ at: NOW - 10 * 60_000 }) } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.parse(files.get(`${ROOT}/beats/slot-0.json`) ?? '{}').id).toBe('me-session')
  const dock = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await dock.find({ type: 'Text', text: 'Wire the save system' })).toBeUndefined()
  await dock.unmount()
})

test('settings are read from, and saved to, the shared file', async ($, on) => {
  const { files, themes } = engine(on, {
    files: { [`${ROOT}/prefs.json`]: JSON.stringify({ colors: { local: '#c873c4' }, sound: false, backdrop: true, folded: [] }) },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.stringify(themes[0])).not.toContain('"sound"')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: / LOCAL / }))?.props.backgroundColor).toBe('#c873c4')
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'backdrop' })
  expect(JSON.parse(files.get(`${ROOT}/prefs.json`) ?? '{}').backdrop).toBe(false)
  await ui.unmount()
})

test('a session you have read is no longer waiting on you', async ($, on) => {
  engine(on, { files: { [`${ROOT}/beats/slot-0.json`]: beat({ status: 'seen' }) } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const dock = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await dock.find({ type: 'Text', text: /read · 12m/ })).toBeDefined()
  expect(await dock.find({ type: 'Text', text: /waiting on you/ })).toBeUndefined()
  await dock.unmount()
})

test('a session open before the mod loaded is labelled by its first prompt', async ($, on) => {
  const { files } = engine(on, { firstPrompt: 'Fix the  login\nbug' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.parse(files.get(`${ROOT}/beats/slot-0.json`) ?? '{}').label).toBe('Fix the login bug')
})

test('clicking another session opens it in the desktop app', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: '' } as never }
  })
  engine(on, { files: { [`${ROOT}/beats/slot-0.json`]: beat({ hostId: 'local_abc-123' }) } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const dock = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await dock.press({ key: 'go-other' })
  expect(runs).toEqual([['explorer.exe', 'claude://code/continue?session=local_abc-123']])
  await dock.unmount()
})

test('a cleared session stays hidden until it does something new', async ($, on) => {
  const { files } = engine(on, { files: { [`${ROOT}/beats/slot-0.json`]: beat({}) } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const dock = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await dock.press({ key: 'hide-other' })
  expect(await dock.find({ type: 'Text', text: 'Wire the save system' })).toBeUndefined()
  expect(JSON.parse(files.get(`${ROOT}/hidden.json`) ?? '{}').other).toBe(NOW - 12 * 60_000)
  await dock.unmount()
})

test('long-idle sessions fold into an Idle group', async ($, on) => {
  engine(on, { files: { [`${ROOT}/beats/slot-0.json`]: beat({ status: 'seen', since: NOW - 3 * 3600_000 }) } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const dock = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await dock.find({ type: 'Text', text: /Idle · 1/ })).toBeDefined()
  expect(await dock.find({ type: 'Text', text: 'Wire the save system' })).toBeUndefined()
  await dock.press({ key: 'idle-toggle' })
  expect(await dock.find({ type: 'Text', text: 'Wire the save system' })).toBeDefined()
  await dock.unmount()
})

test('sections can be reordered in settings', async ($, on) => {
  const { files } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'down-sessions' })
  expect(JSON.parse(files.get(`${ROOT}/prefs.json`) ?? '{}').order).toEqual(['usage', 'sessions', 'agents', 'plan'])
  await ui.unmount()
})
