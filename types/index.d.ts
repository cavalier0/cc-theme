export type EnvKind = 'local' | 'cloud' | 'worktree'

export type EnvInfo = {
  kind: EnvKind
  /** A short place name: the folder, the worktree or the cloud repo. */
  detail: string
}

export type Prefs = {
  colors: Record<EnvKind, string>
  sound: boolean
  backdrop: boolean
  /** Sections of the cockpit folded shut. */
  folded: string[]
  /** The cockpit's sections, top to bottom. */
  order: string[]
  /** The one-line band above the prompt. */
  band: boolean
}

export type Window = {
  percent: number
  resetsAt?: string
  /** Minutes until the window is full at the current pace; absent when no pace is known. */
  fullInMin?: number
  /** Minutes until the window resets. */
  resetInMin?: number
}

export type UsageSnap = {
  fiveHour?: Window
  week?: Window
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  costUsd?: number
  model?: string
}

export type AgentRun = {
  id: string
  type: string
  description: string
  brief: string
  model?: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  action?: string
  actions: number
  tokens: number
  contextWindow?: number
  costUsd?: number
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}

export type PlanStep = { content: string; status: 'pending' | 'in_progress' | 'completed'; startedAt?: number; endedAt?: number }

export type Plan = { steps: PlanStep[]; updatedAt: number }

/** `seen`: the turn ended and you have looked at the reply since, but not answered. */
export type SessionStatus = 'starting' | 'working' | 'asking' | 'waiting' | 'seen' | 'ended'

/** One live session's heartbeat, shared with every other session on this machine. */
export type Beat = {
  id: string
  /** The desktop app's own id for the session (`local_…`), which a deep link opens. */
  hostId?: string
  /** The session's name as the desktop app's sidebar shows it. */
  title?: string
  kind: EnvKind
  detail: string
  /** What the session is about: its plan's current step, else its first prompt. */
  label: string
  status: SessionStatus
  /** When the status last changed. */
  since: number
  startedAt: number
  stepsDone: number
  stepsTotal: number
  agents: number
  contextPercent?: number
  costUsd?: number
  /** When this beat was written. */
  at: number
}

export type Me = { status: SessionStatus; since: number; startedAt: number; firstPrompt?: string; slot: number }

declare module 'claude-code' {
  interface PluginState {
    'cavalier0-theme': {
      env: Shaped<EnvInfo | null>
      prefs: Shaped<Prefs | null>
      usage: Shaped<UsageSnap | null>
      agents: Shaped<AgentRun[]>
      plan: Shaped<Plan | null>
      /** Every live session on this machine, this one included. */
      sessions: Shaped<Beat[]>
      /** Sessions you cleared from the list, by id: hidden until they do something after this time. */
      hidden: Shaped<Record<string, number>>
      me: Shaped<Me | null>
      view: 'main' | 'settings'
      now: number
      /** A shell call's command, by tool_use_id. */
      command: StateFamily<string>
      /** Whether a shell card shows its whole output, by tool_use_id. */
      outOpen: StateFamily<boolean>
    }
  }
}
