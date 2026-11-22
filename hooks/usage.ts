import type { SessionRateLimit } from 'claude-code'

import type { Window } from '../types'

export type Sample = { at: number; five?: number; fiveReset?: string; week?: number; weekReset?: string }

/** Keep a reading when a figure moved, or every five minutes; a week of them at most. */
export const addSample = (list: Sample[], s: Sample): Sample[] => {
  const last = list[list.length - 1]
  const moved = !last || last.five !== s.five || last.week !== s.week
  if (!moved && s.at - last.at < 5 * 60_000) return list
  const cutoff = s.at - 7 * 24 * 3600_000
  return [...list.filter(x => x.at >= cutoff), s].slice(-2000)
}

const minutesUntil = (iso: string | undefined, now: number): number | undefined => {
  if (!iso) return undefined
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, (t - now) / 60_000) : undefined
}

/**
 * Minutes until 100% at the pace of the readings in `lookbackMin`, within the
 * same window (same reset time). Undefined when there is too little to go on
 * or usage is not rising.
 */
const paceFull = (
  samples: Sample[],
  pick: (s: Sample) => number | undefined,
  reset: (s: Sample) => string | undefined,
  current: number,
  resetsAt: string | undefined,
  now: number,
  lookbackMin: number,
  minSpanMin: number,
): number | undefined => {
  const inWindow = samples.filter(s => s.at >= now - lookbackMin * 60_000 && pick(s) !== undefined && (!resetsAt || reset(s) === resetsAt))
  const first = inWindow[0]
  if (!first) return undefined
  const spanMin = (now - first.at) / 60_000
  if (spanMin < minSpanMin) return undefined
  const rate = (current - (pick(first) ?? 0)) / spanMin
  if (rate <= 0.0001) return undefined
  return (100 - current) / rate
}

export const windowsOf = (limits: readonly SessionRateLimit[], samples: Sample[], now: number): { fiveHour?: Window; week?: Window } => {
  const five = limits.find(l => l.kind === 'five_hour')
  const week = limits.find(l => l.kind === 'seven_day')
  return {
    ...(five
      ? {
          fiveHour: {
            percent: five.percentUsed,
            resetsAt: five.resetsAt,
            resetInMin: minutesUntil(five.resetsAt, now),
            fullInMin: paceFull(samples, s => s.five, s => s.fiveReset, five.percentUsed, five.resetsAt, now, 60, 5),
          },
        }
      : {}),
    ...(week
      ? {
          week: {
            percent: week.percentUsed,
            resetsAt: week.resetsAt,
            resetInMin: minutesUntil(week.resetsAt, now),
            fullInMin: paceFull(samples, s => s.week, s => s.weekReset, week.percentUsed, week.resetsAt, now, 24 * 60, 30),
          },
        }
      : {}),
  }
}

export const dur = (min: number | undefined): string => {
  if (min === undefined || !Number.isFinite(min)) return '–'
  if (min < 1) return '<1m'
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h${String(Math.round(min % 60)).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

export const tokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
