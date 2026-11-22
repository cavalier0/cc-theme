// Cards in the transcript, drawn with the app's own elements so text stays selectable:
// a shell call's output as a folded terminal card, and a reply's markdown tables as cards.

export const SHELLS = new Set(['Bash', 'PowerShell'])

const HEAD = 6
const TAIL = 6

export type ShellOut = { stdout: string; stderr: string; exit?: number; interrupted: boolean }

export const shellOutOf = (output: unknown): ShellOut | null => {
  const r = (typeof output === 'object' && output !== null ? output : {}) as Record<string, unknown>
  if (typeof r.backgroundTaskId === 'string' || r.isImage === true) return null
  if (typeof r.stdout !== 'string' || typeof r.stderr !== 'string') return null
  const code = typeof r.exitCode === 'number' ? r.exitCode : typeof r.returnCode === 'number' ? r.returnCode : undefined
  return { stdout: r.stdout, stderr: r.stderr, exit: code, interrupted: r.interrupted === true }
}

const linesOf = (s: string): string[] => {
  const t = s.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  return t === '' ? [] : t.split('\n')
}

type El = (props: any, ...children: any[]) => any
type Ui = { Box: El; Text: El; Button: El; Markdown?: El }

export const shellCard = (
  ui: Ui,
  accent: string,
  command: string,
  out: ShellOut,
  isErrored: boolean,
  isOpen: boolean,
  toggle: () => void,
) => {
  const { Box, Text, Button } = ui
  const all = [...linesOf(out.stdout).map(text => ({ text, err: false })), ...linesOf(out.stderr).map(text => ({ text, err: true }))]
  const folds = all.length > HEAD + TAIL + 1
  const shown = !folds || isOpen ? all : [...all.slice(0, HEAD), null, ...all.slice(-TAIL)]
  const hidden = all.length - HEAD - TAIL
  const status = out.interrupted ? 'interrupted' : isErrored ? (out.exit !== undefined ? `exit ${out.exit}` : 'failed') : 'ok'
  const tone = isErrored || out.interrupted ? 'error' : 'success'
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isErrored ? 'error' : accent} borderDimColor={!isErrored}>
      <Box flexDirection="row" paddingX={1} backgroundColor="surface-2" justifyContent="space-between">
        <Box flexShrink={1}>
          <Text mono wrap="truncate-end">
            <Text color={accent}>$ </Text>
            <Text bold>{command || 'Output'}</Text>
          </Text>
        </Box>
        <Box flexShrink={0} paddingLeft={2}>
          <Text color={tone} size="footnote">{status}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={1} overflowX="scroll">
        {all.length === 0 ? <Text dimColor>no output</Text> : ''}
        {shown.map((line, i) =>
          line === null ? (
            <Button key="fold" plain label={`▾ ${hidden} more lines`} onPress={toggle} />
          ) : (
            <Text key={`l${i}`} mono color={line.err ? 'error' : undefined}>
              {line.text === '' ? ' ' : line.text}
            </Text>
          ),
        )}
        {folds && isOpen ? <Button key="less" plain label="▴ less" onPress={toggle} /> : ''}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- tables

type Segment = { kind: 'md'; text: string } | { kind: 'table'; head: string[]; align: ('left' | 'center' | 'right')[]; rows: string[][] }

const cells = (line: string): string[] => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

/** Splits a reply into markdown runs and tables; null when it holds no table. Fenced code is left alone. */
export const segmentsOf = (text: string): Segment[] | null => {
  const lines = text.split('\n')
  const out: Segment[] = []
  let md: string[] = []
  let inFence = false
  let found = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const nextLine = lines[i + 1]
    if (!inFence && line.includes('|') && nextLine !== undefined && isDivider(nextLine)) {
      const head = cells(line)
      const align = cells(nextLine).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left')) as ('left' | 'center' | 'right')[]
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && (lines[j] ?? '').includes('|') && (lines[j] ?? '').trim() !== '') {
        rows.push(cells(lines[j] ?? ''))
        j++
      }
      if (md.length) out.push({ kind: 'md', text: md.join('\n') })
      md = []
      out.push({ kind: 'table', head, align, rows })
      found = true
      i = j - 1
      continue
    }
    md.push(line)
  }
  if (md.length) out.push({ kind: 'md', text: md.join('\n') })
  return found ? out : null
}

const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

export const tableCard = (ui: Ui, accent: string, t: Extract<Segment, { kind: 'table' }>, key: string) => {
  const { Box, Text } = ui
  const n = Math.max(t.head.length, ...t.rows.map(r => r.length))
  const widths = Array.from({ length: n }, (_, c) => Math.min(48, Math.max(3, plain(t.head[c] ?? '').length, ...t.rows.map(r => plain(r[c] ?? '').length))))
  const total = widths.reduce((a, b) => a + b, 0)
  const pct = widths.map(w => `${Math.max(8, Math.round((100 * w) / total))}%`)
  const row = (r: string[], isHead: boolean, idx: number) => (
    <Box key={`${key}-r${idx}`} flexDirection="row" paddingX={1} backgroundColor={isHead ? 'surface-2' : idx % 2 ? 'surface-1' : undefined}>
      {Array.from({ length: n }, (_, c) => (
        <Box key={`${key}-r${idx}c${c}`} width={pct[c]} paddingRight={1} justifyContent={t.align[c] === 'right' ? 'flex-end' : t.align[c] === 'center' ? 'center' : 'flex-start'}>
          <Text bold={isHead} color={isHead ? accent : undefined}>
            {plain(r[c] ?? '')}
          </Text>
        </Box>
      ))}
    </Box>
  )
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={accent} borderDimColor>
      {row(t.head, true, 0)}
      {t.rows.map((r, i) => row(r, false, i + 1))}
    </Box>
  )
}

export const replyWithTables = (ui: Ui, accent: string, segments: Segment[]) => {
  const { Box, Markdown } = ui
  return (
    <Box flexDirection="column" gap={1}>
      {segments.map((s, i) =>
        s.kind === 'md' ? (s.text.trim() === '' ? '' : Markdown ? <Markdown key={`md${i}`} text={s.text} /> : '') : tableCard(ui, accent, s, `t${i}`),
      )}
    </Box>
  )
}
