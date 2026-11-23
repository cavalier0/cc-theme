# cavalier0-theme

A Claude Code mod for the desktop and mobile apps: one calm dark theme, tinted by where the session runs, and a cockpit pane beside the chat.

## What it does

- **Theme by environment.** Local sessions are teal, cloud sessions violet, git worktrees amber. Detected at session start. Change any colour in the cockpit's Settings; it is saved on that machine for every later session.
- **Cockpit pane.** Opens in every session as a small widget and expands when subagents or a plan appear (`/cockpit` opens it, `/cockpit settings` jumps to settings). Reorder its sections in Settings.
  - **Sessions (mission control):** every live session on this PC, in its environment colour, with what it's doing. Sessions waiting on you come first, marked ◉, and turn to "read" once you've looked at the reply. Click a session to switch to it in the desktop app; ✕ clears one until it does something new; sessions idle over an hour fold into an Idle group.
  - **Usage:** 5-hour and weekly limits with reset countdowns and a pace forecast ("at this pace: full in 1h20, before it resets"), context fill, and the session's estimated cost at API prices.
  - **Agents:** each subagent's task, what it is doing right now, steps done, model, elapsed time, tokens and cost.
  - **Plan:** the session's plan steps with their state and how long each took.
- **Transcript cards.** Shell output as a folded terminal card; markdown tables in replies as cards.
- **Extras, each switchable in Settings:** a slow drifting backdrop tinted by environment, and soft sound cues (desktop app, once the speaker in the title bar is on; needs Claude Code 2.1.330 or later).

The terminal and VS Code draw no themes; the cockpit still works there.

## Install

At the prompt of a terminal session:

```
/plugin install cavalier0-theme --marketplace cavalier0/cc-theme
```

From a shell:

```
claude plugin install cavalier0-theme --marketplace cavalier0/cc-theme
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `cavalier0/cc-theme`, then Add plugin.

Replaces the `skins` and `savvy-progress` plugins: uninstall those so two themes don't compete.
