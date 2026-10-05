import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubStore } from '../src/github.js';
import { encodeBase64Utf8, decodeBase64Utf8, bytesToBase64 } from '../src/logic.js';

function makeStore(fetchImpl, extra = {}) {
  return new GitHubStore({ owner: 'pyyannie', repo: 'plants-data', token: 't', fetchImpl, ...extra });
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

test('reads defeat caching without a Cache-Control header', async () => {
  const seen = [];
  const store = makeStore(async (url, opts) => {
    seen.push({ url, opts });
    return ok({ content: encodeBase64Utf8('{}'), sha: 'abc' });
  });
  await store.readJson('config.json');
  await store.readJson('config.json');
  assert.equal(seen[0].opts.cache, 'no-store');
  assert.match(seen[0].url, /[?&]_=\d+/, 'cache-busting timestamp in the URL');
  assert.notEqual(seen[0].url, seen[1].url, 'each read uses a distinct URL');
});

// Copied from api.github.com's CORS preflight response (checked 2026-10-05).
// Any other request header makes the browser block the request before it is
// sent, which node tests cannot otherwise notice.
const CORS_ALLOWED = [
  'authorization', 'content-type', 'if-match', 'if-modified-since', 'if-none-match',
  'if-unmodified-since', 'accept-encoding', 'x-github-otp', 'x-requested-with',
  'user-agent', 'graphql-features', 'x-github-next-global-id', 'x-github-api-version',
];
// Safelisted headers that never need preflight permission.
const CORS_SAFELISTED = ['accept', 'accept-language', 'content-language'];

test('every request header is one GitHub allows cross-origin', async () => {
  const sent = new Set();
  const store = makeStore(async (url, opts) => {
    Object.keys(opts?.headers ?? {}).forEach((k) => sent.add(k.toLowerCase()));
    if (opts?.method === 'PUT') return ok({});
    if (!/contents/.test(url)) return ok({});
    return ok({ content: encodeBase64Utf8('[]'), sha: 'abc' });
  });
  await store.checkAccess();
  await store.update('log.json', [], (l) => l, 'msg');
  await store.readBinary('photos/a.jpg');
  await store.writeBinary('photos/a.jpg', new Uint8Array([1]), 'msg');
  await store.deleteFile('photos/a.jpg', 'msg');
  for (const h of sent) {
    assert.ok(CORS_ALLOWED.includes(h) || CORS_SAFELISTED.includes(h), `header not allowed by CORS: ${h}`);
  }
});

test('a browser network failure is explained instead of showing "Load failed"', async () => {
  const store = makeStore(async () => { throw new TypeError('Load failed'); });
  await assert.rejects(() => store.readJson('config.json'), /连不上 GitHub/);
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

test('writeBinary retries with a fresh sha when GitHub still reports a stale one', async () => {
  // Right after a photo upload, GitHub can briefly hand back the old sha; the
  // PUT then gets 409. Re-read and try again instead of failing.
  const shas = ['stale', 'stale', 'fresh'];
  const putShas = [];
  const waits = [];
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') {
      const sha = putBody(opts).sha;
      putShas.push(sha);
      return sha === 'fresh' ? ok({}) : err(409, 'is at fresh but expected stale');
    }
    return ok({ content: '', sha: shas.shift() });
  }, { sleep: async (ms) => { waits.push(ms); } });
  await store.writeBinary('photos/a.jpg', new Uint8Array([1]), 'Photo a');
  assert.deepEqual(putShas, ['stale', 'stale', 'fresh']);
  assert.deepEqual(waits, [1000, 1000], 'waits between attempts');
});

test('writeBinary gives up after 3 attempts and reports the error', async () => {
  let puts = 0;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') { puts += 1; return err(409, 'sha mismatch'); }
    return ok({ content: '', sha: 'stale' });
  }, { sleep: async () => {} });
  await assert.rejects(() => store.writeBinary('photos/a.jpg', new Uint8Array([1]), 'm'), /sha mismatch/);
  assert.equal(puts, 3);
});

test('writeBinary does not retry errors that are not conflicts', async () => {
  let puts = 0;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') { puts += 1; return err(401, 'Bad credentials'); }
    return ok({ content: '', sha: 'x' });
  }, { sleep: async () => {} });
  await assert.rejects(() => store.writeBinary('photos/a.jpg', new Uint8Array([1]), 'm'), /token/);
  assert.equal(puts, 1);
});

test('deleteFile deletes with the current sha and skips a file that is already gone', async () => {
  let del;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'DELETE') { del = opts; return ok({}); }
    return ok({ content: '', sha: 'p1' });
  });
  await store.deleteFile('photos/a.jpg', 'Delete a');
  assert.equal(putBody(del).sha, 'p1');
  assert.equal(putBody(del).message, 'Delete a');

  let deletes = 0;
  const gone = makeStore(async (url, opts) => {
    if (opts?.method === 'DELETE') deletes += 1;
    return err(404, 'Not Found');
  });
  await gone.deleteFile('photos/a.jpg', 'Delete a');
  assert.equal(deletes, 0);
});

test('deleteFile retries on a stale sha like writeBinary', async () => {
  const shas = ['stale', 'fresh'];
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'DELETE') return putBody(opts).sha === 'fresh' ? ok({}) : err(409, 'mismatch');
    return ok({ content: '', sha: shas.shift() });
  }, { sleep: async () => {} });
  await store.deleteFile('photos/a.jpg', 'm');
});

test('listDir returns file names, or an empty list when the folder does not exist', async () => {
  let seen;
  const store = makeStore(async (url) => {
    seen = url;
    return ok([{ name: 'a.jpg', type: 'file' }, { name: 'sub', type: 'dir' }, { name: '龟背竹.jpg', type: 'file' }]);
  });
  assert.deepEqual(await store.listDir('photos/thumbs'), ['a.jpg', '龟背竹.jpg']);
  assert.match(seen, /contents\/photos\/thumbs\?ref=main/);

  const missing = makeStore(async () => err(404, 'Not Found'));
  assert.deepEqual(await missing.listDir('photos/thumbs'), []);
});
