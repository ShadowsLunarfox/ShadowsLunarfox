const { PROFILE_FONT, applyProfileFont } = require('./profile-font.cjs');

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
  return text(x, y, label, label.length > 7 ? size * 0.75 : size, color, `font-weight="700" ${extra}`);
}

function renderDashboard(data, theme) {
  const { overview: stats, streak, languages } = data;
  validateStreak(streak);
  const p = palettes[theme];
  const rows = Math.ceil(languages.length / 2);
  const height = 650 + rows * 48;
  const firstDate = streak.totalContributions ? `${date(streak.firstContribution, true)} – present` : 'No contributions yet';
  const description = `${stats.stars} stars; ${stats.commits} commits in the last year; ${stats.prs} pull requests; ${stats.issues} issues; ${stats.contribs} repositories contributed to in the last year; GitHub rank ${stats.rank}. ${streak.totalContributions} total contributions since ${streak.firstContribution || 'joining GitHub'}; current streak ${streak.currentStreak.length} days, ${dateRange(streak.currentStreak)}; longest streak ${streak.longestStreak.length} days, ${dateRange(streak.longestStreak)}. ${languages.map(language => `${language.name} ${language.percentage}`).join('; ')}.`;
  const kicker = (x, y, label) => text(x, y, label, 11, p.muted, 'letter-spacing="1.8"');
  const divider = y => `<path d="M40 ${y}H800" stroke="${p.border}"/>`;
  const circumference = 2 * Math.PI * 62;
  const rankArc = stats.rankProgress == null ? '' : `<circle class="rank-progress" cx="680" cy="212" r="62" fill="none" stroke="url(#pastel)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${(1 - stats.rankProgress) * circumference}" style="--ring-length:${circumference}" transform="rotate(-90 680 212)"/>`;
  let offset = 0;
  const segments = languages.map((language, index) => {
    const width = 760 * language.percent / 100;
    const segment = `<rect x="${40 + offset}" y="574" width="${width}" height="14" fill="${languageColors[language.name] || fallbackColors[index % fallbackColors.length]}"/>`;
    offset += width;
    return segment;
  }).join('');
  const legend = languages.map((language, index) => {
    const x = 40 + (index % 2) * 398;
    const y = 620 + Math.floor(index / 2) * 48;
    const color = languageColors[language.name] || fallbackColors[index % fallbackColors.length];
    const labelSize = language.name.length > 22 ? 12 : 15;
    return `<g>
      <circle cx="${x + 5}" cy="${y - 5}" r="5" fill="${color}"/>
      ${text(x + 20, y, language.name, labelSize, p.text)}
      ${text(x + 362, y, language.percentage, 14, p.muted, 'text-anchor="end"')}
      <rect x="${x}" y="${y + 12}" width="362" height="3" rx="1.5" fill="${p.border}" opacity=".5"/>
      <rect class="language-grow" x="${x}" y="${y + 12}" width="${362 * language.percent / 100}" height="3" rx="1.5" fill="${color}" style="animation-delay:${0.3 + index * 0.08}s"/>
    </g>`;
  }).join('\n');
  return applyProfileFont(`<svg font-family="${PROFILE_FONT}" xmlns="http://www.w3.org/2000/svg" width="840" height="${height}" viewBox="0 0 840 ${height}" role="img" aria-labelledby="title description">
  <title id="title">GitHub Stats · Small commits, steady growth</title>
  <desc id="description">${escapeXml(description)}</desc>
  <defs>
    <linearGradient id="pastel" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${p.accent}"/><stop offset=".52" stop-color="${p.lavender}"/><stop offset="1" stop-color="${p.cyan}"/>
    </linearGradient>
    <linearGradient id="header-wash" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${p.lavender}" stop-opacity=".07"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="streak-wash"><stop stop-color="${p.accent}" stop-opacity="0"/><stop offset=".5" stop-color="${p.accent}" stop-opacity=".07"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></linearGradient>
    <linearGradient id="shine"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="panel-clip"><rect x="1" y="1" width="838" height="${height - 2}" rx="26"/></clipPath>
    <clipPath id="language-bar"><rect x="40" y="574" width="760" height="14" rx="7"/></clipPath>
  </defs>
  <style>
    @keyframes appear { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
    @keyframes draw-rank { from { stroke-dashoffset:var(--ring-length); } }
    @keyframes grow { from { transform:scaleX(0); } to { transform:scaleX(1); } }
    @keyframes orbit { to { transform:rotate(360deg); } }
    @keyframes twinkle { 0%,100% { opacity:.35; transform:scale(.85); } 50% { opacity:1; transform:scale(1.12); } }
    @keyframes breathe { 0%,100% { opacity:.65; transform:scale(.94); } 50% { opacity:1; transform:scale(1.06); } }
    @keyframes shimmer { 0%,15% { transform:translateX(0); opacity:0; } 25% { opacity:1; } 65%,100% { transform:translateX(1000px); opacity:0; } }
    .reveal { animation:appear .8s ease-out backwards; }
    .rank-progress { animation:draw-rank 1.5s cubic-bezier(.22,1,.36,1) backwards; }
    .rank-orbit { transform-origin:680px 212px; animation:orbit 24s linear infinite; }
    .spark { transform-box:fill-box; transform-origin:center; animation:twinkle 4s ease-in-out infinite; }
    .spark-late { animation-delay:-2s; }
    .flame { transform-box:fill-box; transform-origin:center; animation:breathe 3s ease-in-out infinite; }
    .language-grow { transform-box:fill-box; transform-origin:left; animation:grow 1.2s cubic-bezier(.22,1,.36,1) backwards; }
    .shimmer { animation:shimmer 8s ease-in-out infinite; }
    @media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation:none !important; } .shimmer { opacity:0; } }
  </style>
  <rect x=".5" y=".5" width="839" height="${height - 1}" rx="26" fill="${p.surface}" stroke="${p.border}"/>
  <g clip-path="url(#panel-clip)">
    <rect x="1" y="1" width="838" height="312" fill="url(#header-wash)"/>
    <path d="M40 1H800" stroke="url(#pastel)" stroke-width="2" opacity=".7"/>
  </g>
  <g font-family="${PROFILE_FONT}" fill="${p.text}">
    ${kicker(40, 38, 'LUNARFOX / GITHUB AT A GLANCE')}
    ${text(40, 81, 'Small commits, steady growth.', 32, p.text, 'font-weight="700"')}
    <path class="spark" d="M772 33 777 48 792 53 777 58 772 73 767 58 752 53 767 48Z" fill="${p.accent}"/>
    <path class="spark spark-late" d="M736 25 738 31 744 33 738 35 736 41 734 35 728 33 734 31Z" fill="${p.lavender}"/>
    ${divider(110)}
    ${kicker(40, 141, '01 / OVERVIEW')}
    <g class="reveal">
      ${digit(40, 202, stats.stars, 44, p.accent)}
      ${text(40, 226, 'Total stars', 15, p.muted)}
      ${digit(280, 202, stats.commits, 44, p.lavender)}
      ${text(280, 226, 'Commits · last year', 15, p.muted)}
      ${digit(40, 276, stats.prs, 26, p.text)}
      ${text(40, 298, 'Pull requests', 14, p.muted)}
      ${digit(215, 276, stats.issues, 26, p.text)}
      ${text(215, 298, 'Issues', 14, p.muted)}
      ${digit(365, 276, stats.contribs, 26, p.text)}
      ${text(365, 298, 'Repos · last year', 14, p.muted)}
    </g>
    <path d="M546 151V295" stroke="${p.border}"/>
    <circle cx="680" cy="212" r="76" fill="none" stroke="${p.border}" stroke-dasharray="2 9" opacity=".7"/>
    <circle cx="680" cy="212" r="62" fill="none" stroke="${p.border}" stroke-width="5"/>
    ${rankArc}
    <g class="rank-orbit"><circle cx="680" cy="136" r="4" fill="${p.cyan}"/><circle cx="680" cy="288" r="2.5" fill="${p.accent}"/></g>
    ${text(680, 225, stats.rank, 42, p.text, 'text-anchor="middle" font-weight="700"')}
    ${text(680, 299, 'GitHub rank', 14, p.muted, 'text-anchor="middle"')}
    ${divider(322)}
    ${kicker(40, 353, '02 / CONTRIBUTION STREAK')}
    <rect x="40" y="370" width="760" height="109" rx="18" fill="url(#streak-wash)"/>
    <path d="M292 387V469M548 387V469" stroke="${p.border}"/>
    <g class="reveal" style="animation-delay:.15s">
      ${digit(166, 417, streak.totalContributions, 36, p.cyan, 'text-anchor="middle"')}
      ${text(166, 443, 'Total contributions', 15, p.text, 'text-anchor="middle"')}
      ${text(166, 467, firstDate, 12, p.muted, 'text-anchor="middle"')}
      <path class="flame" d="M373 406C361 404 360 394 365 387C365 394 370 394 369 387C368 380 373 376 376 373C375 384 386 387 385 396C385 403 380 407 373 406Z" fill="${p.accent}"/>
      ${digit(439, 419, streak.currentStreak.length, 50, p.accent, 'text-anchor="middle"')}
      ${text(420, 443, 'Current streak · days', 15, p.text, 'text-anchor="middle" font-weight="600"')}
      ${text(420, 467, dateRange(streak.currentStreak), 12, p.muted, 'text-anchor="middle"')}
      ${digit(674, 417, streak.longestStreak.length, 36, p.lavender, 'text-anchor="middle"')}
      ${text(674, 443, 'Longest streak · days', 15, p.text, 'text-anchor="middle"')}
      ${text(674, 467, dateRange(streak.longestStreak), 12, p.muted, 'text-anchor="middle"')}
    </g>
    ${divider(492)}
    ${kicker(40, 523, '03 / MOST USED LANGUAGES')}
    ${text(40, 555, languages[0]?.name || 'No language data yet', 18, p.text, 'font-weight="600"')}
    ${text(800, 555, languages[0]?.percentage || '', 25, p.accent, 'text-anchor="end" font-weight="700"')}
    <rect x="40" y="574" width="760" height="14" rx="7" fill="${p.border}"/>
    <g clip-path="url(#language-bar)"><g class="language-grow">${segments}</g><rect class="shimmer" x="-150" y="574" width="120" height="14" fill="url(#shine)"/></g>
    ${legend}
    ${divider(height - 54)}
    ${text(40, height - 27, 'Small ideas, growing into something. (ᵔᴥᵔ)', 12, p.muted)}
    ${text(800, height - 27, `${languages.length} LANGUAGES / DAILY SNAPSHOT`, 10, p.muted, 'text-anchor="end" letter-spacing="1"')}
  </g>
</svg>
`);
}

module.exports = { parseOverview, parseLanguages, validateStreak, renderDashboard };
