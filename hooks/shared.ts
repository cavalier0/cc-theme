// What sessions on this machine share, as plain files under ~/.claude/cavalier0-theme/:
//   prefs.json     the colours and toggles: a change in one session reaches every open one
//   samples.json   rate-limit readings, for the pace forecast (the limits are account-wide)
//   beats/slot-N   one live session each: a fixed set of slots, claimed and reused, so the
//                  folder never grows. Each session writes only its own slot.

import type { EngineInterface } from 'claude-code'

import type { Beat, Prefs } from '../types'
import { defaultPrefs } from './look'
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

export const liveBeats = (beats: (Beat | undefined)[], now: number): Beat[] =>
  beats.filter((b): b is Beat => !!b && b.status !== 'ended' && now - b.at <= STALE_MS).sort((a, b) => a.startedAt - b.startedAt)
