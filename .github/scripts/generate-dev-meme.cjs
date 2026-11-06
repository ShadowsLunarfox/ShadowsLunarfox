const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const BEGIN = '<!-- BEGIN dev-meme -->';
const END = '<!-- END dev-meme -->';
const MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_HOSTS = new Set(['i.redd.it', 'preview.redd.it', 'i.imgur.com']);
const POST_HOSTS = new Set(['redd.it', 'reddit.com', 'www.reddit.com']);
const ASSETS = ['current.png', 'current.jpg', 'current.gif'];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function trustedUrl(value, hosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname)) throw new Error('Unexpected meme URL');
  return url.href;
}

function eligiblePost(post, subreddit) {
  try {
    if (post.nsfw !== false || post.spoiler !== false || post.subreddit?.toLowerCase() !== subreddit.toLowerCase()
      || typeof post.title !== 'string' || !post.title.trim() || /[\u3400-\u9fff]/.test(post.title)
      || typeof post.author !== 'string' || !/^[\w-]{1,40}$/.test(post.author)) return null;
    return {
      title: post.title.trim(), author: post.author, subreddit,
      postLink: trustedUrl(post.postLink, POST_HOSTS), imageUrl: trustedUrl(post.url, IMAGE_HOSTS),
    };
  } catch { return null; }
}

function imageInfo(bytes) {
  let width, height, extension;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); extension = 'png';
  } else if (bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {
    width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8); extension = 'gif';
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error('Invalid JPEG marker');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) throw new Error('Invalid JPEG segment');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); extension = 'jpg'; break;
      }
      offset += size;
    }
  }
  if (!extension || !width || !height || width > 6000 || height > 6000) throw new Error('Meme is not a supported PNG, JPEG, or GIF image');
  return { width, height, extension };
}

async function downloadImage(url, request) {
  const response = await request(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`Meme image unavailable (HTTP ${response.status})`);
  if (!/^image\/(png|jpeg|gif)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Meme response is not an image');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Meme image is too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('Meme image is too large');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  return { bytes, ...imageInfo(bytes) };
}

function localDate(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function renderSection(meme, newline = '\n') {
  if (!ASSETS.includes(meme.asset) || !/^[a-f0-9]{64}$/.test(meme.sha256)) throw new Error('Invalid cached meme asset');
  const displayWidth = Math.max(1, Math.floor(Math.min(520, meme.width, 380 * meme.width / meme.height)));
  return [BEGIN, '<h2 align="center">🎭 <samp>Daily Dev Meme</samp></h2>', '',
    '<p align="center">',
    `  <a href="${escape(trustedUrl(meme.postLink, POST_HOSTS))}">`,
    `    <img src="assets/profile/dev-meme/${meme.asset}?v=${meme.sha256.slice(0, 12)}" alt="Programming meme: ${escape(meme.title)}" width="${displayWidth}" />`,
    '  </a>', '</p>', '<p align="center">',
    `  <sub><a href="${escape(meme.postLink)}">r/${escape(meme.subreddit)} · u/${escape(meme.author)}</a> · ${escape(meme.date)}</sub>`,
    '</p>', END].join(newline);
}

function replaceSection(readme, meme) {
  const start = readme.indexOf(BEGIN), end = readme.indexOf(END);
  if (start < 0 || end < start || readme.indexOf(BEGIN, start + BEGIN.length) >= 0 || readme.indexOf(END, end + END.length) >= 0) throw new Error('README must contain exactly one dev-meme section');
  return readme.slice(0, start) + renderSection(meme, readme.includes('\r\n') ? '\r\n' : '\n') + readme.slice(end + END.length);
}

async function refreshDevMeme({ root = path.resolve(__dirname, '../..'), now = new Date(), request = fetch, force = false } = {}) {
  const config = JSON.parse(await fs.readFile(path.join(root, '.github/dev-meme.json'), 'utf8'));
  if (!/^[a-z0-9_]{2,40}$/i.test(config.subreddit || '')) throw new Error('Invalid meme subreddit');
  const readmePath = path.join(root, 'README.md');
  const readme = await fs.readFile(readmePath, 'utf8');
  const output = path.join(root, 'assets/profile/dev-meme');
  const cachePath = path.join(output, 'current.json');
  const today = localDate(now);
  let previous;
  try { previous = JSON.parse(await fs.readFile(cachePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (!force && previous?.date === today && previous.subreddit === config.subreddit && ASSETS.includes(previous.asset)) {
    try {
      const cached = await fs.readFile(path.join(output, previous.asset));
      imageInfo(cached);
      if (createHash('sha256').update(cached).digest('hex') === previous.sha256) {
        const updated = replaceSection(readme, previous);
        if (updated !== readme) await fs.writeFile(readmePath, updated);
        return previous;
      }
    } catch (error) { if (error.code !== 'ENOENT' && !/supported|Invalid|Unexpected|section/.test(error.message)) throw error; }
  }
  // Validate markers before network requests or changing files.
  if (!readme.includes(BEGIN) || !readme.includes(END)) throw new Error('README is missing its dev-meme section');
  const response = await request(`https://meme-api.com/gimme/${encodeURIComponent(config.subreddit)}/10`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`Meme feed unavailable (HTTP ${response.status})`);
  const data = await response.json();
  if (!Array.isArray(data.memes)) throw new Error('Meme feed returned invalid data');
  const candidates = data.memes.map(post => eligiblePost(post, config.subreddit)).filter(post => post && post.postLink !== previous?.postLink).slice(0, 3);
  let selected;
  for (const candidate of candidates) {
    try { selected = { ...candidate, ...await downloadImage(candidate.imageUrl, request) }; break; }
    catch { /* Try the next eligible image without changing the existing snapshot. */ }
  }
  if (!selected) throw new Error('No usable new programming meme was available; the existing snapshot was preserved');
  const { bytes, extension, ...details } = selected;
  const meme = { ...details, date: today, asset: `current.${extension}`, sha256: createHash('sha256').update(bytes).digest('hex') };
  const updated = replaceSection(readme, meme);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, meme.asset), bytes);
  await fs.writeFile(cachePath, JSON.stringify(meme, null, 2) + '\n');
  await fs.writeFile(readmePath, updated);
  for (const asset of ASSETS) if (asset !== meme.asset) await fs.unlink(path.join(output, asset)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return meme;
}

module.exports = { eligiblePost, imageInfo, localDate, renderSection, replaceSection, refreshDevMeme };
if (require.main === module) refreshDevMeme({ force: process.argv.includes('--force') })
  .then(meme => console.log(`Developer meme ready for ${meme.date}: ${meme.postLink}`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
