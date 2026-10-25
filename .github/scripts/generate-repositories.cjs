const fs = require('node:fs/promises');
const path = require('node:path');
const { PROFILE_FONT, applyProfileFont } = require('./profile-font.cjs');

const BEGIN = '<!-- BEGIN featured-repositories -->';
const END = '<!-- END featured-repositories -->';

function validateConfig(config) {
  if (!Number.isSafeInteger(config.count) || config.count < 0) {
    throw new Error('count must be a non-negative whole number; use 0 to hide the section');
  }
  for (const key of ['repositories', 'exclude']) {
    if (!Array.isArray(config[key]) || config[key].some(name => typeof name !== 'string' || !/^[\w.-]+$/.test(name))) {
      throw new Error(`${key} must be a list of repository names belonging to the profile owner`);
    }
  }
  if (!['stars', 'updated', 'name'].includes(config.sort)) throw new Error('sort must be stars, updated or name');
  return config;
}

function selectRepositories(repositories, config) {
  validateConfig(config);
  if (config.count === 0) return [];
  const excluded = new Set(config.exclude.map(name => name.toLowerCase()));
  const available = repositories.filter(repo => !repo.private && !excluded.has(repo.name.toLowerCase()));
  const byName = new Map(available.map(repo => [repo.name.toLowerCase(), repo]));
  const selected = new Map();
  for (const name of config.repositories) {
    const repo = byName.get(name.toLowerCase());
    if (!repo) throw new Error(`Configured repository "${name}" is missing, private or excluded`);
    selected.set(repo.name.toLowerCase(), repo);
  }
  const automatic = available.filter(repo => !repo.fork && !repo.archived && !selected.has(repo.name.toLowerCase()));
  automatic.sort((a, b) => {
    let difference = 0;
    if (config.sort === 'stars') difference = b.stargazers_count - a.stargazers_count;
    if (config.sort === 'updated') difference = Date.parse(b.updated_at) - Date.parse(a.updated_at);
    return difference || a.name.localeCompare(b.name, 'en');
  });
  for (const repo of automatic) selected.set(repo.name.toLowerCase(), repo);
  return [...selected.values()].slice(0, config.count);
}

async function fetchRepositories(username, token, request = fetch) {
  const repositories = [];
  for (let page = 1; ; page++) {
    const url = new URL(`https://api.github.com/users/${encodeURIComponent(username)}/repos`);
    url.search = new URLSearchParams({ type: 'owner', per_page: '100', sort: 'full_name', direction: 'asc', page: String(page) }).toString();
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Lunarfox-profile-generator', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await request(url, { headers, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) throw new Error(`GitHub repository data is unavailable (${response.status}): ${data.message || 'invalid response'}`);
    repositories.push(...data.filter(repo => repo.owner?.login?.toLowerCase() === username.toLowerCase() && !repo.private));
    if (data.length < 100) break;
  }
  return repositories;
}

function escapeXml(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function textWidth(text, size = 16) {
  return [...text].reduce((width, char) => {
    const factor = /\s/.test(char) ? 0.3 : /[ilI.,:;!|'`]/.test(char) ? 0.3 : /[frtj()[\]{}]/.test(char) ? 0.42 : /[MW@%]/.test(char) ? 0.95 : /[^\x00-\x7f]/.test(char) ? 1 : /[A-Z0-9]/.test(char) ? 0.7 : 0.55;
    // Keep a conservative width allowance for the embedded cartoon font.
    return width + size * factor * 1.12;
  }, 0);
}

function truncateText(text, width, size = 16) {
  if (textWidth(text, size) <= width) return text;
  const chars = [...text];
  while (chars.length && textWidth(chars.join('') + '…', size) > width) chars.pop();
  return chars.join('').trimEnd() + '…';
}

function wrapDescription(description) {
  const words = String(description || '').trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  for (const word of words) {
    let chunk = '';
    for (const char of word) {
      if (textWidth(chunk + char) > 504) { chunks.push(chunk); chunk = ''; }
      chunk += char;
    }
    if (chunk) chunks.push(chunk);
  }
  const lines = [];
  let line = '';
  for (const word of chunks) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next) > 504) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > 3) return [...lines.slice(0, 2), truncateText(lines[2] + '…', 504)];
  return lines;
}

