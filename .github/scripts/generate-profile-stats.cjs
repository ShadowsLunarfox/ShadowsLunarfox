const fs = require('node:fs/promises');
const path = require('node:path');
const { parseOverview, parseLanguages, validateStreak, renderDashboard } = require('./profile-stat-cards.cjs');

async function fetchProfileStats(username, request = fetch) {
  const overviewUrl = new URL('https://github-readme-stats.shion.dev/api');
  overviewUrl.search = new URLSearchParams({ username, include_all_commits: 'false', count_private: 'false', number_format: 'long', disable_animations: 'true' }).toString();
  const streakUrl = new URL('https://streak-stats.demolab.com/');
  streakUrl.search = new URLSearchParams({ user: username, type: 'json', mode: 'daily', timezone: 'Asia/Kuala_Lumpur' }).toString();
  const languagesUrl = new URL('https://github-readme-stats.shion.dev/api/top-langs/');
  languagesUrl.search = new URLSearchParams({ username, layout: 'compact', disable_animations: 'true' }).toString();
  const responses = await Promise.all([overviewUrl, streakUrl, languagesUrl].map(async url => {
    let response;
    try {
      response = await request(url, { signal: AbortSignal.timeout(30000) });
    } catch (error) {
      throw new Error(`Could not reach ${url.hostname}: ${error.cause?.code || error.message}`, { cause: error });
    }
    if (!response.ok) throw new Error(`Profile statistics are unavailable (${url.hostname}, HTTP ${response.status})`);
    return response.text();
  }));
  return { overview: parseOverview(responses[0]), streak: validateStreak(JSON.parse(responses[1])), languages: parseLanguages(responses[2]) };
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const data = process.argv.includes('--from-snapshot')
    ? JSON.parse(await fs.readFile(path.join(root, 'assets/profile/statistics.json'), 'utf8'))
    : await fetchProfileStats(process.env.PROFILE_USERNAME || 'ShadowsLunarfox');
  // Finish fetching, validating and rendering both themes before updating snapshots.
  const cards = ['dark', 'light'].map(theme => ({
    file: path.join(root, `assets/profile/stats-dashboard-${theme}.svg`), svg: renderDashboard(data, theme),
  }));
  for (const card of cards) await fs.writeFile(card.file, card.svg);
  await fs.writeFile(path.join(root, 'assets/profile/statistics.json'), JSON.stringify(data, null, 2) + '\n');
  console.log('Generated the animated GitHub statistics dashboard in light and dark themes.');
}

module.exports = { fetchProfileStats };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
