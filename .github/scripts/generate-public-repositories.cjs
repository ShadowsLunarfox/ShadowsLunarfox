const fs = require('node:fs/promises');
const path = require('node:path');
const { PROFILE_FONT, applyProfileFont } = require('./profile-font.cjs');

function validateCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('GitHub did not return a valid public repository count');
  return value;
}

function renderPublicRepositoriesBadge(repositories) {
  const label = validateCount(repositories).toLocaleString('en-US');
  const labelWidth = 80;
  const countWidth = Math.max(28, label.length * 7 + 14);
  const width = labelWidth + countWidth;
  return applyProfileFont(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20" role="img" aria-label="GitHub public repositories: ${label}">
  <title>GitHub public repositories: ${label}</title>
  <clipPath id="badge"><rect width="${width}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#badge)">
    <rect width="${labelWidth}" height="20" fill="#615276"/>
    <rect x="${labelWidth}" width="${countWidth}" height="20" fill="#ffd3b0"/>
  </g>
  <g font-family="${PROFILE_FONT}" font-size="11" text-anchor="middle">
    <text x="${labelWidth / 2}" y="14" fill="#ffffff">Public repos</text>
    <text x="${labelWidth + countWidth / 2}" y="14" fill="#3b2d4f">${label}</text>
  </g>
</svg>
`);
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
