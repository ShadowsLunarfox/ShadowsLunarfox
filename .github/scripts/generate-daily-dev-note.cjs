const fs = require('node:fs/promises');
const path = require('node:path');

const BEGIN = '<!-- BEGIN daily-dev-note -->';
const END = '<!-- END daily-dev-note -->';
const TIME_ZONE = 'Asia/Kuala_Lumpur';
const DAY = 86400000;
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function validateConfig(config) {
  if (typeof config?.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(config.startDate)
    || !Number.isFinite(Date.parse(config.startDate + 'T00:00:00Z'))
    || new Date(config.startDate + 'T00:00:00Z').toISOString().slice(0, 10) !== config.startDate) {
    throw new Error('Daily notes require a valid startDate in YYYY-MM-DD format');
  }
  if (!Array.isArray(config.quotes) || config.quotes.length < 2
    || config.quotes.some(quote => typeof quote !== 'string' || !quote.trim())
    || new Set(config.quotes.map(quote => quote.trim())).size !== config.quotes.length) {
    throw new Error('Daily notes require at least two distinct, non-empty quotes');
  }
  return config;
}

function selectDailyNote(config, now = new Date()) {
  validateConfig(config);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid daily note date');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const elapsedDays = (Date.parse(date + 'T00:00:00Z') - Date.parse(config.startDate + 'T00:00:00Z')) / DAY;
  const index = ((elapsedDays % config.quotes.length) + config.quotes.length) % config.quotes.length;
  return { date, quote: config.quotes[index].trim() };
}

function renderDailyNote(note, newline = '\n') {
  return [
    BEGIN,
    '<blockquote>',
    '<h3 align="center">💬 <samp>Daily Dev Note</samp></h3>',
    `<h3 align="center"><em>${escapeHtml(note.quote)}</em></h3>`,
    `<p align="center">${note.date} · Kuala Lumpur</p>`,
    '</blockquote>',
    END,
  ].join(newline);
}

function replaceDailyNote(readme, note) {
  const start = readme.indexOf(BEGIN), end = readme.indexOf(END);
  if (start < 0 || end < start || readme.indexOf(BEGIN, start + BEGIN.length) >= 0 || readme.indexOf(END, end + END.length) >= 0) {
    throw new Error('README must contain exactly one daily-dev-note BEGIN/END section');
  }
  const newline = readme.includes('\r\n') ? '\r\n' : '\n';
  return readme.slice(0, start) + renderDailyNote(note, newline) + readme.slice(end + END.length);
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const config = JSON.parse(await fs.readFile(path.join(root, '.github/daily-dev-notes.json'), 'utf8'));
  const readmePath = path.join(root, 'README.md');
  const readme = await fs.readFile(readmePath, 'utf8');
  const note = selectDailyNote(config);
  const updated = replaceDailyNote(readme, note);
  if (updated !== readme) await fs.writeFile(readmePath, updated);
  console.log(`Daily developer note ready for ${note.date} (${TIME_ZONE}).`);
}

module.exports = { validateConfig, selectDailyNote, renderDailyNote, replaceDailyNote };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
