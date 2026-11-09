// Bounds are local policy; the live tool versions and response schemas remain unverified.
const SPREADSHEET_ID = /^[A-Za-z0-9_-]{1,128}$/
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,128}$/

export function spreadsheetId(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid Google Sheets link')
  let url
  try { url = new URL(value) } catch { throw new Error('Invalid Google Sheets link') }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.username || url.password || url.port) throw new Error('Invalid Google Sheets link')
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{1,128})(?:\/[^?#]*)?$/.exec(url.pathname)
  if (!match || !SPREADSHEET_ID.test(match[1])) throw new Error('Invalid Google Sheets link')
  return match[1]
}

export function sheetRangeSize(value) {
  if (typeof value !== 'string' || value.length > 200) throw new Error('Choose one bounded sheet range')
  const match = /^(?:'((?:[^'\r\n]|'')+)'|([A-Za-z_][A-Za-z0-9_.-]*))!([A-Za-z]{1,3})([1-9][0-9]{0,6}):([A-Za-z]{1,3})([1-9][0-9]{0,6})$/.exec(value)
  if (!match) throw new Error('Choose one bounded sheet range')
  const col = text => [...text.toUpperCase()].reduce((number, char) => number * 26 + char.charCodeAt(0) - 64, 0)
  const firstCol = col(match[3]); const lastCol = col(match[5])
  const firstRow = Number(match[4]); const lastRow = Number(match[6])
  const rows = lastRow - firstRow + 1; const columns = lastCol - firstCol + 1
  if (rows < 1 || rows > 1000 || columns < 1 || columns > 50 || rows * columns > 10000 || lastCol > 18278) throw new Error('Sheet range exceeds the limit')
  return { rows, columns }
}

export function boundedSheetRange(value) {
  sheetRangeSize(value)
  return value
}

export function sheetArguments(link, range) {
  return { spreadsheet_id: spreadsheetId(link), ranges: [boundedSheetRange(range)], majorDimension: 'ROWS' }
}

export function gmailListArguments({ query = '', maxResults = 10, pageToken = '' } = {}) {
  if (typeof query !== 'string' || query.length > 1024 || typeof pageToken !== 'string' || pageToken.length > 1024 || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) throw new Error('Invalid email list request')
  return { user_id: 'me', ids_only: false, verbose: false, include_payload: false, max_results: maxResults, ...(query ? { query } : {}), ...(pageToken ? { page_token: pageToken } : {}) }
}

export function gmailMessageArguments(messageId) {
  if (typeof messageId !== 'string' || !MESSAGE_ID.test(messageId)) throw new Error('Invalid email selection')
  return { user_id: 'me', message_id: messageId, format: 'full' }
}
