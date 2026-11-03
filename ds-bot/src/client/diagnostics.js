// What went wrong in this browser, for Settings → Feedback and the report it builds.
// Calls whose failures the interface swallows (polls, previews) still land here.
import { t, language } from './i18n.js'

const MAX = 30
// The same failure again within this window bumps a count instead of a new line.
const REPEAT_MS = 5 * 60 * 1000
const entries = []
// An API failure is noted where it happens; the menu or form that shows it must not add it again.
const noted = new WeakSet()
export const markNoted = (error) => {
  if (error !== null && typeof error === 'object') noted.add(error)
  return error
}

export function noteClientError(where, error) {
  if (error !== null && typeof error === 'object') {
    if (noted.has(error)) return
    noted.add(error)
  }
  const message = String(error?.message ?? error ?? 'error').slice(0, 300)
  const code = typeof error?.code === 'string' ? error.code : undefined
  const text = `${where}: ${message}`
  const now = Date.now()
  const last = entries.at(-1)
  if (last && last.text === text && now - last.time < REPEAT_MS) {
    last.time = now
    last.count = (last.count ?? 1) + 1
    return
  }
  entries.push({ time: now, level: 'error', text, ...(code ? { code } : {}) })
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
}

// A catch handler that keeps the failure without bothering the user.
export const quietly = where => error => noteClientError(where, error)

export const clearClientErrors = () => { entries.length = 0 }

export const clientErrors = () => entries.map(entry => (entry.count > 1 ? { ...entry, text: `${entry.text} (×${entry.count})` } : { ...entry }))

export function clientFacts() {
  return {
    surface: window.dshDesktop ? 'DSH Desktop' : 'DSH Web',
    language: language(),
    userAgent: navigator.userAgent,
  }
}

// Short words for the provider-neutral failure codes of DSH's LLM layer.
const FAILURES = {
  AUTH: 'The API key was rejected',
  QUOTA: 'The account is out of quota',
  ACCOUNT_QUOTA: 'The account is out of quota',
  RATE_LIMIT: 'Too many requests to the model',
  CONTEXT_WINDOW_EXCEEDED: 'The conversation is too long for the model',
  INVALID_REQUEST: 'The model service refused the request',
  SERVER: 'The model service failed',
  TIMEOUT: 'The model took too long to answer',
  TRANSPORT: 'Could not reach the model service',
  SESSION: 'Its group conversation could not open',
  SESSION_RESET: 'Its group conversation could not open, so it starts a new one next time',
}

export function failureLabel(code, message) {
  if (FAILURES[code]) return t(FAILURES[code])
  return message || code || t('Unknown error')
}

// The URL never includes a description or diagnostics; the user reviews and pastes them.
export const WHAT_MAX = 2000
export function issueUrl(base) {
  return `${base}?${new URLSearchParams({ template: 'bug.yml' })}`
}
