const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const source = path.resolve(process.argv[2] || 'vendor/activity-graph');
  const output = path.resolve(process.argv[3] || 'assets/profile/activity.svg');
  const { Card } = require(path.join(source, 'dist/GraphCards.js'));
  const { Fetcher } = require(path.join(source, 'dist/fetcher.js'));
  const username = process.env.PROFILE_USERNAME || 'ShadowsLunarfox';
  const data = await new Fetcher(username).fetchContributions(31);

  if (typeof data === 'string' || !Array.isArray(data?.contributions)) {
    throw new Error(typeof data === 'string' ? data : 'Contribution data is unavailable');
  }

  const themes = [
    { output, color: 'adbac7', titleColor: 'ffaec5' },
    { output: output.replace(/\.svg$/i, '-light.svg'), color: '615276', titleColor: '615276' },
  ];
  for (const theme of themes) {
    const card = new Card(300, 1000, 0, {
      bgColor: '00000000',
      borderColor: '00000000',
      color: theme.color,
      titleColor: theme.titleColor,
      lineColor: 'ffaec5',
      pointColor: 'b9edf2',
      areaColor: 'd7c4f3',
    }, 'Activity over the last 31 days', true);
    const svg = await card.buildGraph(data.contributions);
    if (!svg.includes('<svg')) throw new Error('The activity renderer did not produce an SVG');
    await fs.mkdir(path.dirname(theme.output), { recursive: true });
    await fs.writeFile(theme.output, svg);
    console.log(`Generated ${theme.output} for ${username}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
