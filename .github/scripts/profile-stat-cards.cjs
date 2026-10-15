const palettes = {
  dark: { surface: 'none', inset: 'none', border: '#353445', text: '#f1eaf7', muted: '#adbac7', accent: '#ffaec5', lavender: '#d7c4f3', cyan: '#b9edf2' },
  light: { surface: 'none', inset: 'none', border: '#e6dce9', text: '#3b2d4f', muted: '#756782', accent: '#9c4268', lavender: '#756092', cyan: '#367484' },
};
const languageColors = { JavaScript: '#ffd166', CSS: '#bbe8f2', 'C#': '#d7c4f3', HTML: '#ffaec5', Python: '#ffe9a3', Batchfile: '#ffd3b0', 'C++': '#b9edf2', Java: '#ffd3b0', TypeScript: '#b9edf2' };
const fallbackColors = ['#d7c4f3', '#b9edf2', '#ffd3b0', '#ffaec5', '#ffe9a3'];

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function decodeXml(value) {
  return value.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (_, number, name) => number
    ? String.fromCodePoint(Number.parseInt(number.replace(/^x/i, ''), /^x/i.test(number) ? 16 : 10))
    : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name.toLowerCase()]);
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label} count`);
  return value;
}

function textById(svg, id) {
  const match = svg.match(new RegExp(`<text\\b[^>]*\\bdata-testid=["']${id}["'][^>]*>([^<]*)</text>`));
  if (!match) throw new Error(`Missing ${id} in the statistics response`);
  return decodeXml(match[1].trim());
}