function renderCard(repo, theme) {
  const colors = theme === 'dark'
    ? { title: '#ffaec5', text: '#adbac7', border: '#444c56' }
    : { title: '#615276', text: '#3b2d4f', border: '#d0d7de' };
  const languageColors = { 'C#': '#d7c4f3', 'C++': '#b9edf2', Java: '#ffd3b0', Python: '#ffe9a3', JavaScript: '#ffd166', HTML: '#ffaec5', CSS: '#bbe8f2', TypeScript: '#b9edf2' };
  const parts = [];
  let x = 28;
  if (repo.language) {
    const language = truncateText(repo.language, 160, 14);
    parts.push(`<circle cx="${x + 7}" cy="166" r="7" fill="${languageColors[repo.language] || '#d7c4f3'}"/><text x="${x + 20}" y="171">${escapeXml(language)}</text>`);
    x += 20 + textWidth(language, 14) + 22;
  }
  const number = value => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  for (const [kind, value] of [['stars', repo.stargazers_count], ['forks', repo.forks_count]]) {
    if (!value) continue;
    const icon = kind === 'stars'
      ? '<path d="M8 1.2 10.1 5.5 14.8 6.2 11.4 9.5 12.2 14.2 8 12 3.8 14.2 4.6 9.5 1.2 6.2 5.9 5.5Z"/>'
      : '<circle cx="4" cy="3" r="2"/><circle cx="12" cy="3" r="2"/><circle cx="8" cy="13" r="2"/><path d="M4 5v2c0 2 4 1 4 4m4-6v2c0 2-4 1-4 4"/>';
    parts.push(`<g transform="translate(${x} 155)" fill="none" stroke="${colors.text}" stroke-width="1.5" stroke-linejoin="round">${icon}</g><text x="${x + 23}" y="171">${number(value)}</text>`);
    x += 23 + textWidth(number(value), 14) + 22;
  }
  const description = wrapDescription(repo.description).map((line, index) => `<tspan x="28" y="${81 + index * 22}">${escapeXml(line)}</tspan>`).join('');
  return applyProfileFont(`<svg font-family="${PROFILE_FONT}" xmlns="http://www.w3.org/2000/svg" width="560" height="200" viewBox="0 0 560 200" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(repo.full_name)}</title>
  <desc id="description">${escapeXml(repo.description || '')} ${escapeXml(repo.language || '')}; ${repo.stargazers_count} stars; ${repo.forks_count} forks.</desc>
  <rect x="8.5" y="8.5" width="543" height="183" rx="6" fill="none" stroke="${colors.border}"/>
  <g font-family="${PROFILE_FONT}" fill="${colors.text}">
    <text x="28" y="46" font-size="18" font-weight="600" fill="${colors.title}">${escapeXml(truncateText(repo.name, 432, 18))}</text>
    <rect x="478.5" y="28.5" width="53" height="23" rx="11.5" fill="none" stroke="${colors.border}"/>
    <text x="505" y="44.5" text-anchor="middle" font-size="13">Public</text>
    <text font-size="16">${description}</text>
    <g font-size="14">${parts.join('')}</g>
  </g>
</svg>
`);
}

function renderSection(repositories, newline = '\n') {
  const lines = [BEGIN, '<!-- Generated from .github/featured-repositories.json; edit that file to change the cards. -->'];
  if (repositories.length) {
    lines.push('<h2>✨ <samp>Featured Repositories (ง •̀_•́)ง</samp></h2>', '');
    for (let index = 0; index < repositories.length; index += 2) {
      lines.push('<p align="left">');
      for (let offset = index; offset < Math.min(index + 2, repositories.length); offset++) {
        const repo = repositories[offset];
        const href = `https://github.com/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}`;
        lines.push(`  <a href="${href}">`, '    <picture>',
          `      <source media="(prefers-color-scheme: dark)" srcset="assets/profile/repositories/repo-${offset + 1}-dark.svg" />`,
          `      <img src="assets/profile/repositories/repo-${offset + 1}-light.svg" alt="${escapeXml(repo.full_name)}: ${escapeXml(repo.description || 'View repository')}" width="49%" />`,
          '    </picture>', '  </a>');
      }
      lines.push('</p>', '');
    }
  }
  lines.push(END);
  return lines.join(newline);
}

function replaceSection(readme, repositories) {
  const start = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (start < 0 || end < start || readme.indexOf(BEGIN, start + BEGIN.length) >= 0 || readme.indexOf(END, end + END.length) >= 0) {
    throw new Error('README must contain exactly one featured-repositories BEGIN/END section');
  }
  return readme.slice(0, start) + renderSection(repositories, readme.includes('\r\n') ? '\r\n' : '\n') + readme.slice(end + END.length);
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const username = process.env.PROFILE_USERNAME || 'ShadowsLunarfox';
  const config = validateConfig(JSON.parse(await fs.readFile(path.join(root, '.github/featured-repositories.json'), 'utf8')));
  const readmePath = path.join(root, 'README.md');
  const readme = await fs.readFile(readmePath, 'utf8');
  const repositories = config.count ? await fetchRepositories(username, process.env.GITHUB_TOKEN) : [];
  const selected = selectRepositories(repositories, config);
  const updatedReadme = replaceSection(readme, selected);
  const output = path.join(root, 'assets/profile/repositories');
  const cards = selected.flatMap((repo, index) => ['dark', 'light'].map(theme => ({ name: `repo-${index + 1}-${theme}.svg`, svg: renderCard(repo, theme) })));
  await fs.mkdir(output, { recursive: true });
  for (const card of cards) await fs.writeFile(path.join(output, card.name), card.svg);
  await fs.writeFile(readmePath, updatedReadme);
  const current = new Set(cards.map(card => card.name));
  for (const file of await fs.readdir(output)) {
    if (/^repo-\d+-(dark|light)\.svg$/.test(file) && !current.has(file)) {
      const target = path.resolve(output, file);
      if (path.dirname(target) !== path.resolve(output)) throw new Error('Generated card path escaped the output directory');
      await fs.unlink(target);
    }
  }
  console.log(`Displayed ${selected.length}/${config.count} repositories: ${selected.map(repo => repo.name).join(', ') || '(hidden)'}`);
}

module.exports = { validateConfig, selectRepositories, fetchRepositories, renderCard, renderSection, replaceSection, wrapDescription };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
