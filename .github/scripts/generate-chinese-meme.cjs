const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomInt } = require('node:crypto');
const { downloadImage, imageInfo, trustedUrl, localDate } = require('./generate-dev-meme.cjs');

const BEGIN = '<!-- BEGIN chinese-meme -->';
const END = '<!-- END chinese-meme -->';
const FEED = 'https://api.ruseo.cn/api/bqb?type=1&limit=20';
const SOURCE = 'https://api.ruseo.cn/api-doc/bqb';
const IMAGE_HOSTS = new Set(['res.apihz.cn']);
const ASSETS = ['chinese-current.png', 'chinese-current.jpg', 'chinese-current.gif'];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function imageUrl(value) {
  const url = new URL(trustedUrl(value, IMAGE_HOSTS));
  if (!/^\/img\/bqb\/[^/]+\.(png|jpe?g|gif)$/i.test(url.pathname)) throw new Error('Unexpected Chinese meme image path');
  return url.href;
}

function candidateUrls(data) {
  // The provider wraps the upstream response in {code: 0, data: {code: 200, res: [...]}}.
  const payload = data?.code === 0 ? data.data : data;
  if (payload?.code !== 200 || !Array.isArray(payload.res)) throw new Error('Chinese meme feed returned invalid data');
  return [...new Set(payload.res.flatMap(value => {
    try { return typeof value === 'string' ? [imageUrl(value)] : []; } catch { return []; }
  }))];
}

function sectionBounds(readme) {
  const start = readme.indexOf(BEGIN), end = readme.indexOf(END);
  if (start < 0 || end < start || readme.indexOf(BEGIN, start + BEGIN.length) >= 0 || readme.indexOf(END, end + END.length) >= 0) {
    throw new Error('README must contain exactly one chinese-meme section');
  }
  return { start, end };
}

function renderSection(meme, newline = '\n') {
  if (!ASSETS.includes(meme.asset) || !/^[a-f0-9]{64}$/.test(meme.sha256)
    || !Number.isInteger(meme.width) || !Number.isInteger(meme.height) || meme.width < 1 || meme.height < 1) {
    throw new Error('Invalid cached Chinese meme asset');
  }
  const displayWidth = Math.max(1, Math.floor(Math.min(520, meme.width, 380 * meme.width / meme.height)));
  return [BEGIN, '<h3 align="center">每日中文梗图</h3>', '',
    '<p align="center">',
    `  <a href="${escape(imageUrl(meme.imageUrl))}">`,
    `    <img src="assets/profile/dev-meme/${meme.asset}?v=${meme.sha256.slice(0, 12)}" alt="每日中文梗图（随机主题）" width="${displayWidth}" />`,
    '  </a>', '</p>', '<p align="center">',
    `  <sub><a href="${SOURCE}">中文表情包 · 澄曜API</a> · ${escape(meme.date)}</sub>`,
    '</p>', END].join(newline);
}

function replaceSection(readme, meme) {
  const { start, end } = sectionBounds(readme);
  return readme.slice(0, start) + renderSection(meme, readme.includes('\r\n') ? '\r\n' : '\n') + readme.slice(end + END.length);
}

async function refreshChineseMeme({ root = path.resolve(__dirname, '../..'), now = new Date(), request = fetch, force = false } = {}) {
  const readmePath = path.join(root, 'README.md');
  const readme = await fs.readFile(readmePath, 'utf8');
  sectionBounds(readme);
  const output = path.join(root, 'assets/profile/dev-meme');
  const cachePath = path.join(output, 'chinese-current.json');
  const today = localDate(now);
  let previous;
  try { previous = JSON.parse(await fs.readFile(cachePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }

  if (!force && previous?.date === today && ASSETS.includes(previous.asset)) {
    let cachedSection;
    try {
      const cached = await fs.readFile(path.join(output, previous.asset));
      const info = imageInfo(cached);
      if (info.width === previous.width && info.height === previous.height
        && createHash('sha256').update(cached).digest('hex') === previous.sha256) {
        cachedSection = replaceSection(readme, previous);
      }
    } catch (error) { if (error.code !== 'ENOENT' && !/supported|Invalid|Unexpected/.test(error.message)) throw error; }
    if (cachedSection !== undefined) {
      if (cachedSection !== readme) await fs.writeFile(readmePath, cachedSection);
      return previous;
    }
  }

  const response = await request(FEED, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`Chinese meme feed unavailable (HTTP ${response.status})`);
  const candidates = candidateUrls(await response.json()).filter(url => url !== previous?.imageUrl);
  let selected;
  for (let attempt = 0; attempt < 5 && candidates.length; attempt++) {
    const [url] = candidates.splice(randomInt(candidates.length), 1);
    try {
      const image = await downloadImage(url, request);
      const sha256 = createHash('sha256').update(image.bytes).digest('hex');
      if (sha256 !== previous?.sha256) { selected = { ...image, imageUrl: url, sha256 }; break; }
    } catch { /* Try another image while preserving the previous snapshot. */ }
  }
  if (!selected) throw new Error('No usable new Chinese meme was available; the existing snapshot was preserved');
  const { bytes, extension, ...details } = selected;
  const meme = { ...details, date: today, asset: `chinese-current.${extension}`, source: SOURCE };
  const updated = replaceSection(readme, meme);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, meme.asset), bytes);
  await fs.writeFile(cachePath, JSON.stringify(meme, null, 2) + '\n');
  await fs.writeFile(readmePath, updated);
  for (const asset of ASSETS) if (asset !== meme.asset) {
    await fs.unlink(path.join(output, asset)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return meme;
}

module.exports = { candidateUrls, renderSection, replaceSection, refreshChineseMeme };
if (require.main === module) refreshChineseMeme({ force: process.argv.includes('--force') })
  .then(meme => console.log(`Chinese meme ready for ${meme.date}: ${meme.imageUrl}`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
