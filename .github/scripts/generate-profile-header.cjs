const fs = require('node:fs/promises');
const path = require('node:path');
const { applyProfileFont } = require('./profile-font.cjs');

async function main() {
  const url = new URL('https://capsule-render.vercel.app/api');
  url.search = new URLSearchParams({
    type: 'waving', height: '180', color: '0:ffaec5,35:d7c4f3,70:ffe9a3,100:b9edf2',
    text: 'Shadows_Lunarfox 月狐', fontAlign: '50', fontAlignY: '38',
    fontColor: '3b2d4f', fontSize: '48', fontFamily: 'Comic Neue', animation: 'twinkling',
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Profile header service is unavailable (HTTP ${response.status})`);
  const svg = await response.text();
  if (!svg.includes('<svg') || !svg.includes('Shadows_Lunarfox')) throw new Error('The header service returned an invalid image');
  await fs.writeFile(path.resolve(__dirname, '../../assets/profile/header.svg'), applyProfileFont(svg));
  console.log('Generated the animated profile header with embedded Comic Neue.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
