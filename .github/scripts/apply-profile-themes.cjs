const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { imageInfo } = require('./generate-dev-meme.cjs');

const DARK = {
  ffaec5: '482e40', b9edf2: '25434c', bbe8f2: '25434c', bce6f4: '263e51',
  d7c4f3: '393149', d3bcf5: '393149', ffd3b0: '49392f', ffc6a6: '49362f',
  ffdab9: '49392f', ffe9a3: '493f2a', ffd166: '493c23', '615276': '302a3d',
  '3b2d4f': 'f1eaf7', '333': 'f1eaf7',
};
const IMAGE_ROOT = 'assets/profile/themed-images';
const BADGE_HOSTS = new Set(['developers.google.com', 'learn.microsoft.com']);
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

function darkImageUrl(source) {
  const url = new URL(source);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Unexpected image service URL');
  if (url.hostname === 'img.shields.io') {
    const tint = url.searchParams.get('color') || url.pathname.match(/-([a-f0-9]{6})$/i)?.[1];
    url.pathname = url.pathname.replace(/-([a-f0-9]{6})$/i, (all, color) => `-${DARK[color.toLowerCase()] || color}`);
    for (const key of ['color', 'labelColor']) {
      const value = url.searchParams.get(key);
      if (value && DARK[value.toLowerCase()]) url.searchParams.set(key, DARK[value.toLowerCase()]);
    }
    if (url.searchParams.has('logoColor')) url.searchParams.set('logoColor', tint || 'd7c4f3');
  } else if (url.hostname === 'komarev.com') {
    url.searchParams.set('color', DARK[(url.searchParams.get('color') || '').toLowerCase()] || '482e40');
  } else if (url.hostname === 'capsule-render.vercel.app') {
    const palette = url.searchParams.get('color');
    if (palette) url.searchParams.set('color', palette.replace(/\b[a-f0-9]{6}\b/gi, color => DARK[color.toLowerCase()] || color));
  } else {
    throw new Error('Unsupported image service');
  }
  return url.href;
}

function darkSvg(svg) {
  return svg.replace(/#([a-f0-9]{6}|[a-f0-9]{3})\b/gi, (value, color) => DARK[color.toLowerCase()] ? `#${DARK[color.toLowerCase()]}` : value);
}

function frameImage(bytes, mime, { width, height, label, dark = false, badge = false }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error('Invalid themed image dimensions');
  const padding = badge ? 2 : Math.min(8, Math.max(2, width / 28));
  const background = dark ? '#22272e' : '#ffffff';
  const border = dark ? '#51445e' : '#e6dce9';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)}">
  <title>${escape(label)}</title>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${badge ? 6 : 8}" fill="${background}" stroke="${border}" />
  <image x="${padding}" y="${padding}" width="${width - padding * 2}" height="${height - padding * 2}" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${bytes.toString('base64')}" />
