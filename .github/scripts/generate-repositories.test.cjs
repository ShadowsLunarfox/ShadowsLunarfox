const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, selectRepositories, fetchRepositories, renderCard, renderSection, replaceSection, wrapDescription } = require('./generate-repositories.cjs');

const repo = (name, stars = 0, overrides = {}) => ({ name, full_name: `Lunarfox/${name}`, owner: { login: 'Lunarfox' }, private: false, fork: false, archived: false, stargazers_count: stars, forks_count: 0, updated_at: '2026-10-14T00:00:00Z', ...overrides });
const config = overrides => ({ count: 6, repositories: [], exclude: [], sort: 'stars', ...overrides });

test('manual order is preserved, duplicates are ignored and remaining slots use stars', () => {
  const repositories = [repo('Low', 1), repo('High', 20), repo('Middle', 10), repo('Excluded', 100)];
  const selected = selectRepositories(repositories, config({ count: 3, repositories: ['low', 'LOW'], exclude: ['Excluded'] }));
  assert.deepEqual(selected.map(item => item.name), ['Low', 'High', 'Middle']);
});

test('counts above six work and requests beyond availability show only real repositories', () => {
  const repositories = Array.from({ length: 12 }, (_, index) => repo(`Project-${index}`, index));
  assert.equal(selectRepositories(repositories, config({ count: 8 })).length, 8);
  assert.equal(selectRepositories(repositories, config({ count: 20 })).length, 12);
});

test('zero hides the heading and all cards', () => {
  assert.deepEqual(selectRepositories([repo('Project')], config({ count: 0 })), []);
  assert.doesNotMatch(renderSection([]), /<h2|<a |<img/);
});

test('private repositories never appear, while forks and archives require explicit selection', () => {
  const repositories = [repo('Private', 100, { private: true }), repo('Fork', 50, { fork: true }), repo('Archived', 25, { archived: true }), repo('Public', 1)];
  assert.deepEqual(selectRepositories(repositories, config()).map(item => item.name), ['Public']);
  assert.deepEqual(selectRepositories(repositories, config({ repositories: ['Archived', 'Fork'] })).map(item => item.name), ['Archived', 'Fork', 'Public']);
  assert.throws(() => selectRepositories(repositories, config({ repositories: ['Private'] })), /missing, private or excluded/);
});

test('invalid counts and unavailable selections fail instead of silently changing the display', () => {
  for (const count of [-1, 1.5, '6']) assert.throws(() => validateConfig(config({ count })), /count/);
  assert.throws(() => selectRepositories([], config({ repositories: ['Missing'] })), /Missing/);
  assert.throws(() => validateConfig(config({ repositories: ['../Other/Repo'] })), /repository names/);
});

test('repository descriptions are escaped, wrapped and truncated without SVG injection', () => {
  const svg = renderCard(repo('Project', 25, { description: '<script>alert("x")</script> & more', language: 'C#', forks_count: 5 }), 'dark');
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /#d7c4f3/);
  assert.match(svg, /25 stars; 5 forks/);
  const lines = wrapDescription('A long repository description with many words. '.repeat(20));
  assert.equal(lines.length, 3);
  assert.match(lines[2], /…$/);
  assert.deepEqual(wrapDescription(null), []);
});

test('odd repository counts keep individual links and paired light/dark images', () => {
  const section = renderSection([repo('One'), repo('Two'), repo('Three')]);
  assert.equal((section.match(/<p /g) || []).length, 2);
  assert.equal((section.match(/<a href=/g) || []).length, 3);
  assert.equal((section.match(/<source /g) || []).length, 3);
  assert.match(section, /https:\/\/github.com\/Lunarfox\/Three/);
});

test('README content outside the generated section and its line endings are preserved', () => {
  const readme = 'Before\r\n<!-- BEGIN featured-repositories -->\r\nold\r\n<!-- END featured-repositories -->\r\nAfter';
  const updated = replaceSection(readme, [repo('One')]);
  assert.ok(updated.startsWith('Before\r\n'));
  assert.ok(updated.endsWith('\r\nAfter'));
  assert.doesNotMatch(updated, /(?<!\r)\n/);
  assert.throws(() => replaceSection('No markers', []), /BEGIN\/END/);
});

test('repository API pagination retains only public repositories owned by the user', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => repo(`Project-${index}`));
  const pages = [firstPage, [repo('Last'), repo('Private', 0, { private: true }), repo('Other', 0, { owner: { login: 'Elsewhere' } })]];
  const requested = [];
  const result = await fetchRepositories('Lunarfox', undefined, async url => {
    requested.push(url.searchParams.get('page'));
    return { ok: true, status: 200, json: async () => pages.shift() };
  });
  assert.deepEqual(requested, ['1', '2']);
  assert.equal(result.length, 101);
  assert.equal(result.at(-1).name, 'Last');
});
