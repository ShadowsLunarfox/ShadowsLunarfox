const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOverview, parseLanguages, validateStreak, renderDashboard } = require('./profile-stat-cards.cjs');
const { fetchProfileStats } = require('./generate-profile-stats.cjs');

const overview = { stars: 67, commits: 134, prs: 1, issues: 1, contribs: 0, rank: 'B-', rankProgress: 0.3 };
const overviewSvg = values => `<svg><style>@keyframes rankAnimation { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 70; } }</style>${Object.entries({ ...overview, ...values }).filter(([key]) => key !== 'rankProgress').map(([key, value]) => `<text\n data-testid="${key === 'rank' ? 'level-rank-icon' : key}">\n${value}\n</text>`).join('')}</svg>`;
const languagesSvg = '<svg><text data-testid="lang-name">C# 65.25%</text><text data-testid="lang-name">C++ 34.75%</text></svg>';
const streak = { mode: 'daily', totalContributions: 162, firstContribution: '2021-10-04', currentStreak: { start: '2026-10-06', end: '2026-10-15', length: 10 }, longestStreak: { start: '2026-10-06', end: '2026-10-15', length: 10 } };
const dashboard = (overrides = {}) => ({ overview, streak, languages: parseLanguages(languagesSvg), ...overrides });

test('all five overview metrics, zero values and the original rank survive parsing', () => {
  assert.deepEqual(parseOverview(overviewSvg()), overview);
  assert.equal(parseOverview(overviewSvg({ stars: '12567' })).stars, 12567);
  for (const stars of ['1.2k', '-1', '', '9007199254740992']) assert.throws(() => parseOverview(overviewSvg({ stars })), /count|Expected/);
  assert.throws(() => parseOverview('<svg>Service error</svg>'), /Missing/);
});

test('language precision and XML entities are preserved without altering percentages', () => {
  const languages = parseLanguages(languagesSvg);
  assert.deepEqual(languages, [{ name: 'C#', percent: 65.25, percentage: '65.25%' }, { name: 'C++', percent: 34.75, percentage: '34.75%' }]);
  assert.equal(parseLanguages('<svg><text data-testid="lang-name">A &amp; B 100%</text></svg>')[0].name, 'A & B');
  for (const svg of ['<svg/>', '<svg><text data-testid="lang-name">C# 101%</text></svg>', languagesSvg.replace('34.75%', '90%')]) assert.throws(() => parseLanguages(svg), /language|Language/);
});

test('the rank ring uses the source progress and omits the arc if progress is unavailable', () => {
  assert.equal(parseOverview(overviewSvg()).rankProgress, 0.3);
  const noProgress = parseOverview(overviewSvg().replace(/<style>.*?<\/style>/, ''));
  assert.equal(noProgress.rankProgress, null);
  assert.doesNotMatch(renderDashboard(dashboard({ overview: noProgress }), 'dark'), /class="rank-progress"/);
  const arc = renderDashboard(dashboard(), 'dark').match(/class="rank-progress"[^>]*stroke-dasharray="([\d.]+)" stroke-dashoffset="([\d.]+)"/);
  assert.ok(Math.abs(1 - Number(arc[2]) / Number(arc[1]) - overview.rankProgress) < 1e-10);
  assert.throws(() => parseOverview(overviewSvg().replace('stroke-dashoffset: 70', 'stroke-dashoffset: 170')), /rank progress/);
});

test('daily streak dates are validated while zero streaks and zero contributions are supported', () => {
  assert.deepEqual(validateStreak(streak), streak);
  const empty = { mode: 'daily', totalContributions: 0, firstContribution: null, currentStreak: { length: 0 }, longestStreak: { length: 0 } };
  const output = renderDashboard(dashboard({ streak: validateStreak(empty) }), 'dark');
  assert.match(output, /No contributions yet/);
  assert.match(output, /No active streak/);
  assert.throws(() => validateStreak({ ...streak, mode: 'weekly' }), /daily/);
  assert.throws(() => validateStreak({ ...streak, currentStreak: { length: 2, start: '2026-02-30', end: '2026-03-01' } }), /date range/);
});

test('rendering retains metric values, rank, streak dates and precise language percentages in both themes', () => {
  for (const theme of ['light', 'dark']) {
    const output = renderDashboard(dashboard(), theme);
    assert.match(output, /67 stars; 134 commits.*1 pull requests; 1 issues; 0 repositories.*rank B-/);
    assert.match(output, /162 total contributions/);
    assert.match(output, /Oct 6 – Oct 15/);
    assert.match(output, /Oct 4, 2021 – present/);
    assert.match(output, /65\.25%/);
    assert.match(output, /34\.75%/);
  }
  const escaped = renderDashboard(dashboard({ languages: [{ name: '<script> & "', percent: 100, percentage: '100%' }] }), 'dark');
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt; &amp; &quot;/);
});

test('one self-contained dashboard supports animation, reduced motion and any number of language rows', () => {
  const output = renderDashboard(dashboard(), 'dark');
  assert.equal((output.match(/<svg\b/g) || []).length, 1);
  assert.doesNotMatch(output, /<script\b|<foreignObject\b|<image\b|(?:href=["']|url\(["']?)https?:\/\//);
  assert.match(output, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(output, /animation:none !important/);
  assert.match(output, /animation:orbit 24s linear infinite/);
  assert.match(output, /animation:shimmer 8s ease-in-out infinite/);
  assert.match(output, /width="495\.9[0-9]*" height="14"/);
  const languages = Array.from({ length: 9 }, (_, index) => ({ name: `Language ${index}`, percent: 10, percentage: '10%' }));
  const expanded = renderDashboard(dashboard({ languages }), 'light');
  assert.match(expanded, /viewBox="0 0 840 890"/);
  assert.match(expanded, /Language 8/);
  const empty = renderDashboard(dashboard({ languages: [] }), 'light');
  assert.match(empty, /No language data yet/);
  assert.match(empty, /viewBox="0 0 840 650"/);
});

test('a failed service prevents a refresh and valid services preserve the established counting options', async () => {
  const requests = [];
  const response = url => url.hostname.includes('demolab') ? JSON.stringify(streak) : url.pathname.includes('top-langs') ? languagesSvg : overviewSvg();
  const result = await fetchProfileStats('Lunarfox', async url => {
    requests.push(url);
    return { ok: true, text: async () => response(url) };
  });
  assert.deepEqual(result.overview, overview);
  assert.equal(requests[0].searchParams.get('number_format'), 'long');
  assert.equal(requests[0].searchParams.get('include_all_commits'), 'false');
  assert.equal(requests[1].searchParams.get('timezone'), 'Asia/Kuala_Lumpur');
  await assert.rejects(fetchProfileStats('Lunarfox', async () => ({ ok: false, status: 503 })), /HTTP 503/);
});
