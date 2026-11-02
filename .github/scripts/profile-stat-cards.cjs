const { PROFILE_FONT, applyProfileFont } = require('./profile-font.cjs');
const { LANGUAGE_MOTION_CSS, languageMotionDelay } = require('./profile-language-motion.cjs');

const palettes = {
  dark: { border: '#353445', text: '#f1eaf7', muted: '#adbac7', accent: '#ffaec5', lavender: '#d7c4f3', cyan: '#b9edf2' },
  light: { border: '#e6dce9', text: '#3b2d4f', muted: '#756782', accent: '#9c4268', lavender: '#756092', cyan: '#367484' },
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
  return text(x, y, label, label.length > 7 ? size * 0.75 : size, color, `font-weight="700" ${extra}`);
}

function renderDashboard(data, theme, compact = false) {
  const { overview: stats, streak, languages } = data;
  validateStreak(streak);
  const p = palettes[theme];
  const width = compact ? 360 : 840;
  const padding = compact ? 20 : 28;
  const contentWidth = width - padding * 2;
  const columns = compact ? 1 : 2;
  const rows = Math.max(1, Math.ceil(languages.length / columns));
  const legendTop = compact ? 389 : 318;
  const rowHeight = compact ? 28 : 32;
  const height = legendTop + (rows - 1) * rowHeight + (compact ? 22 : 18);
  const firstDate = streak.totalContributions ? `${date(streak.firstContribution, true)} – present` : 'No contributions yet';
  const description = `${stats.stars} stars; ${stats.commits} commits in the last year; ${stats.prs} pull requests; ${stats.issues} issues; ${stats.contribs} repositories contributed to in the last year; GitHub rank ${stats.rank}. ${streak.totalContributions} total contributions since ${streak.firstContribution || 'joining GitHub'}; current streak ${streak.currentStreak.length} days, ${dateRange(streak.currentStreak)}; longest streak ${streak.longestStreak.length} days, ${dateRange(streak.longestStreak)}. ${languages.map(language => `${language.name} ${language.percentage}`).join('; ')}.`;
  const heading = (y, label) => text(padding, y, label, 14, p.muted, 'font-weight="700"');
  const divider = y => `<path d="M${padding} ${y}H${width - padding}" stroke="${p.border}"/>`;
  const metrics = [
    { value: stats.stars, label: 'Stars', color: p.accent },
    { value: stats.commits, label: compact ? 'Commits · year' : 'Commits · last year', color: p.lavender },
    { value: stats.prs, label: 'Pull requests' },
    { value: stats.issues, label: 'Issues' },
    { value: stats.contribs, label: compact ? 'Repos · year' : 'Repos · last year' },
    { value: stats.rank, label: 'Rank' },
  ].map((metric, index) => {
    const x = padding + index % (compact ? 3 : 6) * contentWidth / (compact ? 3 : 6);
    const y = (compact ? 67 : 74) + Math.floor(index / (compact ? 3 : 6)) * 55;
    return `<g class="reveal">
      ${typeof metric.value === 'number' ? digit(x, y, metric.value, 28, metric.color || p.text) : text(x, y, metric.value, 28, p.text, 'font-weight="700"')}
      ${text(x, y + 22, metric.label, compact ? 12 : 13, p.muted)}
    </g>`;
  }).join('\n');
  const streakMetrics = [
    { value: streak.totalContributions, label: compact ? 'Contributions' : 'Total contributions', detail: firstDate, color: p.cyan },
    { value: streak.currentStreak.length, label: compact ? 'Current · days' : 'Current streak · days', detail: dateRange(streak.currentStreak), color: p.accent, dates: streak.currentStreak },
    { value: streak.longestStreak.length, label: compact ? 'Longest · days' : 'Longest streak · days', detail: dateRange(streak.longestStreak), color: p.lavender, dates: streak.longestStreak },
  ].map((metric, index) => {
    const x = padding + index * contentWidth / 3;
    const y = compact ? 231 : 176;
    let details = [metric.detail];
    if (compact && index === 0 && streak.totalContributions) details = ['Since', date(streak.firstContribution, true)];
    if (compact && metric.dates?.length > 0 && metric.dates.start.slice(0, 4) !== metric.dates.end.slice(0, 4)) {
      details = [date(metric.dates.start, true), `– ${date(metric.dates.end, true)}`];
    }
    if (compact && metric.detail === 'No contributions yet') details = ['No contributions', 'yet'];
    return `<g class="reveal" style="animation-delay:.08s">
      <title>${escapeXml(`${metric.label}: ${metric.value}; ${metric.detail}`)}</title>
      ${digit(x, y, metric.value, 28, metric.color)}
      ${text(x, y + 22, metric.label, compact ? 12 : 13, p.muted)}
      ${details.map((detail, line) => text(x, y + 43 + line * 14, detail, compact ? 11 : 12, p.muted)).join('')}
    </g>`;
  }).join('\n');
  const barY = compact ? 350 : 281;
  let offset = 0;
  const segments = languages.map((language, index) => {
    const segmentWidth = contentWidth * language.percent / 100;
    const segment = `<rect x="${padding + offset}" y="${barY}" width="${segmentWidth}" height="8" fill="${languageColors[language.name] || fallbackColors[index % fallbackColors.length]}"/>`;
    offset += segmentWidth;
    return segment;
  }).join('');
  const columnWidth = compact ? contentWidth : (contentWidth - 32) / 2;
  const legend = languages.map((language, index) => {
    const x = padding + index % columns * (columnWidth + 32);
    const y = legendTop + Math.floor(index / columns) * rowHeight;
    const color = languageColors[language.name] || fallbackColors[index % fallbackColors.length];
    const labelSize = language.name.length > 22 ? 12 : 14;
    return `<g class="language-entry language-pop" style="--language-delay:${languageMotionDelay(index)}">
      <circle cx="${x + 4}" cy="${y - 4}" r="4" fill="${color}"/>
      ${text(x + 16, y, language.name, labelSize, p.text)}
      ${text(x + columnWidth, y, language.percentage, 14, p.muted, 'text-anchor="end"')}
    </g>`;
  }).join('\n');
  return applyProfileFont(`<svg font-family="${PROFILE_FONT}" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">GitHub statistics</title>
  <desc id="description">${escapeXml(description)}</desc>
  <defs><clipPath id="language-bar"><rect x="${padding}" y="${barY}" width="${contentWidth}" height="8" rx="4"/></clipPath></defs>
  <style>
${LANGUAGE_MOTION_CSS}
    @keyframes appear { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
    .reveal { animation:appear .5s ease-out backwards; }
    @media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation:none !important; } }
  </style>
  <rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="${p.border}"/>
  <g font-family="${PROFILE_FONT}" fill="${p.text}">
    ${heading(compact ? 30 : 32, 'Overview')}
    ${metrics}
    ${divider(compact ? 164 : 116)}
    ${heading(compact ? 192 : 144, 'Contribution streak')}
    ${streakMetrics}
    ${divider(compact ? 307 : 238)}
    ${heading(compact ? 335 : 266, 'Languages')}
    ${languages.length ? `<rect x="${padding}" y="${barY}" width="${contentWidth}" height="8" rx="4" fill="${p.border}"/>
    <g clip-path="url(#language-bar)"><g class="language-grow" style="--language-delay:${languageMotionDelay(0, 0.08)}">${segments}</g></g>
    ${legend}` : text(padding, legendTop, 'No language data yet', 14, p.muted)}
  </g>
</svg>
`);
}

module.exports = { parseOverview, parseLanguages, validateStreak, renderDashboard };
