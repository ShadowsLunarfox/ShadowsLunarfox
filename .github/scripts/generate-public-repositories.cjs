const fs = require('node:fs/promises');
const path = require('node:path');

function validateCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('GitHub did not return a valid public repository count');
  return value;
}

function renderPublicRepositoriesBadge(repositories) {
  const label = validateCount(repositories).toLocaleString('en-US');
  // Match the typography and spacing of the adjacent Shields for-the-badge image.
  const labelWidth = 113;
  const countTextWidth = [...label].reduce((width, character) => width + (character === ',' ? 5 : 8.25), 0);
  const countWidth = countTextWidth + 24;
  const width = labelWidth + countWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28" role="img" aria-label="GitHub public repositories: ${label}">
  <title>GitHub public repositories: ${label}</title>
  <g shape-rendering="crispEdges">
    <rect width="${labelWidth}" height="28" fill="#615276"/>
    <rect x="${labelWidth}" width="${countWidth}" height="28" fill="#ffd3b0"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="100">
    <text transform="scale(.1)" x="${labelWidth * 5}" y="175" textLength="890">PUBLIC REPOS</text>
    <text transform="scale(.1)" x="${(labelWidth + countWidth / 2) * 10}" y="175" textLength="${countTextWidth * 10}" font-weight="bold" fill="#333">${label}</text>
  </g>
</svg>
`;
}

async function refreshPublicRepositories({ username, token, request = fetch, outputPath = path.resolve(__dirname, '../../assets/profile/public-repositories.svg') }) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'lunarfox-profile-badges' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await request(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub public repository count is unavailable (HTTP ${response.status})`);
  const profile = await response.json();
  const count = validateCount(profile.public_repos);
  const svg = renderPublicRepositoriesBadge(count);
  // An unavailable or invalid response leaves the previous badge intact.
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, svg);
  return count;
}

module.exports = { renderPublicRepositoriesBadge, refreshPublicRepositories };
if (require.main === module) {
  refreshPublicRepositories({ username: process.env.PROFILE_USERNAME || 'ShadowsLunarfox', token: process.env.GITHUB_TOKEN })
    .then(count => console.log(`Updated the public repositories badge: ${count}.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
