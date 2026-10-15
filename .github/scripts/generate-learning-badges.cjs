const fs = require('node:fs/promises');
const path = require('node:path');

const BEGIN = '<!-- BEGIN learning-badges -->';
const END = '<!-- END learning-badges -->';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Learning profile is unavailable (${response.status})`);
  return response.json();
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const config = JSON.parse(await fs.readFile(path.join(root, '.github/learning-profiles.json'), 'utf8'));
  if (!/^[a-z0-9-]+$/i.test(config.microsoft) || !/^https:\/\/g\.dev\/[a-z0-9_-]+$/i.test(config.google)) throw new Error('Invalid public learning profile configuration');
  const googleBadges = config.googleBadges || [];
  if (!Array.isArray(googleBadges)) throw new Error('Google badges must be a list');
  const googleUsername = new URL(config.google).pathname.slice(1);
  for (const badge of googleBadges) {
    const url = new URL(badge.url), image = new URL(badge.image);
    if (!badge.title || typeof badge.title !== 'string'
      || url.origin !== 'https://developers.google.com' || !url.pathname.startsWith('/profile/badges/')
      || url.searchParams.get('u') !== googleUsername
      || image.origin !== 'https://developers.google.com' || !image.pathname.startsWith('/static/profile/badges/') || !image.pathname.endsWith('.svg')) {
      throw new Error('Invalid Google badge or badge owner');
    }
  }
  const profile = await getJson(`https://learn.microsoft.com/api/profiles/${encodeURIComponent(config.microsoft)}`);
  if (profile.isPrivate !== false || !/^[a-f0-9-]{36}$/i.test(profile.userId || '')) throw new Error('Microsoft Learn profile is not publicly accessible');
  const data = await getJson(`https://learn.microsoft.com/api/achievements/user/${profile.userId}?locale=en-us`);
  if (!Array.isArray(data.achievements) || data.achievements.length !== data.totalCount) throw new Error('Microsoft Learn returned an incomplete achievement list');
  const awards = data.achievements.filter(award => award.verified === true && ['modules', 'learningpaths'].includes(award.category));
  const microsoftUrl = `https://learn.microsoft.com/en-us/users/${config.microsoft}/achievements`;
  const badges = awards.filter(award => award.category === 'modules').length;
  const trophies = awards.filter(award => award.category === 'learningpaths').length;
  const lines = [BEGIN, '<h2 align="center">🏅 <samp>Learning &amp; Badges (｡･ω･｡)ﾉ</samp></h2>', '', '<p align="center">',
    `  <a href="${escape(config.google)}"><img src="https://img.shields.io/badge/Google_Developer_Program-lunarfox-ffaec5?style=flat&amp;logo=google&amp;logoColor=ffffff&amp;labelColor=615276" alt="Google Developer Program: my public profile" /></a>`,
    `  <a href="${microsoftUrl}"><img src="https://img.shields.io/badge/Microsoft_Learn-Achievements-d7c4f3?style=flat&amp;labelColor=615276" alt="Microsoft Learn: my official achievements" /></a>`,
    '</p>', ''];
  if (googleBadges.length) {
    lines.push('<h3 align="center">Google Developer Program</h3>', '', '<table align="center" width="100%">');
    for (let index = 0; index < googleBadges.length; index += 2) {
      lines.push('  <tr>');
      for (const badge of googleBadges.slice(index, index + 2)) {
        lines.push('    <td align="center" valign="top" width="50%">', `      <a href="${escape(badge.url)}">`,
          `        <img src="${escape(badge.image)}" alt="${escape(badge.title)} — Google Developer Program badge" width="96" height="96" />`,
          `        <br /><strong>${escape(badge.title)}</strong>`, '      </a>', '    </td>');
      }
      lines.push('  </tr>');
    }
    lines.push('</table>', '');
  }
  lines.push(`<h3 align="center">Microsoft Learn · ${badges} module badges · ${trophies} learning path trophies</h3>`, '');
  if (awards.length) {
    lines.push('<table align="center" width="100%">');
    for (let index = 0; index < awards.length; index += 3) {
      lines.push('  <tr>');
      for (const award of awards.slice(index, index + 3)) {
        const image = new URL(award.imageUrl, 'https://learn.microsoft.com');
        if (image.origin !== 'https://learn.microsoft.com' || !/\.svg$/i.test(image.pathname)) throw new Error('Unexpected Microsoft Learn badge image');
        if (typeof award.title !== 'string' || !Number.isFinite(Date.parse(award.grantedOn))) throw new Error('Invalid achievement details');
        const earned = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(award.grantedOn));
        const kind = award.category === 'modules' ? 'Module badge' : 'Learning path trophy';
        lines.push('    <td align="center" valign="top" width="33%">', `      <a href="${microsoftUrl}">`,
          `        <img src="${escape(image.href)}" alt="${escape(award.title)} — ${kind}" width="80" height="80" />`,
          `        <br /><strong>${escape(award.title)}</strong>`, '      </a>', `      <br /><sub>${kind} · ${earned}</sub>`, '    </td>');
      }
      lines.push('  </tr>');
    }
    lines.push('</table>', '');
  }
  lines.push('<p align="center"><sub>Issued by Microsoft Learn · Click a badge to view my official achievement profile.</sub></p>', END);
  const readmePath = path.join(root, 'README.md');
  const readme = await fs.readFile(readmePath, 'utf8');
  const newline = readme.includes('\r\n') ? '\r\n' : '\n';
  const section = lines.join(newline);
  const start = readme.indexOf(BEGIN), end = readme.indexOf(END);
  if (start < 0 || end < start || readme.indexOf(BEGIN, start + BEGIN.length) >= 0 || readme.indexOf(END, end + END.length) >= 0) throw new Error('README must contain one learning-badges section');
  await fs.writeFile(readmePath, readme.slice(0, start) + section + readme.slice(end + END.length));
  console.log(`Displayed ${googleBadges.length} configured Google badges, ${badges} verified Microsoft Learn badges and ${trophies} trophies.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
