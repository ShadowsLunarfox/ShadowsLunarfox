const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { eligiblePost, imageInfo, localDate, replaceSection, refreshDevMeme } = require('./generate-dev-meme.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6QAAAAABJRU5ErkJggg==', 'base64');
const post = { postLink: 'https://redd.it/abc123', subreddit: 'ProgrammerHumor', title: 'A developer joke', url: 'https://i.redd.it/example.png', nsfw: false, spoiler: false, author: 'ExampleAuthor' };
const chineseSection = '<!-- BEGIN chinese-meme -->\r\n<img src="assets/profile/dev-meme/chinese-current.png" alt="每日中文梗图" />\r\n<!-- END chinese-meme -->';
const readme = `Before\r\n<!-- BEGIN dev-meme -->\r\nold\r\n<!-- END dev-meme -->\r\n${chineseSection}\r\nAfter`;
const now = new Date('2026-11-06T04:00:00Z');
const request = async url => String(url).startsWith('https://meme-api.com/')
  ? new Response(JSON.stringify({ memes: [post] }), { headers: { 'content-type': 'application/json' } })
  : new Response(png, { headers: { 'content-type': 'image/png' } });

async function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'lunarfox-dev-meme-'));
  await fs.mkdir(path.join(root, '.github'));
  await fs.writeFile(path.join(root, '.github/dev-meme.json'), JSON.stringify({ subreddit: 'ProgrammerHumor' }));
  await fs.writeFile(path.join(root, 'README.md'), readme);
  t.after(async () => {
    if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith('lunarfox-dev-meme-')) throw new Error('Refusing cleanup outside the test directory');
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('only the selected community, unflagged posts, and trusted HTTPS image/source URLs are eligible', () => {
  assert.ok(eligiblePost(post, 'ProgrammerHumor'));
  for (const changes of [{ nsfw: true }, { nsfw: undefined }, { spoiler: true }, { subreddit: 'memes' }, { url: 'https://localhost/image.png' }, { url: 'https://i.redd.it@localhost/image.png' }, { postLink: 'javascript:alert(1)' }, { author: '<script>' }]) {
    assert.equal(eligiblePost({ ...post, ...changes }, 'ProgrammerHumor'), null);
  }
});

test('image signatures determine dimensions and unsupported content is rejected', () => {
  assert.deepEqual(imageInfo(png), { width: 1, height: 1, extension: 'png' });
  assert.throws(() => imageInfo(Buffer.from('<html>not an image</html>')), /supported/);
  assert.throws(() => imageInfo(Buffer.from('<svg/>')), /supported/);
});

test('the daily cache follows the Kuala Lumpur calendar boundary', () => {
  assert.equal(localDate(new Date('2026-11-05T15:59:59Z')), '2026-11-05');
  assert.equal(localDate(new Date('2026-11-05T16:00:00Z')), '2026-11-06');
});

test('a refresh stores a local image with source attribution and same-day runs reuse it', async t => {
  const root = await fixture(t);
  const meme = await refreshDevMeme({ root, now, request });
  const updated = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.ok(updated.startsWith('Before\r\n') && updated.endsWith('\r\nAfter'));
  assert.doesNotMatch(updated, /(?<!\r)\n/);
  assert.ok(updated.includes('https://redd.it/abc123'));
  assert.ok(updated.includes('assets/profile/dev-meme/current.png?v='));
  assert.ok((await fs.readFile(path.join(root, 'assets/profile/dev-meme/current.png'))).equals(png));
  assert.deepEqual(await refreshDevMeme({ root, now, request: async () => { throw new Error('Cache should avoid network requests'); } }), meme);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), updated);
});

test('feed failures, unsafe posts and invalid images leave the existing image and README intact', async t => {
  const root = await fixture(t);
  await refreshDevMeme({ root, now, request });
  const before = await Promise.all(['README.md', 'assets/profile/dev-meme/current.png', 'assets/profile/dev-meme/current.json'].map(file => fs.readFile(path.join(root, file))));
  const requests = [
    async () => new Response('Unavailable', { status: 503 }),
    async () => new Response(JSON.stringify({ memes: [{ ...post, nsfw: true }] })),
    async url => String(url).startsWith('https://meme-api.com/') ? new Response(JSON.stringify({ memes: [{ ...post, postLink: 'https://redd.it/next123' }] })) : new Response('<html>Error</html>', { headers: { 'content-type': 'image/png' } }),
  ];
  for (const failedRequest of requests) {
    await assert.rejects(refreshDevMeme({ root, now: new Date('2026-11-07T04:00:00Z'), request: failedRequest }));
    const after = await Promise.all(['README.md', 'assets/profile/dev-meme/current.png', 'assets/profile/dev-meme/current.json'].map(file => fs.readFile(path.join(root, file))));
    assert.ok(after.every((bytes, index) => bytes.equals(before[index])));
  }
});

test('refreshing the English meme preserves the independently refreshed Chinese section and image', async t => {
  const root = await fixture(t);
  await refreshDevMeme({ root, now, request });
  const chineseAsset = path.join(root, 'assets/profile/dev-meme/chinese-current.png');
  await fs.writeFile(chineseAsset, png);
  const nextRequest = async url => String(url).startsWith('https://meme-api.com/')
    ? new Response(JSON.stringify({ memes: [{ ...post, postLink: 'https://redd.it/next123' }] }))
    : request(url);
  await refreshDevMeme({ root, now: new Date('2026-11-07T04:00:00Z'), request: nextRequest });
  const updated = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.ok(updated.includes(chineseSection));
  assert.ok(updated.includes('https://redd.it/next123'));
  assert.ok((await fs.readFile(chineseAsset)).equals(png));
});

test('post text is escaped, while missing and duplicate markers cannot overwrite other sections', () => {
  const meme = { ...post, title: '<script> & "', width: 1, height: 1, date: '2026-11-06', asset: 'current.png', sha256: 'a'.repeat(64) };
  const output = replaceSection(readme, meme);
  assert.doesNotMatch(output, /<script>/);
  assert.match(output, /&lt;script&gt; &amp; &quot;/);
  assert.throws(() => replaceSection('No markers', meme), /exactly one/);
  assert.throws(() => replaceSection(readme + '<!-- END dev-meme -->', meme), /exactly one/);
});
