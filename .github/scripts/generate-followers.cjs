const fs = require('node:fs/promises');
const path = require('node:path');
const { PROFILE_FONT, applyProfileFont } = require('./profile-font.cjs');

function validateFollowers(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('GitHub did not return a valid follower count');
  return value;
}

async function fetchFollowers(username, request = fetch, token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'lunarfox-profile-badges' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await request(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub follower count is unavailable (HTTP ${response.status})`);
  const profile = await response.json();
  return validateFollowers(profile.followers);
}

function renderFollowersBadge(followers) {
  const label = validateFollowers(followers).toLocaleString('en-US');
  const labelWidth = 68;
  const countWidth = Math.max(28, label.length * 7 + 14);
  const width = labelWidth + countWidth;
  return applyProfileFont(`<svg font-family="${PROFILE_FONT}" xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20" role="img" aria-label="GitHub followers: ${label}">
  <title>GitHub followers: ${label}</title>
  <clipPath id="badge"><rect width="${width}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#badge)">
    <rect width="${labelWidth}" height="20" fill="#615276"/>
    <rect x="${labelWidth}" width="${countWidth}" height="20" fill="#d7c4f3"/>
  </g>
  <g font-family="${PROFILE_FONT}" font-size="11" text-anchor="middle">
    <text x="${labelWidth / 2}" y="14" fill="#ffffff">Followers</text>
    <text x="${labelWidth + countWidth / 2}" y="14" fill="#3b2d4f">${label}</text>
  </g>
</svg>
`);
}

async function refreshFollowers({ username, token, request = fetch, outputPath = path.resolve(__dirname, '../../assets/profile/followers.svg') }) {
  // Fetch and validate first so an outage leaves the last working badge intact.
  const followers = await fetchFollowers(username, request, token);
  const svg = renderFollowersBadge(followers);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, svg);
  return followers;
}

module.exports = { fetchFollowers, renderFollowersBadge, refreshFollowers };
if (require.main === module) {
  refreshFollowers({ username: process.env.PROFILE_USERNAME || 'ShadowsLunarfox', token: process.env.GITHUB_TOKEN })
    .then(followers => console.log(`Updated the local followers badge: ${followers}.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
