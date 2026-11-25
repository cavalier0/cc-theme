// What sessions on this machine share, as plain files under ~/.claude/cavalier0-theme/:
//   prefs.json     the colours and toggles: a change in one session reaches every open one
//   samples.json   rate-limit readings, for the pace forecast (the limits are account-wide)
//   beats/slot-N   one live session each: a fixed set of slots, claimed and reused, so the
//                  folder never grows. Each session writes only its own slot.

import type { EngineInterface } from 'claude-code'

import type { Beat, Prefs } from '../types'
import { defaultPrefs, orderOf } from './look'
import type { Sample } from './usage'

type $ = EngineInterface

export const SLOTS = 16
/** A beat older than this is a session that has gone. */
export const STALE_MS = 90_000

let rootCache: string | undefined

export async function rootOf($: $): Promise<string> {
  if (rootCache) return rootCache
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  rootCache = `${home.replace(/\\/g, '/')}/.claude/cavalier0-theme`
  return rootCache
}

async function readJson<T>($: $, path: string): Promise<T | undefined> {
  try {
    if (!(await $.fs.exists(path))) return undefined
    return JSON.parse(String(await $.fs.read(path))) as T
  } catch {
    return undefined
  }
}

function writeJson($: $, path: string, value: unknown) {
  return $.fs.write(path, JSON.stringify(value, null, 1))
}

// ---------------------------------------------------------------- prefs

export const normalPrefs = (stored: Partial<Prefs> | undefined): Prefs => {
  const d = defaultPrefs()
  return {
    colors: { ...d.colors, ...(stored?.colors ?? {}) },
    sound: stored?.sound ?? d.sound,
    backdrop: stored?.backdrop ?? d.backdrop,
    folded: Array.isArray(stored?.folded) ? stored.folded : [],
    order: orderOf(stored?.order),
    band: stored?.band ?? d.band,
  }
}

export async function readPrefs($: $): Promise<Prefs> {
  const root = await rootOf($)
  const fromFile = await readJson<Partial<Prefs>>($, `${root}/prefs.json`)
  // Before the shared file existed, prefs lived in the plugin's store.
  const legacy = fromFile ? undefined : ((await $.store.get('prefs').catch(() => undefined)) as Partial<Prefs> | undefined)
  return normalPrefs(fromFile ?? legacy)
}

export async function writePrefs($: $, prefs: Prefs) {
  return writeJson($, `${await rootOf($)}/prefs.json`, prefs)
}

