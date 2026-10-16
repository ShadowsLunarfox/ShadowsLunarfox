const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fetchFollowers, renderFollowersBadge, refreshFollowers } = require('./generate-followers.cjs');

test('followers come directly from GitHub with the workflow token, including zero', async () => {
  const followers = await fetchFollowers('Lunarfox', async (url, options) => {
    assert.equal(url, 'https://api.github.com/users/Lunarfox');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok: true, json: async () => ({ followers: 0 }) };
  }, 'test-token');
  assert.equal(followers, 0);
});

test('error payloads and invalid counts cannot become a misleading badge', async () => {
  for (const followers of [undefined, null, '16', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(fetchFollowers('Lunarfox', async () => ({ ok: true, json: async () => ({ followers }) })), /valid follower count/);
    assert.throws(() => renderFollowersBadge(followers), /valid follower count/);
  }
});

test('an outage preserves the working badge and a later successful refresh replaces it', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'lunarfox-followers-'));
  const outputPath = path.join(temporaryDirectory, 'followers.svg');
  try {
    const original = renderFollowersBadge(16);
    await fs.writeFile(outputPath, original);
    await assert.rejects(refreshFollowers({ username: 'Lunarfox', outputPath, request: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
    assert.equal(await fs.readFile(outputPath, 'utf8'), original);
    await refreshFollowers({ username: 'Lunarfox', outputPath, request: async () => ({ ok: true, json: async () => ({ followers: 17 }) }) });
    assert.match(await fs.readFile(outputPath, 'utf8'), /aria-label="GitHub followers: 17"/);
  } finally {
    assert.ok(path.resolve(temporaryDirectory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
