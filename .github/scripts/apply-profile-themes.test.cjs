const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { darkImageUrl, frameImage, applyProfileThemes } = require('./apply-profile-themes.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6QAAAAABJRU5ErkJggg==', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const badge = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path fill="#ff0000" d="M0 0h40v40H0z"/></svg>';
const originalPicture = '<picture>\r\n<source media="(max-width:600px) and (prefers-color-scheme:dark)" srcset="stats-dark-mobile.svg" />\r\n<source media="(prefers-color-scheme:dark)" srcset="stats-dark.svg" />\r\n<img src="stats-light.svg" alt="Existing responsive stats" />\r\n</picture>';

async function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'lunarfox-image-themes-'));
  await fs.mkdir(path.join(root, 'assets/profile'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/profile/header.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ffaec5"/><text fill="#3b2d4f">Header</text></svg>');
  await fs.writeFile(path.join(root, 'assets/profile/photo.png'), png);
  await fs.writeFile(path.join(root, 'assets/profile/meme.gif'), gif);
  const readme = ['Before', originalPicture,
    '<img src="assets/profile/header.svg" alt="Header" width="100%" />',
    '<a href="https://example.com"><img src="https://img.shields.io/badge/Python-ffe9a3?logo=python&amp;logoColor=3b2d4f" alt="Python" width="94" height="28" /></a>',
    '<img src="assets/profile/photo.png" alt="Photo" width="112" height="112" />',
    '<a href="https://example.com/source"><img src="assets/profile/meme.gif?v=original" alt="Animated meme" width="100" /></a>',
    '<img src="https://learn.microsoft.com/training/achievements/generic.svg" alt="First achievement" width="40" height="40" />',
    '<img src="https://learn.microsoft.com/training/achievements/generic.svg" alt="Second achievement" width="40" height="40" />',
    'After'].join('\r\n');
  await fs.writeFile(path.join(root, 'README.md'), readme);
  t.after(async () => {
    if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith('lunarfox-image-themes-')) throw new Error('Refusing cleanup outside the test directory');
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, readme };
}

test('service URLs retain their content and use contrasting dark backgrounds and logo colors', () => {
  const dark = new URL(darkImageUrl('https://img.shields.io/badge/C%23-d7c4f3?style=flat-square&logo=unity&logoColor=3b2d4f'));
  assert.equal(dark.pathname, '/badge/C%23-393149');
  assert.equal(dark.searchParams.get('style'), 'flat-square');
  assert.equal(dark.searchParams.get('logoColor'), 'd7c4f3');
  const stars = new URL(darkImageUrl('https://img.shields.io/github/stars/name?color=b9edf2&labelColor=615276'));
  assert.equal(stars.searchParams.get('color'), '25434c');
  assert.equal(stars.searchParams.get('labelColor'), '302a3d');
  assert.equal(new URL(darkImageUrl('https://komarev.com/ghpvc/?username=name&color=ffaec5')).searchParams.get('username'), 'name');
  assert.match(new URL(darkImageUrl('https://capsule-render.vercel.app/api?color=0:b9edf2,100:ffaec5')).searchParams.get('color'), /0:25434c,100:482e40/);
  assert.throws(() => darkImageUrl('https://localhost/image'), /Unsupported/);
  assert.throws(() => darkImageUrl('http://img.shields.io/badge/test'), /Unexpected/);
});

test('raster and animated image bytes remain intact inside the light and dark frames', () => {
  for (const [bytes, mime] of [[png, 'image/png'], [gif, 'image/gif']]) {
    const light = frameImage(bytes, mime, { width: 100, height: 100, label: 'Photo <&>' });
    const dark = frameImage(bytes, mime, { width: 100, height: 100, label: 'Photo <&>', dark: true });
    assert.notEqual(dark, light);
    assert.match(light, /Photo &lt;&amp;&gt;/);
    for (const svg of [light, dark]) {
      const data = svg.match(/base64,([A-Za-z0-9+/=]+)"/)[1];
      assert.ok(Buffer.from(data, 'base64').equals(bytes));
      assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
    }
  }
});

test('all remaining images get theme variants, existing mobile pictures survive, and reruns reuse cached badges', async t => {
  const { root } = await fixture(t);
  let calls = 0;
  const request = async url => {
    calls++;
    if (url === 'https://learn.microsoft.com/training/achievements/generic.svg') return new Response('', { status: 302, headers: { location: '/en-us/training/achievements/generic.svg' } });
    return new Response(badge, { headers: { 'content-type': 'image/svg+xml' } });
  };
  const result = await applyProfileThemes({ root, request });
  assert.equal(calls, 2);
  assert.ok(result.includes(originalPicture));
  assert.ok(result.startsWith('Before\r\n') && result.endsWith('\r\nAfter'));
  assert.doesNotMatch(result, /(?<!\r)\n/);
  assert.equal((result.match(/data-profile-source=/g) || []).length, 6);
  assert.ok(result.includes('href="https://example.com/source"'));
  assert.ok(result.includes('alt="First achievement" width="40" height="40"'));
  const files = await fs.readdir(path.join(root, 'assets/profile/themed-images'));
  assert.equal(files.length, 9); // header plus four independent pairs of framed images
  const header = await fs.readFile(path.join(root, 'assets/profile/themed-images/header-dark.svg'), 'utf8');
  assert.match(header, /#482e40/);
  assert.match(header, /#f1eaf7/);
  assert.equal(await applyProfileThemes({ root, request: async () => { throw new Error('No refetch expected'); } }), result);
});

test('new daily images update both variants and remove obsolete generated frames', async t => {
  const { root } = await fixture(t);
  const request = async () => new Response(badge, { headers: { 'content-type': 'image/svg+xml' } });
  const before = await applyProfileThemes({ root, request });
  const directory = path.join(root, 'assets/profile/themed-images');
  const oldNames = await fs.readdir(directory);
  const changed = Buffer.from(gif);
  changed[13] = 123; // Change one GIF palette color without changing its animation format.
  await fs.writeFile(path.join(root, 'assets/profile/meme.gif'), changed);
  await fs.writeFile(path.join(root, 'README.md'), before.replaceAll('meme.gif?v=original', 'meme.gif?v=next-day'));
  const after = await applyProfileThemes({ root, request: async () => { throw new Error('Cached badges should avoid network'); } });
  assert.notEqual(after, before);
  const newNames = await fs.readdir(directory);
  assert.equal(newNames.length, oldNames.length);
  assert.equal(oldNames.filter(name => !newNames.includes(name)).length, 2);
  for (const match of after.matchAll(/src(?:set)?="(assets\/profile\/themed-images\/[^?"]+)/g)) {
    await fs.access(path.join(root, match[1]));
  }
});

test('untrusted paths and redirects cannot become embedded snapshots or rewrite the README', async t => {
  const { root, readme } = await fixture(t);
  await fs.writeFile(path.join(root, 'README.md'), '<img src="assets/profile/../../outside.png" alt="invalid" />');
  await assert.rejects(applyProfileThemes({ root }), /outside assets\/profile/);
  await fs.writeFile(path.join(root, 'README.md'), readme);
  await assert.rejects(applyProfileThemes({ root, request: async () => new Response('', { status: 302, headers: { location: 'https://localhost/image.svg' } }) }), /Unexpected learning badge host/);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), readme);
});