export async function prefsStamp($: $): Promise<number> {
  try {
    return (await $.fs.stat(`${await rootOf($)}/prefs.json`)).mtimeMs
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------- samples

export async function readSamples($: $): Promise<Sample[]> {
  return (await readJson<Sample[]>($, `${await rootOf($)}/samples.json`)) ?? []
}
export async function writeSamples($: $, s: Sample[]) {
  return writeJson($, `${await rootOf($)}/samples.json`, s)
}

// ---------------------------------------------------------------- the desktop app's record of this session

export type HostRecord = { title?: string; isArchived: boolean; lastFocusedAt?: number }

/** Where this session's record was found, once found. */
let recordPathCache: string | undefined

/**
 * Finds the desktop app's record of this session. The app keeps it under its data folder,
 * `<LOCALAPPDATA>/Claude-Data/claude_<…>/claude-code-sessions/<account>/<org>/<id>.json`.
 * Inside the app the engine's own environment has no CLAUDE_CODE_EXECPATH (the app sets it
 * only for the commands Claude runs), so the data folder is also looked for directly.
 */
export async function hostRecordPath($: $, hostId: string): Promise<string | undefined> {
  if (recordPathCache) return recordPathCache
  const account = await $.env.get('CLAUDE_CODE_ACCOUNT_UUID')
  const org = await $.env.get('CLAUDE_CODE_ORGANIZATION_UUID')
  if (!account || !org) return undefined
  const tail = `claude-code-sessions/${account}/${org}/${hostId}.json`
  const bases: string[] = []
  const exec = (await $.env.get('CLAUDE_CODE_EXECPATH'))?.replace(/\\/g, '/')
  const at = exec ? exec.toLowerCase().lastIndexOf('/claude-code/') : -1
  if (exec && at >= 0) bases.push(exec.slice(0, at))
  const local = (await $.env.get('LOCALAPPDATA'))?.replace(/\\/g, '/')
  if (local) {
    const entries = await $.fs.list(`${local}/Claude-Data`).catch(() => [])
    for (const entry of entries) if (entry.kind === 'dir' && entry.name.startsWith('claude_')) bases.push(`${local}/Claude-Data/${entry.name}`)
  }
  for (const base of bases) {
    const path = `${base}/${tail}`
    if (await $.fs.exists(path).catch(() => false)) {
      recordPathCache = path
      return path
    }
  }
  return undefined
}

/**
 * Reads the desktop app's own record of this session: its sidebar title, whether it is
 * archived, and when you last had it open. Only the head of the file is read, where the
 * app writes those fields. Undefined outside the desktop app or if the app moves it.
 */
export async function readHostRecord($: $, hostId: string): Promise<HostRecord | undefined> {
  const path = await hostRecordPath($, hostId)
  if (!path) return undefined
  try {
    const head = String(await $.fs.read(path, { offset: 0, length: 4096 }))
    const title = /"title":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1]
    const focused = /"lastFocusedAt":(\d+)/.exec(head)?.[1]
    return {
      title: title ? (JSON.parse(`"${title}"`) as string) : undefined,
      isArchived: /"isArchived":true/.test(head),
      lastFocusedAt: focused ? Number(focused) : undefined,
    }
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------- handled ("waiting on you" cleared)

export async function readAcks($: $): Promise<Record<string, number>> {
  return (await readJson<Record<string, number>>($, `${await rootOf($)}/acks.json`)) ?? {}
}

/** Marks these sessions handled as of their current state, in every cockpit; prunes sessions no longer live. */
export async function ackSessions($: $, done: Beat[], liveIds: string[]): Promise<Record<string, number>> {
  const cur = await readAcks($)
  const kept = Object.fromEntries(Object.entries(cur).filter(([k]) => liveIds.includes(k)))
  const next = { ...kept, ...Object.fromEntries(done.map(b => [b.id, b.since])) }
  await writeJson($, `${await rootOf($)}/acks.json`, next)
  return next
}

/** Whether a session is waiting on you: it finished or asked, and you haven't marked it handled since. */
export const isWaiting = (b: Beat, acks: Record<string, number>): boolean =>
  (b.status === 'asking' || b.status === 'waiting') && !(acks[b.id] !== undefined && b.since <= acks[b.id]!)

// ---------------------------------------------------------------- hidden sessions

export async function readHidden($: $): Promise<Record<string, number>> {
  return (await readJson<Record<string, number>>($, `${await rootOf($)}/hidden.json`)) ?? {}
}

/** Hides a session from every cockpit until it does something after `since`; prunes sessions no longer live. */
export async function hideSession($: $, id: string, since: number, liveIds: string[]) {
  const cur = await readHidden($)
  const kept = Object.fromEntries(Object.entries(cur).filter(([k]) => liveIds.includes(k)))
  await writeJson($, `${await rootOf($)}/hidden.json`, { ...kept, [id]: since })
}

// ---------------------------------------------------------------- beats

const slotPath = (root: string, i: number) => `${root}/beats/slot-${i}.json`

export async function readBeats($: $): Promise<(Beat | undefined)[]> {
  const root = await rootOf($)
  return Promise.all(Array.from({ length: SLOTS }, (_, i) => readJson<Beat>($, slotPath(root, i))))
}

const isFree = (b: Beat | undefined, now: number, myId: string) => !b || b.id === myId || b.status === 'ended' || now - b.at > STALE_MS

/**
 * Writes this session's beat to its slot, claiming one first when it has none or
 * lost it. Returns the slot, or -1 when every slot is taken by a live session.
 */
export async function publishBeat($: $, beat: Beat, slot: number): Promise<number> {
  const root = await rootOf($)
  if (slot >= 0) {
    const held = await readJson<Beat>($, slotPath(root, slot))
    if (!held || held.id === beat.id) {
      await writeJson($, slotPath(root, slot), beat)
      return slot
    }
  }
  const beats = await readBeats($)
  for (let i = 0; i < SLOTS; i++) {
    if (!isFree(beats[i], beat.at, beat.id)) continue
    await writeJson($, slotPath(root, i), beat)
    // Two sessions starting together may pick the same slot: the later write wins, the other moves on.
    await $.clock.sleep(150 + Math.floor(Math.random() * 250))
    const check = await readJson<Beat>($, slotPath(root, i))
    if (check?.id === beat.id) return i
  }
  return -1
}

/** The live sessions, one row each: a session seen in two slots keeps its newest beat. */
export const liveBeats = (beats: (Beat | undefined)[], now: number): Beat[] => {
  const byId = new Map<string, Beat>()
  for (const b of beats) {
    if (!b || now - b.at > STALE_MS) continue
    const had = byId.get(b.id)
    if (!had || b.at > had.at) byId.set(b.id, b)
  }
  return [...byId.values()].filter(b => b.status !== 'ended').sort((a, b) => a.startedAt - b.startedAt)
}
