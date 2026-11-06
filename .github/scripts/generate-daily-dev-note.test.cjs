const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, selectDailyNote, replaceDailyNote } = require('./generate-daily-dev-note.cjs');
const notes = { startDate: '2026-11-06', quotes: ['First note', 'Second note', 'Third note'] };

test('notes follow the Kuala Lumpur calendar day and stay stable throughout that day', () => {
  const first = { date: '2026-11-06', quote: 'First note' };
  assert.deepEqual(selectDailyNote(notes, new Date('2026-11-05T16:00:00Z')), first);
  assert.deepEqual(selectDailyNote(notes, new Date('2026-11-06T15:59:59Z')), first);
  assert.deepEqual(selectDailyNote(notes, new Date('2026-11-06T16:00:00Z')), { date: '2026-11-07', quote: 'Second note' });
  assert.equal(selectDailyNote(notes, new Date('2026-11-05T15:59:59Z')).quote, 'Third note');
});

test('rotation wraps and handles leap days without repeating adjacent notes', () => {
  assert.equal(selectDailyNote(notes, new Date('2026-11-08T16:00:00Z')).quote, 'First note');
  const leap = { ...notes, startDate: '2024-02-28' };
  assert.equal(selectDailyNote(leap, new Date('2024-02-28T16:00:00Z')).quote, 'Second note');
  assert.equal(selectDailyNote(leap, new Date('2024-02-29T16:00:00Z')).quote, 'Third note');
  const configured = require('../daily-dev-notes.json');
  validateConfig(configured);
  const start = Date.parse(configured.startDate + 'T04:00:00Z');
  const cycle = Array.from({ length: configured.quotes.length + 1 }, (_, day) => selectDailyNote(configured, new Date(start + day * 86400000)).quote);
  for (let day = 1; day < cycle.length; day++) assert.notEqual(cycle[day], cycle[day - 1]);
  assert.equal(cycle[0], cycle.at(-1));
});

test('invalid dates and quote pools fail before a README can be changed', () => {
  for (const startDate of ['2026-02-30', '2026-13-01', 'tomorrow', null]) assert.throws(() => validateConfig({ ...notes, startDate }), /startDate/);
  for (const quotes of [[], ['Only one'], ['Same', ' Same '], ['Good', ' '], ['Good', 1]]) assert.throws(() => validateConfig({ ...notes, quotes }), /quotes/);
  assert.throws(() => selectDailyNote(notes, new Date('invalid')), /date/);
});

test('refreshing changes only its own section, escapes quote markup, and preserves CRLF', () => {
  const before = 'Before\r\n<!-- BEGIN daily-dev-note -->\r\nold\r\n<!-- END daily-dev-note -->\r\nAfter';
  const note = { date: '2026-11-06', quote: '<script> & "quoted"' };
  const output = replaceDailyNote(before, note);
  assert.ok(output.startsWith('Before\r\n'));
  assert.ok(output.endsWith('\r\nAfter'));
  assert.doesNotMatch(output, /(?<!\r)\n|<script>/);
  assert.match(output, /&lt;script&gt; &amp; &quot;quoted&quot;/);
  assert.equal(replaceDailyNote(output, note), output);
});

test('missing, reversed, or duplicate section markers never overwrite unrelated README content', () => {
  const note = { date: '2026-11-06', quote: 'Hello' };
  for (const readme of ['No markers', '<!-- END daily-dev-note --><!-- BEGIN daily-dev-note -->', '<!-- BEGIN daily-dev-note --><!-- BEGIN daily-dev-note --><!-- END daily-dev-note -->', '<!-- BEGIN daily-dev-note --><!-- END daily-dev-note --><!-- END daily-dev-note -->']) {
    assert.throws(() => replaceDailyNote(readme, note), /exactly one/);
  }
});