</svg>\n`;
}

async function writeChanged(file, text) {
  let previous;
  try { previous = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous !== text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
}

function localAsset(root, source) {
  const allowed = path.resolve(root, 'assets/profile') + path.sep;
  const file = path.resolve(root, source.split('?')[0]);
  if (!file.startsWith(allowed)) throw new Error('Image path is outside assets/profile');
  return file;
}

async function fetchBadge(source, request) {
  let url = new URL(source);
  for (let redirect = 0; redirect < 4; redirect++) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !BADGE_HOSTS.has(url.hostname)) throw new Error('Unexpected learning badge host');
    const response = await request(url.href, { signal: AbortSignal.timeout(20000), redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    if (!response.ok || !/^image\/svg\+xml(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Learning badge image is unavailable');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 1024 * 1024 || !/<svg\b/.test(bytes.toString('utf8'))) throw new Error('Invalid learning badge SVG');
    return bytes;
  }
  throw new Error('Too many learning badge redirects');
}

async function themeReadme(readme, { root, request = fetch } = {}) {
  const existingPictures = [];
  // Rebuild our pictures from their original source; preserve existing hand-authored
  // pictures, including all desktop/mobile and light/dark statistics variants.
  let working = readme.replace(/<picture\b([^>]*)>([\s\S]*?)<\/picture>/gi, (whole, attributes, body) => {
    const original = attr(attributes, 'data-profile-source');
    if (original) return body.match(/<img\b[^>]*>/i)[0].replace(/\bsrc="[^"]*"/, `src="${original}"`);
    const placeholder = `\u0000PROFILE_PICTURE_${existingPictures.length}\u0000`;
    existingPictures.push(whole);
    return placeholder;
  });
  const matches = [...working.matchAll(/<img\b[^>]*>/gi)];
  const rendered = new Map();
  const snapshots = new Map();
  const newline = readme.includes('\r\n') ? '\r\n' : '\n';
  for (const [tag] of matches) {
    if (rendered.has(tag)) continue;
    const sourceAttribute = attr(tag, 'src');
    if (!sourceAttribute) throw new Error('Profile image is missing its source');
    const source = decode(sourceAttribute);
    const label = decode(attr(tag, 'alt') || 'Profile image');
    let lightSource = source, darkSource;
    if (/^https:\/\/(img\.shields\.io|komarev\.com|capsule-render\.vercel\.app)\//i.test(source)) {
      darkSource = darkImageUrl(source);
    } else if (/^assets\/profile\/[^?]+\.svg(?:\?|$)/i.test(source)) {
      const file = localAsset(root, source);
      const svg = await fs.readFile(file, 'utf8');
      const variant = darkSvg(svg);
      const name = `${path.basename(file, '.svg')}-dark.svg`;
      await writeChanged(path.join(root, IMAGE_ROOT, name), variant);
      lightSource = `${source.split('?')[0]}?v=${hash(svg)}`;
      darkSource = `${IMAGE_ROOT}/${name}?v=${hash(variant)}`;
    } else {
      const badge = /^https:/i.test(source);
      if (badge && !BADGE_HOSTS.has(new URL(source).hostname)) throw new Error(`Unsupported profile image: ${source}`);
      const id = hash(JSON.stringify([source, attr(tag, 'width'), attr(tag, 'height'), label]));
      let bytes, mime, info;
      if (badge) {
        mime = 'image/svg+xml';
        const cached = path.join(root, IMAGE_ROOT, `image-${id}-light.svg`);
        if (!snapshots.has(source)) {
          let old;
          try { old = await fs.readFile(cached, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          const embedded = old?.match(/href="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/);
          snapshots.set(source, embedded ? Buffer.from(embedded[1], 'base64') : await fetchBadge(source, request));
        }
        bytes = snapshots.get(source);
        info = { width: Number(attr(tag, 'width')), height: Number(attr(tag, 'height')) };
      } else {
        bytes = await fs.readFile(localAsset(root, source));
        info = imageInfo(bytes);
        mime = `image/${info.extension === 'jpg' ? 'jpeg' : info.extension}`;
      }
      const width = Number(attr(tag, 'width')) || info.width;
      const height = Number(attr(tag, 'height')) || Math.round(width * info.height / info.width);
      const sources = {};
      for (const theme of ['light', 'dark']) {
        const svg = frameImage(bytes, mime, { width, height, label, badge, dark: theme === 'dark' });
        const name = `image-${id}-${theme}.svg`;
        await writeChanged(path.join(root, IMAGE_ROOT, name), svg);
        sources[theme] = `${IMAGE_ROOT}/${name}?v=${hash(svg)}`;
      }
      lightSource = sources.light;
      darkSource = sources.dark;
    }
    const fallback = tag.replace(/\bsrc="[^"]*"/, `src="${escape(lightSource)}"`);
    rendered.set(tag, [`<picture data-profile-source="${escape(source)}">`,
      `  <source media="(prefers-color-scheme: dark)" srcset="${escape(darkSource)}" />`,
      `  ${fallback}`, '</picture>'].join(newline));
  }
  working = working.replace(/<img\b[^>]*>/gi, tag => rendered.get(tag));
  return working.replace(/\u0000PROFILE_PICTURE_(\d+)\u0000/g, (_, index) => existingPictures[Number(index)]);
}

async function applyProfileThemes({ root = path.resolve(__dirname, '../..'), request = fetch } = {}) {
  const file = path.join(root, 'README.md');
  const before = await fs.readFile(file, 'utf8');
  const after = await themeReadme(before, { root, request });
  if (after !== before) await fs.writeFile(file, after);
  const used = new Set([...after.matchAll(/assets\/profile\/themed-images\/([A-Za-z0-9_-]+\.svg)/g)].map(match => match[1]));
  let generated = [];
  try { generated = await fs.readdir(path.join(root, IMAGE_ROOT)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // This directory is reserved for generated variants. Delete only our SVG names,
  // after the README points at the new snapshots, so daily memes cannot accumulate.
  for (const name of generated) if (/^(?:image-[a-f0-9]{12}-(?:light|dark)|[A-Za-z0-9_-]+-dark)\.svg$/.test(name) && !used.has(name)) {
    await fs.unlink(path.join(root, IMAGE_ROOT, name));
  }
  return after;
}

module.exports = { darkImageUrl, darkSvg, frameImage, themeReadme, applyProfileThemes };
if (require.main === module) applyProfileThemes()
  .then(() => console.log('All profile images select light/dark variants; existing mobile layouts are preserved.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
