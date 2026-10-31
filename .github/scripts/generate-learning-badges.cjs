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
  const microsoftBadges = awards.map(award => {
    const image = new URL(award.imageUrl, 'https://learn.microsoft.com');
    if (image.origin !== 'https://learn.microsoft.com' || !/\.svg$/i.test(image.pathname)) throw new Error('Unexpected Microsoft Learn badge image');
    if (typeof award.title !== 'string' || !Number.isFinite(Date.parse(award.grantedOn))) throw new Error('Invalid achievement details');
    const earned = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(award.grantedOn));
    const kind = award.category === 'modules' ? 'Module badge' : 'Learning path trophy';
    return { title: award.title, url: microsoftUrl, image: image.href, details: `${kind} · ${earned}` };
  });
  const groups = [
    { name: 'Google Developer Program', platform: 'Google', url: config.google, summary: `${googleBadges.length} badges`,
      entries: googleBadges.map(badge => ({ ...badge, details: 'Program badge' })) },
    { name: 'Microsoft Learn', platform: 'Microsoft', url: microsoftUrl, summary: `${badges} module badges · ${trophies} trophies`, entries: microsoftBadges },
  ];
  const lines = [BEGIN, '<h2 align="center">🏅 <samp>Learning &amp; Badges</samp></h2>', ''];
  for (const group of groups) {
    lines.push('<p align="center">',
      `  <a href="${escape(group.url)}"><strong>${escape(group.name)}</strong></a> <sub>· ${escape(group.summary)}</sub>`);
    if (group.entries.length) {
      lines.push('  <br />');
      for (const badge of group.entries) {
        const label = `${badge.title} — ${badge.details}`;
        lines.push(`  <a href="${escape(badge.url)}"><img src="${escape(badge.image)}" alt="${escape(label)}" title="${escape(label)}" width="40" height="40" /></a>`);
      }
    }
    lines.push('</p>', '');
  }
  const total = googleBadges.length + microsoftBadges.length;
  if (total) {
    lines.push('<details>', `<summary>Badge details · ${total} achievements</summary>`, '',
      '<table>', '  <tr><th>Platform</th><th>Achievement</th><th>Details</th></tr>');
    for (const group of groups) {
      for (const badge of group.entries) {
        lines.push(`  <tr><td>${group.platform}</td><td><a href="${escape(badge.url)}">${escape(badge.title)}</a></td><td><sub>${escape(badge.details)}</sub></td></tr>`);
      }
    }
    lines.push('</table>', '', '</details>', '');
  }
  lines.push(END);
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