function parseOverview(svg) {
  if (!svg.includes('<svg')) throw new Error('The overview service did not return an SVG');
  const stats = {};
  for (const id of ['stars', 'commits', 'prs', 'issues', 'contribs']) {
    const raw = textById(svg, id);
    if (!/^\d+$/.test(raw)) throw new Error(`Expected a full ${id} count`);
    stats[id] = count(Number(raw), id);
  }
  stats.rank = textById(svg, 'level-rank-icon');
  if (!/^(S|A|B|C)([+-])?$/.test(stats.rank)) throw new Error('Invalid GitHub rank');
  const ring = svg.match(/@keyframes\s+rankAnimation\s*\{[\s\S]*?from\s*\{[\s\S]*?stroke-dashoffset:\s*([\d.]+)[\s\S]*?to\s*\{[\s\S]*?stroke-dashoffset:\s*([\d.]+)/);
  stats.rankProgress = ring ? Math.round((1 - Number(ring[2]) / Number(ring[1])) * 1e8) / 1e8 : null;
  if (stats.rankProgress !== null && (!Number.isFinite(stats.rankProgress) || stats.rankProgress < 0 || stats.rankProgress > 1)) throw new Error('Invalid rank progress');
  return stats;
}

function parseLanguages(svg) {
  if (!svg.includes('<svg')) throw new Error('The language service did not return an SVG');
  const languages = [...svg.matchAll(/<text\b[^>]*\bdata-testid=["']lang-name["'][^>]*>([^<]*)<\/text>/g)].map(match => {
    const parts = decodeXml(match[1].trim()).match(/^(.+?)\s+(\d+(?:\.\d+)?)%$/);
    if (!parts || Number(parts[2]) > 100) throw new Error('Invalid language percentage');
    return { name: parts[1], percent: Number(parts[2]), percentage: parts[2] + '%' };
  });
  if (!languages.length || languages.reduce((sum, language) => sum + language.percent, 0) > 100.1) {
    throw new Error('Language statistics are missing or inconsistent');
  }
  return languages;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validateStreak(data) {
  if (data?.mode !== 'daily') throw new Error('Expected daily contribution streak data');
  count(data.totalContributions, 'total contributions');
  if (data.totalContributions > 0 && !validDate(data.firstContribution)) throw new Error('Invalid first contribution date');
  for (const key of ['currentStreak', 'longestStreak']) {
    const streak = data[key];
    count(streak?.length, key);
    if (streak.length > 0 && (!validDate(streak.start) || !validDate(streak.end) || streak.start > streak.end)) {
      throw new Error(`Invalid ${key} date range`);
    }
  }
  return data;
}

function number(value) {
  return value.toLocaleString('en-US', value >= 1e6 ? { notation: 'compact', maximumFractionDigits: 1 } : {});
}

function date(value, year = false) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
}

function dateRange(streak) {
  if (streak.length === 0) return 'No active streak';
  const showYear = streak.start.slice(0, 4) !== streak.end.slice(0, 4);
  return `${date(streak.start, showYear)} – ${date(streak.end, showYear)}`;
}

function text(x, y, value, size = 14, color = 'currentColor', extra = '') {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${escapeXml(value)}</text>`;
}

function digit(x, y, value, size, color, extra = '') {
  const label = number(value);
  return text(x, y, label, label.length > 7 ? size * 0.75 : size, color, `font-family="Consolas, Liberation Mono, monospace" font-weight="700" ${extra}`);
}

function frame(title, eyebrow, description, height, theme, body) {
  const p = palettes[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)}</title>
  <desc id="description">${escapeXml(description)}</desc>
  <rect x=".5" y=".5" width="639" height="${height - 1}" rx="22" fill="${p.surface}" stroke="${p.border}"/>
  <g font-family="Segoe UI, Arial, sans-serif" fill="${p.text}">
    ${text(28, 32, eyebrow, 10, p.muted, 'font-family="Consolas, Liberation Mono, monospace" letter-spacing="1.7"')}
    ${text(28, 69, title, 27, p.text, 'font-family="Georgia, Times New Roman, serif" font-weight="700"')}
    <path d="M604 36 608 48 620 52 608 56 604 68 600 56 588 52 600 48Z" fill="${p.accent}" opacity=".8"/>
    ${body(p)}
  </g>
</svg>
`;
}

function renderOverview(stats, theme) {
  const description = `${stats.stars} stars; ${stats.commits} commits in the last year; ${stats.prs} pull requests; ${stats.issues} issues; ${stats.contribs} repositories contributed to in the last year; GitHub rank ${stats.rank}.`;
  return frame('GitHub Overview', 'SMALL IDEAS, GROWING INTO SOMETHING', description, 302, theme, p => `
    <rect x="24" y="94" width="406" height="168" rx="16" fill="${p.inset}"/>
    ${digit(44, 139, stats.stars, 34, p.accent)}
    ${text(44, 163, 'Total Stars', 14, p.muted)}
    ${digit(246, 139, stats.commits, 34, p.lavender)}
    ${text(246, 163, 'Commits · last year', 14, p.muted)}
    <path d="M44 181H410" stroke="${p.border}"/>
    ${digit(44, 216, stats.prs, 24, p.text)}
    ${text(44, 239, 'Pull requests', 12, p.muted)}
    ${digit(174, 216, stats.issues, 24, p.text)}
    ${text(174, 239, 'Issues', 12, p.muted)}
    ${digit(304, 216, stats.contribs, 24, p.text)}
    ${text(304, 239, 'Repos · last year', 12, p.muted)}
    <circle cx="521" cy="161" r="52" fill="${p.inset}" stroke="${p.border}" stroke-width="2"/>
    ${stats.rankProgress == null ? '' : `<circle cx="521" cy="161" r="52" fill="none" stroke="${p.lavender}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 52}" stroke-dashoffset="${(1 - stats.rankProgress) * 2 * Math.PI * 52}" transform="rotate(-90 521 161)"/>`}
    ${text(521, 175, stats.rank, 38, p.text, 'text-anchor="middle" font-family="Consolas, Liberation Mono, monospace" font-weight="700"')}
    ${text(521, 239, 'GitHub Rank', 14, p.muted, 'text-anchor="middle"')}
    ${text(28, 284, 'Small ideas, steady progress. (ᵔᴥᵔ)', 12, p.muted)}
  `);
}

function renderStreak(data, theme) {
  validateStreak(data);
  const firstDate = data.totalContributions ? `${date(data.firstContribution, true)} – present` : 'No contributions yet';
  const description = `${data.totalContributions} total contributions since ${data.firstContribution || 'joining GitHub'}; current streak ${data.currentStreak.length} days, ${dateRange(data.currentStreak)}; longest streak ${data.longestStreak.length} days, ${dateRange(data.longestStreak)}.`;
  return frame('Contribution Streak', 'A LITTLE PROGRESS, EVERY DAY', description, 282, theme, p => `
    <rect x="228" y="94" width="184" height="146" rx="18" fill="${p.inset}" stroke="${p.border}"/>
    ${digit(320, 157, data.currentStreak.length, 48, p.accent, 'text-anchor="middle"')}
    ${text(320, 188, 'Current streak', 14, p.text, 'text-anchor="middle" font-weight="600"')}
    ${text(320, 214, dateRange(data.currentStreak), 12, p.muted, 'text-anchor="middle"')}
    ${digit(120, 157, data.totalContributions, 32, p.cyan, 'text-anchor="middle"')}
    ${text(120, 188, 'Total contributions', 14, p.text, 'text-anchor="middle"')}
    ${text(120, 214, firstDate, 11, p.muted, 'text-anchor="middle"')}
    ${digit(520, 157, data.longestStreak.length, 32, p.lavender, 'text-anchor="middle"')}
    ${text(520, 188, 'Longest streak', 14, p.text, 'text-anchor="middle"')}
    ${text(520, 214, dateRange(data.longestStreak), 12, p.muted, 'text-anchor="middle"')}
    ${text(28, 264, 'Keep showing up. (ง •̀_•́)ง', 12, p.muted)}
  `);
}

function renderLanguages(languages, theme) {
  const rows = Math.ceil(languages.length / 2);
  const description = languages.map(language => `${language.name} ${language.percentage}`).join('; ');
  return frame('Most Used Languages', 'THE TOOLS BEHIND THE LITTLE IDEAS', description, 194 + rows * 40, theme, p => {
    let x = 28;
    const segments = languages.map((language, index) => {
      const width = 584 * language.percent / 100;
      const segment = `<rect x="${x}" y="142" width="${width}" height="12" fill="${languageColors[language.name] || fallbackColors[index % fallbackColors.length]}"/>`;
      x += width;
      return segment;
    }).join('');
    const legend = languages.map((language, index) => {
      const x = 28 + (index % 2) * 304;
      const y = 199 + Math.floor(index / 2) * 40;
      const color = languageColors[language.name] || fallbackColors[index % fallbackColors.length];
      return `<circle cx="${x + 5}" cy="${y - 5}" r="5" fill="${color}"/>
      ${text(x + 20, y, language.name, 14, p.text)}
      ${text(x + 276, y, language.percentage, 13, p.muted, 'text-anchor="end" font-family="Consolas, Liberation Mono, monospace"')}
      <rect x="${x}" y="${y + 12}" width="276" height="3" rx="1.5" fill="${p.inset}"/>
      <rect x="${x}" y="${y + 12}" width="${276 * language.percent / 100}" height="3" rx="1.5" fill="${color}"/>`;
    }).join('\n');
    return `${text(28, 119, languages[0].name, 18, p.text, 'font-weight="600"')}
      ${text(612, 119, languages[0].percentage, 29, p.accent, 'text-anchor="end" font-family="Consolas, Liberation Mono, monospace" font-weight="700"')}
      <defs><clipPath id="language-bar"><rect x="28" y="142" width="584" height="12" rx="6"/></clipPath></defs>
      <rect x="28" y="142" width="584" height="12" rx="6" fill="${p.inset}"/>
      <g clip-path="url(#language-bar)">${segments}</g>
      ${legend}`;
  });
}

module.exports = { parseOverview, parseLanguages, validateStreak, renderOverview, renderStreak, renderLanguages };
