const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { candidateUrls, replaceSection, refreshChineseMeme } = require('./generate-chinese-meme.cjs');
const { refreshDevMeme } = require('./generate-dev-meme.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6QAAAAABJRU5ErkJggg==', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const firstUrl = 'https://res.apihz.cn/img/bqb/first.png';
const nextUrl = 'https://res.apihz.cn/img/bqb/next.GIF';
const englishSection = '<!-- BEGIN dev-meme -->\r\nEnglish snapshot\r\n<!-- END dev-meme -->';
const readme = `Before\r\n${englishSection}\r\n<!-- BEGIN chinese-meme -->\r\nold\r\n<!-- END chinese-meme -->\r\nAfter`;
const now = new Date('2026-11-06T04:00:00Z');
const nextDay = new Date('2026-11-07T04:00:00Z');
const feed = urls => ({ code: 0, data: { code: 200, msg: 'success', res: urls } });
const requestFor = (urls = [firstUrl], bytes = png, type = 'image/png') => async url => String(url).startsWith('https://api.ruseo.cn/api/bqb?')
  ? Response.json(feed(urls)) : new Response(bytes, { headers: { 'content-type': type } });

async function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'lunarfox-chinese-meme-'));
  await fs.mkdir(path.join(root, '.github'));
  await fs.writeFile(path.join(root, '.github/dev-meme.json'), JSON.stringify({ subreddit: 'ProgrammerHumor' }));
  await fs.writeFile(path.join(root, 'README.md'), readme);
  t.after(async () => {
    if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith('lunarfox-chinese-meme-')) throw new Error('Refusing cleanup outside the test directory');
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('the real wrapped and direct provider formats accept only trusted image URLs', () => {
  const urls = [firstUrl, firstUrl, nextUrl, null, 'http://res.apihz.cn/img/bqb/test.png',
    'https://res.apihz.cn@localhost/img/bqb/test.png', 'https://res.apihz.cn:444/img/bqb/test.png',
    'https://res.apihz.cn/other/test.png', 'https://res.apihz.cn/img/bqb/test.svg', 'https://localhost/test.png'];
  assert.deepEqual(candidateUrls(feed(urls)), [firstUrl, nextUrl]);
  assert.deepEqual(candidateUrls({ code: 200, res: [firstUrl] }), [firstUrl]);
  for (const data of [null, {}, { code: 0 }, { code: 400, data: { code: 200, res: [firstUrl] } }, { code: 200, res: firstUrl }]) {
    assert.throws(() => candidateUrls(data), /invalid data/);
  }
});

test('a refresh stores an attributed local Chinese image and same-day runs avoid the network', async t => {
  const root = await fixture(t);
  const meme = await refreshChineseMeme({ root, now, request: requestFor() });
  const updated = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.ok(updated.includes(englishSection));
  assert.ok(updated.startsWith('Before\r\n') && updated.endsWith('\r\nAfter'));
  assert.doesNotMatch(updated, /(?<!\r)\n/);
  assert.ok(updated.includes(firstUrl) && updated.includes('https://api.ruseo.cn/api-doc/bqb'));
  assert.match(updated, /每日中文梗图（随机主题）/);
  assert.match(updated, /chinese-current\.png\?v=[a-f0-9]{12}/);
  assert.equal(meme.date, '2026-11-06');
  assert.ok((await fs.readFile(path.join(root, 'assets/profile/dev-meme/chinese-current.png'))).equals(png));
  assert.deepEqual(await refreshChineseMeme({ root, now, request: async () => { throw new Error('Unexpected network request'); } }), meme);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), updated);
});

test('the next Kuala Lumpur day changes the image and its cache hash, preserving the English asset', async t => {
  const root = await fixture(t);
  const previous = await refreshChineseMeme({ root, now, request: requestFor() });
  const englishAsset = path.join(root, 'assets/profile/dev-meme/current.png');
  await fs.writeFile(englishAsset, png);
  const next = await refreshChineseMeme({ root, now: new Date('2026-11-06T16:00:00Z'), request: requestFor([firstUrl, nextUrl], gif, 'image/gif') });
  assert.equal(next.date, '2026-11-07');
  assert.equal(next.imageUrl, nextUrl);
  assert.notEqual(next.sha256, previous.sha256);
  const updated = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(updated, /chinese-current\.gif\?v=/);
  assert.doesNotMatch(updated, /chinese-current\.png/);
  await assert.rejects(fs.readFile(path.join(root, 'assets/profile/dev-meme/chinese-current.png')), { code: 'ENOENT' });
  assert.ok((await fs.readFile(englishAsset)).equals(png));
});

