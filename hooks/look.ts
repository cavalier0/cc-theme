import type { ThemeSetArgs } from 'claude-code'

// Sound arrived in Claude Code 2.1.330; typed loosely so older builds still compile, and
// applyLook retries without it where a build refuses it.
type ThemeSound = Record<string, unknown>

import type { EnvKind, Prefs } from '../types'
import { makeColors } from './make-colors.js'

export const DEFAULT_COLORS: Record<EnvKind, string> = {
  local: '#3fb3a8', // teal
  cloud: '#9a7fe0', // violet
  worktree: '#d9a04a', // amber
}

export const PRESETS: { label: string; hex: string }[] = [
  { label: 'Teal', hex: '#3fb3a8' },
  { label: 'Cyan', hex: '#4aa8d8' },
  { label: 'Blue', hex: '#6b8de3' },
  { label: 'Violet', hex: '#9a7fe0' },
  { label: 'Magenta', hex: '#c873c4' },
  { label: 'Rose', hex: '#d9707f' },
  { label: 'Amber', hex: '#d9a04a' },
  { label: 'Orange', hex: '#de8452' },
  { label: 'Green', hex: '#6fb86a' },
]

export const ENV_LABEL: Record<EnvKind, string> = { local: 'LOCAL', cloud: 'CLOUD', worktree: 'WORKTREE' }

export const SECTIONS: { id: string; title: string }[] = [
  { id: 'sessions', title: 'Sessions' },
  { id: 'usage', title: 'Usage' },
  { id: 'agents', title: 'Agents' },
  { id: 'plan', title: 'Plan' },
]

export const defaultPrefs = (): Prefs => ({ colors: { ...DEFAULT_COLORS }, sound: true, backdrop: true, folded: [], order: SECTIONS.map(s => s.id), band: true })

/** A stored order with any section it lacks added at the end, and any it no longer knows dropped. */
export const orderOf = (stored: unknown): string[] => {
  const known = SECTIONS.map(s => s.id)
  const kept = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string' && known.includes(x)) : []
  const unique = kept.filter((x, i) => kept.indexOf(x) === i)
  return [...unique, ...known.filter(x => !unique.includes(x))]
}

export const isHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s)

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const hueOf = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

export const hsl = (h: number, s: number, l: number): string => {
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** The calm dark base, its grays tinted toward the environment's hue. */
export const colorsFor = (accent: string) => {
  const h = hueOf(accent)
  return makeColors({
    label: 'cavalier0',
    only: 'dark',
    roles: { accent, danger: '#d9707a', success: '#7dbb86', warning: '#d6a457', pro: '#a48fdc' },
    dark: {
      gray: {
        anchors: {
          'surface-0': hsl(h, 16, 8),
          'surface-1': hsl(h, 14, 10.5),
          'surface-2': hsl(h, 13, 13),
          'surface-3': hsl(h, 12, 15),
          'text-primary': hsl(h, 12, 92),
          'text-secondary': hsl(h, 9, 78),
          'text-muted': hsl(h, 8, 64),
        },
      },
    },
  })
}

const SOUND: ThemeSound = {
  cues: {
    done: { layers: [{ wave: 'bell', notes: ['E5', 'B5'], step: 0.12, gain: 0.25 }], reverb: 0.4 },
    ask: { layers: [{ wave: 'bell', notes: ['G5'], gain: 0.2 }], reverb: 0.3 },
    error: { layers: [{ wave: 'sine', notes: ['D4', 'A3'], step: 0.1, gain: 0.2 }] },
  },
}

export const SCENE = 'drift'

export const lookFor = (kind: EnvKind, prefs: Prefs, withSound: boolean): { args: ThemeSetArgs; problems: string[] } => {
  const accent = prefs.colors[kind] ?? DEFAULT_COLORS[kind]
  const { theme, problems } = colorsFor(accent)
  const h = hueOf(accent)
  const args = {
    colors: theme,
    ...(prefs.backdrop ? { backdrop: { scene: SCENE, glass: { blur: 24, tint: hsl(h, 16, 8), opacity: 0.82 } } } : {}),
    ...(prefs.sound && withSound ? { sound: SOUND } : {}),
  } as ThemeSetArgs
  return { args, problems }
}

/** A slow field of blurred light in the corners, tinted by the environment. */
export const sceneSvg = (accent: string): string => {
  const h = hueOf(accent)
  const base = hsl(h, 16, 7)
  const a = hsl(h, 55, 42)
  const b = hsl((h + 40) % 360, 45, 36)
  const c = hsl((h + 330) % 360, 40, 30)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<style>
.o { transform-box: fill-box; transform-origin: center; }
.o1 { animation: d1 70s ease-in-out infinite alternate; }
.o2 { animation: d2 90s ease-in-out infinite alternate; }
.o3 { animation: d3 110s ease-in-out infinite alternate; }
@keyframes d1 { from { transform: translate(0px, 0px) scale(1); } to { transform: translate(120px, 80px) scale(1.15); } }
@keyframes d2 { from { transform: translate(0px, 0px) scale(1.1); } to { transform: translate(-140px, -60px) scale(0.95); } }
@keyframes d3 { from { transform: translate(0px, 0px); opacity: 0.35; } to { transform: translate(90px, -110px); opacity: 0.55; } }
</style>
<defs>
<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="90"/></filter>
</defs>
<rect width="1600" height="1000" fill="${base}"/>
<g filter="url(#blur)">
<circle class="o o1" cx="160" cy="140" r="260" fill="${a}" opacity="0.45"/>
<circle class="o o2" cx="1460" cy="880" r="300" fill="${b}" opacity="0.4"/>
<circle class="o o3" cx="1420" cy="120" r="200" fill="${c}" opacity="0.35"/>
</g>
</svg>`
}
