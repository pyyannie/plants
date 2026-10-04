import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubStore } from '../src/github.js';
import { encodeBase64Utf8, decodeBase64Utf8, bytesToBase64 } from '../src/logic.js';

function makeStore(fetchImpl) {
  return new GitHubStore({ owner: 'pyyannie', repo: 'plants-data', token: 't', fetchImpl });
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const err = (status, message) => ({ ok: false, status, json: async () => ({ message }) });
const putBody = (opts) => JSON.parse(opts.body);
const putData = (opts) => JSON.parse(decodeBase64Utf8(putBody(opts).content));

test('defaults to the private plants-data repo', () => {
  const store = new GitHubStore({ token: 't' });
  assert.equal(store.owner, 'pyyannie');
  assert.equal(store.repo, 'plants-data');
});

test('readJson parses content and returns the sha', async () => {
  const calls = [];
  const store = makeStore(async (url, opts) => {
    calls.push({ url, opts });
    return ok({ content: encodeBase64Utf8('{"a":"龟背竹"}'), sha: 'abc' });
  });
  const { data, sha } = await store.readJson('config.json');
  assert.deepEqual(data, { a: '龟背竹' });
  assert.equal(sha, 'abc');
  assert.match(calls[0].url, /repos\/pyyannie\/plants-data\/contents\/config\.json/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer t');
});

test('paths with Chinese characters are URL-encoded segment by segment', async () => {
  let seen;
  const store = makeStore(async (url) => { seen = url; return err(404, 'Not Found'); });
  await store.readBinary('photos/龟背竹.jpg');
  assert.match(seen, /contents\/photos\/%E9%BE%9F%E8%83%8C%E7%AB%B9\.jpg/);
});

test('readJson defeats caching two ways', async () => {
  let seen;
  const store = makeStore(async (url, opts) => {
    seen = opts;
    return ok({ content: encodeBase64Utf8('{}'), sha: 'abc' });
  });
  await store.readJson('config.json');
  assert.equal(seen.headers['Cache-Control'], 'no-cache');
  assert.equal(seen.cache, 'no-store');
});

test('readJson returns the fallback and a null sha when the file does not exist', async () => {
  const store = makeStore(async () => err(404, 'Not Found'));
  assert.deepEqual(await store.readJson('log.json', []), { data: [], sha: null });
});

test('update reads, applies the change, and PUTs with the sha it read', async () => {
  let put;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') { put = opts; return ok({}); }
    return ok({ content: encodeBase64Utf8('[]'), sha: 'abc' });
  });
  const result = await store.update('log.json', [], (log) => [...log, { fert: '花多多01' }], 'log it');
  assert.equal(putBody(put).sha, 'abc');
  assert.equal(putBody(put).message, 'log it');
  assert.deepEqual(putData(put), [{ fert: '花多多01' }]);
  assert.deepEqual(result, [{ fert: '花多多01' }]);
});

test('update creates the file without a sha when it does not exist yet', async () => {
  let put;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') { put = opts; return ok({}); }
    return err(404, 'Not Found');
  });
  await store.update('log.json', [], (log) => [...log, { note: 'x' }], 'msg');
  assert.equal('sha' in putBody(put), false);
});

test('update re-applies the change to fresh data after a conflict, keeping both entries', async () => {
  let puts = 0;
  let lastPut;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') {
      puts += 1;
      lastPut = opts;
      return puts === 1 ? err(409, 'conflict') : ok({});
    }
    const content = puts === 0
      ? JSON.stringify([{ fert: '花多多02' }])
      : JSON.stringify([{ fert: '花多多02' }, { fert: '琴叶榕的肥' }]);
    return ok({ content: encodeBase64Utf8(content), sha: puts === 0 ? 'stale' : 'fresh' });
  });
  await store.update('log.json', [], (log) => [...log, { fert: '我的肥' }], 'msg');
  assert.equal(putBody(lastPut).sha, 'fresh');
  assert.deepEqual(putData(lastPut).map((e) => e.fert), ['花多多02', '琴叶榕的肥', '我的肥']);
});

test('update throws when the retry also fails', async () => {
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') return err(409, 'still conflicting');
    return ok({ content: encodeBase64Utf8('[]'), sha: 'fresh' });
  });
  await assert.rejects(() => store.update('log.json', [], (l) => l, 'msg'), /still conflicting/);
});

test('a 401 surfaces as a token problem; a 403 rate limit says wait a minute', async () => {
  await assert.rejects(() => makeStore(async () => err(401, 'Bad credentials')).readJson('c'), /token/);
  await assert.rejects(
    () => makeStore(async () => err(403, 'You have exceeded a secondary rate limit')).readJson('c'),
    /等一分钟/
  );
  await assert.rejects(
    () => makeStore(async () => err(403, 'Resource not accessible by personal access token')).readJson('c'),
    /token/
  );
});

test('a 404 on the whole repo is reported as a wrong repo or token, not silently empty', async () => {
  // A token without access to plants-data gets 404 (GitHub hides private repos),
  // which would otherwise look exactly like "no data yet".
  const store = makeStore(async () => err(404, 'Not Found'));
  await assert.rejects(() => store.checkAccess(), /plants-data/);

  const good = makeStore(async () => ok({ full_name: 'pyyannie/plants-data' }));
  await good.checkAccess();
});

test('readBinary returns bytes and sha, or null when missing', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x10]);
  const store = makeStore(async () => ok({ content: bytesToBase64(bytes), sha: 'img1' }));
  const got = await store.readBinary('photos/a.jpg');
  assert.deepEqual(got.bytes, bytes);
  assert.equal(got.sha, 'img1');

  const missing = makeStore(async () => err(404, 'Not Found'));
  assert.equal(await missing.readBinary('photos/a.jpg'), null);
});

test('writeBinary overwrites an existing photo using its current sha', async () => {
  let put;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') { put = opts; return ok({}); }
    return ok({ content: '', sha: 'old' });
  });
  await store.writeBinary('photos/a.jpg', new Uint8Array([1, 2, 3]), 'Photo a');
  assert.equal(putBody(put).sha, 'old');
  assert.equal(putBody(put).content, bytesToBase64(new Uint8Array([1, 2, 3])));
  assert.equal(putBody(put).message, 'Photo a');
});

test('writeBinary creates a new photo without a sha', async () => {
  let put;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') { put = opts; return ok({}); }
    return err(404, 'Not Found');
  });
  await store.writeBinary('photos/a.jpg', new Uint8Array([1]), 'Photo a');
  assert.equal('sha' in putBody(put), false);
});
