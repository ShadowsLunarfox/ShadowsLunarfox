const fs = require('node:fs/promises');
const { applyProfilePalette } = require('./apply-profile-palette.cjs');

async function main() {
  const username = process.env.PROFILE_USERNAME || 'ShadowsLunarfox';
  const cards = await Promise.all(['dark', 'light'].map(async theme => {
    const url = new URL('https://github-readme-stats.shion.dev/api/top-langs/');
    url.search = new URLSearchParams({
      username, theme: 'transparent', bg_color: '00000000', hide_border: 'true',
      title_color: theme === 'dark' ? 'b9edf2' : '615276',
      text_color: theme === 'dark' ? 'adbac7' : '3b2d4f',
      include_all_commits: 'false', count_private: 'false', layout: 'compact', card_width: '495',
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const svg = await response.text();
    if (!response.ok || !svg.includes('<svg') || !svg.includes('data-testid="lang-name"')) {
      throw new Error(`Language statistics are unavailable (${response.status}, ${theme})`);
    }
    return { file: `assets/profile/languages-${theme}.svg`, svg: applyProfilePalette(svg) };
  }));
  await fs.mkdir('assets/profile', { recursive: true });
  for (const card of cards) {
    await fs.writeFile(card.file, card.svg);
    console.log(`Generated ${card.file} for ${username}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