test('force replaces a same-day image, and a corrupt cached image triggers a fresh download', async t => {
  const root = await fixture(t);
  await refreshChineseMeme({ root, now, request: requestFor() });
  const forced = await refreshChineseMeme({ root, now, force: true, request: requestFor([nextUrl], gif, 'image/gif') });
  assert.equal(forced.imageUrl, nextUrl);
  await fs.writeFile(path.join(root, 'assets/profile/dev-meme/chinese-current.gif'), 'corrupt');
  const repaired = await refreshChineseMeme({ root, now, request: requestFor() });
  assert.equal(repaired.imageUrl, firstUrl);
  assert.ok((await fs.readFile(path.join(root, 'assets/profile/dev-meme/chinese-current.png'))).equals(png));
});

test('failed feeds, invalid images, and duplicate image bytes preserve the previous snapshot and README', async t => {
  const root = await fixture(t);
  await refreshChineseMeme({ root, now, request: requestFor() });
  const files = ['README.md', 'assets/profile/dev-meme/chinese-current.png', 'assets/profile/dev-meme/chinese-current.json'];
  const before = await Promise.all(files.map(file => fs.readFile(path.join(root, file))));
  const requests = [
    async () => new Response('Unavailable', { status: 503 }),
    async () => new Response('not json'),
    async () => Response.json(feed(['https://localhost/image.png'])),
    requestFor([firstUrl]),
    requestFor([nextUrl]), // Different URLs serving identical bytes must also be skipped.
    requestFor([nextUrl], Buffer.from('<html>Error</html>')),
    requestFor([nextUrl], png, 'text/html'),
  ];
  for (const request of requests) {
    await assert.rejects(refreshChineseMeme({ root, now: nextDay, request }));
    const after = await Promise.all(files.map(file => fs.readFile(path.join(root, file))));
    assert.ok(after.every((bytes, index) => bytes.equals(before[index])));
  }
});

test('each language can refresh when the other source fails', async t => {
  const root = await fixture(t);
  const offline = async () => { throw new Error('Source offline'); };
  await assert.rejects(refreshDevMeme({ root, now, request: offline }));
  await refreshChineseMeme({ root, now, request: requestFor() });
  const chineseBefore = (await fs.readFile(path.join(root, 'README.md'), 'utf8')).match(/<!-- BEGIN chinese-meme -->[\s\S]*?<!-- END chinese-meme -->/)[0];
  const englishRequest = async url => String(url).startsWith('https://meme-api.com/')
    ? Response.json({ memes: [{ postLink: 'https://redd.it/abc123', subreddit: 'ProgrammerHumor', title: 'English joke', url: 'https://i.redd.it/example.png', nsfw: false, spoiler: false, author: 'ExampleAuthor' }] })
    : new Response(png, { headers: { 'content-type': 'image/png' } });
  await refreshDevMeme({ root, now, request: englishRequest });
  await assert.rejects(refreshChineseMeme({ root, now: nextDay, request: offline }));
  const updated = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  assert.ok(updated.includes(chineseBefore));
  assert.ok(updated.includes('https://redd.it/abc123'));
});

test('section markers are validated before any requests or file changes', async t => {
  const root = await fixture(t);
  for (const invalid of ['No markers', readme + '<!-- BEGIN chinese-meme -->', readme + '<!-- END chinese-meme -->']) {
    await fs.writeFile(path.join(root, 'README.md'), invalid);
    let requested = false;
    await assert.rejects(refreshChineseMeme({ root, now, request: async () => { requested = true; throw new Error('Unexpected request'); } }), /exactly one/);
    assert.equal(requested, false);
    assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), invalid);
  }
});

test('cached metadata cannot inject markup and tall images stay within the shared display height', () => {
  const meme = { asset: 'chinese-current.png', sha256: 'a'.repeat(64), imageUrl: firstUrl + '?note="<script>', width: 1000, height: 2000, date: '<script>' };
  const rendered = replaceSection(readme, meme);
  assert.doesNotMatch(rendered, /<script>/);
  assert.match(rendered, /&lt;script&gt;/);
  assert.match(rendered, /width="190"/);
  assert.throws(() => replaceSection(readme, { ...meme, asset: '../outside.png' }), /Invalid/);
  assert.throws(() => replaceSection(readme, { ...meme, imageUrl: 'https://localhost/image.png' }), /Unexpected/);
});
