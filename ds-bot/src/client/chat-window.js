// -------------------------------------------------------------------------
// Chat window projection (one-to-one Bot chat only)
//
// A private Bot chat shows the last N "UI entries" (a user message, an assistant
// reply, an independent tool card, a Bot-to-Bot message each count as one). Only
// Bot-to-Bot entries take part in the folding: an exchange that fell wholly
// before the window folds to one "N messages from X" line, while an exchange
// straddling the window keeps its in-window messages as bubbles and folds only
// the older prefix. Plain user/assistant/tool rows are never hidden (F3), and the
// newest Bot-to-Bot message is never folded, wherever it sits (F4).
//
// This module is pure: it takes an ordered list of already-classified entries and
// returns, for every entry key, whether it is hidden and whether it shows as a
// bubble, plus the summary lines to draw at the first entry of a folded prefix.
// The caller decides which DOM/node entries count and maps them to this shape.

export const DEFAULT_WINDOW = 20

// One entry of the ordered chat:
//   key      unique key (the node key, or a stable relay:<seq> key)
//   kind     'user' | 'assistant' | 'tool' | 'bot' | 'other'
//   exchange true when the entry belongs to a Bot-to-Bot exchange turn
//   peerId   for a Bot-to-Bot message (kind 'bot'), the sender's id
export function chatWindow(entries, { limit = DEFAULT_WINDOW } = {}) {
  const list = Array.isArray(entries) ? entries.filter(entry => entry && entry.key !== undefined) : []
  const count = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_WINDOW
  const total = list.length
  const byKey = new Map()
  const summaries = []

  // Only a Bot-to-Bot message can be folded or drawn as a bubble. A plain user,
  // assistant or tool row keeps its original visibility: dropping an old reply
  // while its question stays on screen is a regression (F3).
  let latestBot = -1
  for (let index = total - 1; index >= 0; index -= 1) {
    if (list[index].kind === 'bot') { latestBot = index; break }
  }
  for (const entry of list) byKey.set(entry.key, { hidden: false, bubble: false })

  if (total <= count) {
    for (const entry of list) if (entry.kind === 'bot') byKey.set(entry.key, { hidden: false, bubble: true })
    return { byKey, summaries }
  }

  const windowStart = total - count

  // A run is a maximal stretch of consecutive entries that belong to Bot-to-Bot
  // exchange turns. A plain user or assistant turn between two exchanges breaks it.
  const runs = []
  for (let index = 0; index < total; index += 1) {
    if (!list[index].exchange) continue
    let end = index
    while (end + 1 < total && list[end + 1].exchange) end += 1
    runs.push({ start: index, end })
    index = end
  }

  // Bots inside the window are bubbles; the newest Bot message is a bubble even
  // when its whole exchange sits before the window (F4).
  for (let index = 0; index < total; index += 1) {
    if (list[index].kind !== 'bot') continue
    if (index >= windowStart || index === latestBot) byKey.set(list[index].key, { hidden: false, bubble: true })
  }

  for (const run of runs) {
    // The out-of-window Bot messages of this exchange fold to one summary line.
    // The newest Bot message is excluded everywhere, not just from its own run.
    const foldable = []
    for (let index = run.start; index <= run.end && index < windowStart; index += 1) {
      if (list[index].kind !== 'bot' || index === latestBot) continue
      foldable.push(index)
    }
    if (foldable.length === 0) continue
    const span = foldable.map(index => list[index])
    const peerIds = []
    for (const entry of span) {
      if (entry.peerId !== undefined && !peerIds.includes(entry.peerId)) peerIds.push(entry.peerId)
    }
    // `count` is the number of folded Bot messages, not assistant/tool rows.
    summaries.push({ key: list[foldable[0]].key, count: span.length, peerIds })
    for (const index of foldable) byKey.set(list[index].key, { hidden: true, bubble: false })
  }

  // Unconditional promise: the newest Bot-to-Bot message never folds.
  if (latestBot !== -1) byKey.set(list[latestBot].key, { hidden: false, bubble: true })

  return { byKey, summaries }
}

// Convenience for one entry: the projection entry, or a passthrough when absent.
export function windowOf(projection, key) {
  return projection?.byKey?.get(key) ?? { hidden: false, bubble: false }
}

// The summary line to draw in place of a folded entry, or undefined.
export function summaryAt(projection, key) {
  const list = projection?.summaries
  if (!Array.isArray(list)) return undefined
  for (const summary of list) if (summary.key === key) return summary
  return undefined
}
