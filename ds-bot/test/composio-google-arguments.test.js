import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedSheetRange, gmailListArguments, gmailMessageArguments, sheetArguments, spreadsheetId } from '../src/host/composio-google-arguments.js'

test('Sheets accepts only a standard HTTPS spreadsheet URL and a bounded named range', () => {
  assert.deepEqual(sheetArguments('https://docs.google.com/spreadsheets/d/abc_123/edit?sharing=private#gid=1', "'Test Sheet'!A1:C10"), { spreadsheet_id: 'abc_123', ranges: ["'Test Sheet'!A1:C10"], majorDimension: 'ROWS' })
  for (const url of ['http://docs.google.com/spreadsheets/d/abc', 'https://docs.google.com.evil.test/spreadsheets/d/abc', 'https://user@docs.google.com/spreadsheets/d/abc', 'https://docs.google.com:444/spreadsheets/d/abc', 'https://docs.google.com/spreadsheets/d/']) assert.throws(() => spreadsheetId(url))
  for (const range of ['', 'Sheet1', 'Sheet1!A:A', 'Sheet1!A1', 'A1:B2', 'Sheet1!A1:B2,Sheet2!A1:B2', 'Sheet1!A1:AY1', 'Sheet1!A1:A1001', 'Sheet1!A1:AX201', 'Sheet1!B2:A1']) assert.throws(() => boundedSheetRange(range))
  assert.equal(boundedSheetRange('Sheet1!A1:AX200'), 'Sheet1!A1:AX200')
})

test('Gmail arguments limit each list request and select a message ID', () => {
  assert.equal(gmailListArguments().max_results, 10)
  assert.equal(gmailListArguments({ maxResults: 50 }).max_results, 50)
  assert.throws(() => gmailListArguments({ maxResults: 51 }))
  assert.throws(() => gmailListArguments({ pageToken: 'x'.repeat(1025) }))
  assert.deepEqual(gmailMessageArguments('abc_123'), { user_id: 'me', message_id: 'abc_123', format: 'full' })
  assert.throws(() => gmailMessageArguments('<message@example.test>'))
})
