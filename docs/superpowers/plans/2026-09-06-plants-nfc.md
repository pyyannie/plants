# 植物施肥记录 NFC 应用 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个单页网页应用，用手机碰花盆上的 NFC 贴纸即可查看该植物的施肥档案并一键补记一笔，数据存在 GitHub 仓库里。

**Architecture:** 纯静态站点托管在 GitHub Pages，无服务器、无构建步骤、无第三方依赖。业务逻辑拆成三层：`src/logic.js` 是不碰 DOM 也不联网的纯函数（可用 node 直接测），`src/github.js` 封装 GitHub Contents API 的读写与冲突重试，`src/app.js` 只负责渲染和事件。数据落在同仓库的 `config.json` 和 `log.json`，每次记录 = 一个 commit。

**Tech Stack:** 原生 ES modules + 原生 fetch，零依赖；测试用 Node 25 内置的 `node:test`（本机已确认 v25.9.0）。

**Spec:** `docs/superpowers/specs/2026-09-06-plants-nfc-design.md`

---

## 与 Spec 的一处偏离（需确认）

Spec 第 4 节写的是「单个 HTML 文件」。本计划改为 `index.html` + `src/` 下三个 js 文件。

原因：单文件里的逻辑没法用 node 测，只能靠人在手机上点。拆开之后核心逻辑有自动化测试兜底，而且改起来不容易碰坏别处。代价是仓库多三个文件——对静态托管没有任何影响，GitHub Pages 直接支持 ES modules。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `index.html` | HTML 骨架 + 全部样式 + 挂载点，不含业务逻辑 |
| `src/logic.js` | 纯函数：日期计算、记录查询、肥料/植物列表增删改、base64 编解码。不碰 DOM，不联网 |
| `src/github.js` | GitHub Contents API 读写客户端，含 sha 冲突重试。只依赖 `logic.js` 的 base64 函数 |
| `src/app.js` | DOM 渲染 + 事件绑定 + token 引导。依赖前两者 |
| `test/logic.test.js` | `logic.js` 的单元测试 |
| `test/github.test.js` | `github.js` 的测试，用假 fetch |
| `config.json` | 植物名单 + 肥料名单（数据） |
| `log.json` | 施肥流水（数据） |
| `.nojekyll` | 告诉 GitHub Pages 不要跑 Jekyll，否则 `_` 开头的路径会被吃掉 |

---

## Task 1: 项目骨架与测试通道

先确认「写个测试 → 跑起来 → 看到它失败」这条路是通的，后面每个任务才有意义。

**Files:**
- Create: `~/Documents/plants-nfc/.nojekyll`
- Create: `~/Documents/plants-nfc/package.json`
- Create: `~/Documents/plants-nfc/test/smoke.test.js`
- Create: `~/Documents/plants-nfc/src/logic.js`

- [ ] **Step 1: 建 `package.json`**

只为声明 ES module，不装任何依赖。

```json
{
  "name": "plants",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: 写一个必定失败的冒烟测试**

`test/smoke.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/logic.js';

test('logic module loads', () => {
  assert.equal(typeof VERSION, 'string');
});
```

- [ ] **Step 3: 跑测试，确认它失败**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: FAIL — `Cannot find module '.../src/logic.js'`

- [ ] **Step 4: 建最小的 `src/logic.js` 让它通过**

```js
export const VERSION = '1';
```

- [ ] **Step 5: 跑测试，确认通过**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: PASS，1 passing

- [ ] **Step 6: 建 `.nojekyll`（空文件）并提交**

```bash
cd ~/Documents/plants-nfc && touch .nojekyll
git add -A && git commit -m "Add project skeleton and node test harness"
```

---

## Task 2: 日期与记录查询（logic.js）

**Files:**
- Modify: `src/logic.js`
- Create: `test/logic.test.js`
- Delete: `test/smoke.test.js`（被真测试取代）

- [ ] **Step 1: 写失败的测试**

`test/logic.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayLocal, formatShortDate, daysSince, entriesFor, lastEntry } from '../src/logic.js';

const LOG = [
  { p: 'guibeizhu', date: '2026-08-02', fert: '花多多#02' },
  { p: 'qinyerong', date: '2026-09-02', fert: '磷酸二氢钾' },
  { p: 'guibeizhu', date: '2026-08-30', fert: '花多多#01' },
];

test('todayLocal formats a Date as YYYY-MM-DD in local time', () => {
  // 用本地时间构造，避开 UTC 换算导致差一天
  assert.equal(todayLocal(new Date(2026, 8, 6)), '2026-09-06');
  assert.equal(todayLocal(new Date(2026, 0, 1)), '2026-01-01');
});

test('formatShortDate drops the year and leading zeros', () => {
  assert.equal(formatShortDate('2026-08-30'), '8/30');
  assert.equal(formatShortDate('2026-01-05'), '1/5');
});

test('daysSince counts whole days between two YYYY-MM-DD strings', () => {
  assert.equal(daysSince('2026-08-30', '2026-09-06'), 7);
  assert.equal(daysSince('2026-09-06', '2026-09-06'), 0);
});

test('entriesFor returns only that plant, newest first', () => {
  const got = entriesFor(LOG, 'guibeizhu');
  assert.deepEqual(got.map((e) => e.date), ['2026-08-30', '2026-08-02']);
});

test('entriesFor returns an empty array for an unknown plant', () => {
  assert.deepEqual(entriesFor(LOG, 'nope'), []);
});

test('lastEntry returns the newest entry, or null when there is none', () => {
  assert.equal(lastEntry(LOG, 'guibeizhu').fert, '花多多#01');
  assert.equal(lastEntry(LOG, 'nope'), null);
});
```

- [ ] **Step 2: 删掉冒烟测试，跑测试确认失败**

```bash
cd ~/Documents/plants-nfc && rm test/smoke.test.js && npm test
```

Expected: FAIL — `todayLocal is not a function` 之类

- [ ] **Step 3: 实现**

`src/logic.js` 整体替换为：

```js
// Format a Date as YYYY-MM-DD using local time.
// Deliberately not toISOString(): that converts to UTC and can shift the date.
export function todayLocal(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-08-30" -> "8/30"
export function formatShortDate(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// Whole days between two YYYY-MM-DD strings. Parsed as UTC on both sides so
// daylight saving transitions cannot produce a fractional day.
export function daysSince(iso, todayIso) {
  const ms = Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

// All entries for one plant, newest first.
export function entriesFor(log, plantId) {
  return log
    .filter((e) => e.p === plantId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function lastEntry(log, plantId) {
  return entriesFor(log, plantId)[0] ?? null;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: PASS，6 passing

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Add date helpers and per-plant log queries"
```

---

## Task 3: 肥料列表的增删改（logic.js）

这是 spec 第 6 节那几条规则的落点：删除只隐藏、重命名可选是否波及历史。

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: 追加失败的测试**

在 `test/logic.test.js` 末尾追加：

```js
import {
  visibleFertilizers, addFertilizer, hideFertilizer,
  countFertilizerUses, renameFertilizer,
} from '../src/logic.js';

const CONFIG = {
  plants: { guibeizhu: '龟背竹', qinyerong: '琴叶榕' },
  fertilizers: [
    { name: '花多多#01', hidden: false },
    { name: '花多多#02', hidden: false },
    { name: '奥绿A2', hidden: true },
  ],
};

test('visibleFertilizers drops hidden ones', () => {
  assert.deepEqual(visibleFertilizers(CONFIG), ['花多多#01', '花多多#02']);
});

test('visibleFertilizers can exclude the one already on the big button', () => {
  assert.deepEqual(visibleFertilizers(CONFIG, '花多多#01'), ['花多多#02']);
});

test('addFertilizer appends without mutating the input', () => {
  const next = addFertilizer(CONFIG, '磷酸二氢钾');
  assert.deepEqual(visibleFertilizers(next), ['花多多#01', '花多多#02', '磷酸二氢钾']);
  assert.equal(CONFIG.fertilizers.length, 3, 'original config must not be mutated');
});

test('addFertilizer un-hides an existing hidden name instead of duplicating it', () => {
  const next = addFertilizer(CONFIG, '奥绿A2');
  assert.equal(next.fertilizers.length, 3);
  assert.deepEqual(visibleFertilizers(next), ['花多多#01', '花多多#02', '奥绿A2']);
});

test('addFertilizer rejects blank and duplicate-visible names', () => {
  assert.throws(() => addFertilizer(CONFIG, '   '), /名字不能为空/);
  assert.throws(() => addFertilizer(CONFIG, '花多多#01'), /已经有了/);
});

test('hideFertilizer only flags it hidden, leaving history alone', () => {
  const next = hideFertilizer(CONFIG, '花多多#01');
  assert.deepEqual(visibleFertilizers(next), ['花多多#02']);
  assert.equal(next.fertilizers.find((f) => f.name === '花多多#01').hidden, true);
});

test('countFertilizerUses counts matching history entries', () => {
  assert.equal(countFertilizerUses(LOG, '花多多#01'), 1);
  assert.equal(countFertilizerUses(LOG, '没用过的肥'), 0);
});

test('renameFertilizer with alsoHistory=false leaves the log untouched', () => {
  const { config, log } = renameFertilizer(CONFIG, LOG, '花多多#01', '花多多通用型', false);
  assert.ok(visibleFertilizers(config).includes('花多多通用型'));
  assert.equal(countFertilizerUses(log, '花多多#01'), 1);
  assert.equal(countFertilizerUses(log, '花多多通用型'), 0);
});

test('renameFertilizer with alsoHistory=true rewrites the log too', () => {
  const { config, log } = renameFertilizer(CONFIG, LOG, '花多多#01', '花多多通用型', true);
  assert.ok(visibleFertilizers(config).includes('花多多通用型'));
  assert.equal(countFertilizerUses(log, '花多多#01'), 0);
  assert.equal(countFertilizerUses(log, '花多多通用型'), 1);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: FAIL — `visibleFertilizers is not a function`

- [ ] **Step 3: 实现，追加到 `src/logic.js`**

```js
// --- fertilizer list ---
// Every function here returns a new config; nothing mutates its input, so the
// caller can always fall back to the old value when a GitHub write fails.

export function visibleFertilizers(config, excludeName = null) {
  return config.fertilizers
    .filter((f) => !f.hidden && f.name !== excludeName)
    .map((f) => f.name);
}

export function addFertilizer(config, rawName) {
  const name = rawName.trim();
  if (!name) throw new Error('名字不能为空');

  const existing = config.fertilizers.find((f) => f.name === name);
  if (existing && !existing.hidden) throw new Error(`「${name}」已经有了`);

  // A hidden entry with the same name is revived rather than duplicated.
  const fertilizers = existing
    ? config.fertilizers.map((f) => (f.name === name ? { ...f, hidden: false } : f))
    : [...config.fertilizers, { name, hidden: false }];

  return { ...config, fertilizers };
}

export function hideFertilizer(config, name) {
  return {
    ...config,
    fertilizers: config.fertilizers.map((f) =>
      f.name === name ? { ...f, hidden: true } : f
    ),
  };
}

export function countFertilizerUses(log, name) {
  return log.filter((e) => e.fert === name).length;
}

// alsoHistory=true rewrites past entries (the name was a typo).
// alsoHistory=false keeps them (the product genuinely changed).
export function renameFertilizer(config, log, oldName, rawNewName, alsoHistory) {
  const newName = rawNewName.trim();
  if (!newName) throw new Error('名字不能为空');
  if (newName === oldName) return { config, log };
  if (config.fertilizers.some((f) => f.name === newName)) {
    throw new Error(`「${newName}」已经有了`);
  }

  const nextConfig = {
    ...config,
    fertilizers: config.fertilizers.map((f) =>
      f.name === oldName ? { ...f, name: newName } : f
    ),
  };
  const nextLog = alsoHistory
    ? log.map((e) => (e.fert === oldName ? { ...e, fert: newName } : e))
    : log;

  return { config: nextConfig, log: nextLog };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: PASS，15 passing

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Add fertilizer list add/hide/rename with history handling"
```

---

## Task 4: 植物与记录写入（logic.js）

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: 追加失败的测试**

```js
import { parsePlantId, addPlant, addEntry, plantOverview } from '../src/logic.js';

test('parsePlantId reads ?p= and returns null when absent or blank', () => {
  assert.equal(parsePlantId('?p=guibeizhu'), 'guibeizhu');
  assert.equal(parsePlantId('?p=guibeizhu&x=1'), 'guibeizhu');
  assert.equal(parsePlantId(''), null);
  assert.equal(parsePlantId('?p='), null);
  assert.equal(parsePlantId('?p=%E9%BE%9F'), '龟', 'must URL-decode');
});

test('addPlant registers a new id without mutating the input', () => {
  const next = addPlant(CONFIG, 'wenzhulan', '文竹');
  assert.equal(next.plants.wenzhulan, '文竹');
  assert.equal(CONFIG.plants.wenzhulan, undefined);
});

test('addPlant rejects blank names and already-registered ids', () => {
  assert.throws(() => addPlant(CONFIG, 'x', '  '), /名字不能为空/);
  assert.throws(() => addPlant(CONFIG, 'guibeizhu', '别的名'), /已经登记/);
});

test('addEntry appends a record without mutating the input', () => {
  const next = addEntry(LOG, 'guibeizhu', '2026-09-06', '花多多#01');
  assert.equal(next.length, LOG.length + 1);
  assert.deepEqual(next.at(-1), { p: 'guibeizhu', date: '2026-09-06', fert: '花多多#01' });
  assert.equal(LOG.length, 3, 'original log must not be mutated');
});

test('plantOverview sorts by staleness, never-fertilized plants first', () => {
  const config = addPlant(CONFIG, 'wenzhulan', '文竹');
  const rows = plantOverview(config, LOG, '2026-09-06');
  assert.deepEqual(rows.map((r) => r.id), ['wenzhulan', 'guibeizhu', 'qinyerong']);
  assert.deepEqual(rows[0], { id: 'wenzhulan', name: '文竹', lastDate: null, lastFert: null, days: null });
  assert.equal(rows[1].days, 7);
  assert.equal(rows[2].days, 4);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: FAIL — `parsePlantId is not a function`

- [ ] **Step 3: 实现，追加到 `src/logic.js`**

```js
// --- plants and log entries ---

export function parsePlantId(search) {
  const id = new URLSearchParams(search).get('p');
  return id && id.trim() ? id.trim() : null;
}

export function addPlant(config, id, rawName) {
  const name = rawName.trim();
  if (!name) throw new Error('名字不能为空');
  if (config.plants[id]) throw new Error(`这枚芯片已经登记为「${config.plants[id]}」`);
  return { ...config, plants: { ...config.plants, [id]: name } };
}

export function addEntry(log, plantId, date, fert) {
  return [...log, { p: plantId, date, fert }];
}

// One row per plant, most overdue first. Plants with no record ever sort to the
// very top -- those are the ones most likely to have been forgotten.
export function plantOverview(config, log, todayIso) {
  return Object.entries(config.plants)
    .map(([id, name]) => {
      const last = lastEntry(log, id);
      return {
        id,
        name,
        lastDate: last?.date ?? null,
        lastFert: last?.fert ?? null,
        days: last ? daysSince(last.date, todayIso) : null,
      };
    })
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity));
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: PASS，20 passing

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Add plant registration, entry append, and overview sorting"
```

---

## Task 5: 中文安全的 base64 编解码（logic.js）

GitHub Contents API 收发的文件内容都是 base64。浏览器原生的 `btoa` 遇到中文会直接抛错，这是这个项目里最容易踩的坑——植物名和肥料名全是中文。

**Files:**
- Modify: `src/logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: 追加失败的测试**

```js
import { encodeBase64Utf8, decodeBase64Utf8 } from '../src/logic.js';

test('base64 round-trips Chinese text', () => {
  const s = JSON.stringify({ name: '龟背竹', fert: '磷酸二氢钾' });
  assert.equal(decodeBase64Utf8(encodeBase64Utf8(s)), s);
});

test('encodeBase64Utf8 does not throw on non-Latin1 characters', () => {
  assert.throws(() => btoa('龟背竹'), 'sanity check: raw btoa is the trap we are avoiding');
  assert.doesNotThrow(() => encodeBase64Utf8('龟背竹'));
});

test('decodeBase64Utf8 tolerates the newlines GitHub puts in its base64', () => {
  const raw = encodeBase64Utf8('龟背竹');
  const withNewlines = raw.replace(/(.{4})/g, '$1\n');
  assert.equal(decodeBase64Utf8(withNewlines), '龟背竹');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: FAIL — `encodeBase64Utf8 is not a function`

- [ ] **Step 3: 实现，追加到 `src/logic.js`**

```js
// --- base64 ---
// btoa/atob only handle Latin-1, so plain btoa('龟背竹') throws. Convert to and
// from UTF-8 bytes explicitly. Both btoa/atob and TextEncoder/TextDecoder exist
// in browsers and in Node, so these are testable without a DOM.

export function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeBase64Utf8(b64) {
  // The API returns base64 wrapped in newlines; atob rejects them.
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: PASS，23 passing

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Add UTF-8 safe base64 helpers for the Contents API"
```

---

## Task 6: GitHub 读写客户端（github.js）

spec 第 8 节的两条要求落在这里：读要绕开缓存，写要处理 sha 冲突并重试一次。

**Files:**
- Create: `src/github.js`
- Create: `test/github.test.js`

- [ ] **Step 1: 写失败的测试**

`test/github.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubStore } from '../src/github.js';
import { encodeBase64Utf8 } from '../src/logic.js';

function makeStore(fetchImpl) {
  return new GitHubStore({
    owner: 'pyyannie', repo: 'plants', token: 't', fetchImpl,
  });
}

test('readJson parses content and returns the sha', async () => {
  const calls = [];
  const store = makeStore(async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true, status: 200,
      json: async () => ({ content: encodeBase64Utf8('{"a":"龟背竹"}'), sha: 'abc' }),
    };
  });

  const { data, sha } = await store.readJson('config.json');
  assert.deepEqual(data, { a: '龟背竹' });
  assert.equal(sha, 'abc');
  assert.match(calls[0].url, /repos\/pyyannie\/plants\/contents\/config\.json/);
  assert.equal(calls[0].opts.cache, 'no-store', 'must bypass the CDN cache');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer t');
});

test('readJson returns a null sha when the file does not exist yet', async () => {
  const store = makeStore(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  const { data, sha } = await store.readJson('log.json', []);
  assert.deepEqual(data, []);
  assert.equal(sha, null);
});

test('writeJson sends base64 content with the sha', async () => {
  let put;
  const store = makeStore(async (url, opts) => {
    if (opts.method === 'PUT') { put = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; }
    throw new Error('unexpected GET');
  });

  await store.writeJson('log.json', [{ fert: '花多多#01' }], 'abc', 'log fertilizing');
  assert.equal(put.sha, 'abc');
  assert.equal(put.message, 'log fertilizing');
  assert.match(put.content, /^[A-Za-z0-9+/=]+$/);
});

test('writeJson retries once with a fresh sha after a 409 conflict', async () => {
  const seen = [];
  const store = makeStore(async (url, opts) => {
    if (opts.method === 'PUT') {
      seen.push(JSON.parse(opts.body).sha);
      return seen.length === 1
        ? { ok: false, status: 409, json: async () => ({ message: 'conflict' }) }
        : { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ content: encodeBase64Utf8('[]'), sha: 'fresh' }) };
  });

  await store.writeJson('log.json', [], 'stale', 'msg');
  assert.deepEqual(seen, ['stale', 'fresh'], 'second attempt must use the re-read sha');
});

test('writeJson throws when the retry also fails, so the UI can report it', async () => {
  const store = makeStore(async (url, opts) => {
    if (opts.method === 'PUT') return { ok: false, status: 409, json: async () => ({ message: 'still conflicting' }) };
    return { ok: true, status: 200, json: async () => ({ content: encodeBase64Utf8('[]'), sha: 'fresh' }) };
  });
  await assert.rejects(() => store.writeJson('log.json', [], 'stale', 'msg'), /still conflicting/);
});

test('a 401 surfaces as a token problem, not a generic failure', async () => {
  const store = makeStore(async () => ({ ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) }));
  await assert.rejects(() => store.readJson('config.json'), /token/);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: FAIL — `Cannot find module '.../src/github.js'`

- [ ] **Step 3: 实现 `src/github.js`**

```js
import { encodeBase64Utf8, decodeBase64Utf8 } from './logic.js';

const API = 'https://api.github.com';

export class GitHubStore {
  // fetchImpl is injectable so the tests can run without a network.
  constructor({ owner, repo, token, branch = 'main', fetchImpl = globalThis.fetch }) {
    Object.assign(this, { owner, repo, token, branch, fetchImpl });
  }

  #url(path) {
    return `${API}/repos/${this.owner}/${this.repo}/contents/${path}`;
  }

  #headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async #fail(res) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      throw new Error(`token 无效或权限不够（${res.status}）：${body.message ?? ''}`);
    }
    throw new Error(`GitHub 返回 ${res.status}：${body.message ?? '未知错误'}`);
  }

  // Returns { data, sha }. sha is null when the file does not exist yet, which
  // is what a first-time PUT needs.
  async readJson(path, fallback = null) {
    const res = await this.fetchImpl(`${this.#url(path)}?ref=${this.branch}`, {
      headers: this.#headers(),
      cache: 'no-store', // Pages/CDN would otherwise serve a stale copy
    });
    if (res.status === 404) return { data: fallback, sha: null };
    if (!res.ok) await this.#fail(res);

    const body = await res.json();
    return { data: JSON.parse(decodeBase64Utf8(body.content)), sha: body.sha };
  }

  async #put(path, data, sha, message) {
    return this.fetchImpl(this.#url(path), {
      method: 'PUT',
      headers: { ...this.#headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: encodeBase64Utf8(JSON.stringify(data, null, 2) + '\n'),
        branch: this.branch,
        ...(sha ? { sha } : {}),
      }),
    });
  }

  // A 409/422 means someone else committed since we read the sha. Re-read and
  // retry once. Without this the write fails silently and a fertilizing gets lost.
  async writeJson(path, data, sha, message) {
    let res = await this.#put(path, data, sha, message);
    if (res.status === 409 || res.status === 422) {
      const { sha: fresh } = await this.readJson(path);
      res = await this.#put(path, data, fresh, message);
    }
    if (!res.ok) await this.#fail(res);
    return res.json();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: PASS，29 passing

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Add GitHub Contents API client with conflict retry"
```

---

## Task 7: 页面骨架、样式与 token 引导

从这里开始是 UI，没有自动化测试，靠本地起服务器人工看。

**Files:**
- Create: `index.html`
- Create: `src/app.js`
- Create: `config.json`
- Create: `log.json`

- [ ] **Step 1: 建初始数据文件**

`config.json`：

```json
{
  "plants": {},
  "fertilizers": [
    { "name": "花多多#01", "hidden": false },
    { "name": "花多多#02", "hidden": false },
    { "name": "磷酸二氢钾", "hidden": false }
  ]
}
```

`log.json`：

```json
[]
```

- [ ] **Step 2: 写 `index.html`**

要求（具体 CSS 在实现时写）：

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` —— 少了这行手机上会缩得很小
- `<meta name="apple-mobile-web-app-capable" content="yes">` —— 支持加到主屏后全屏
- 单个 `<style>` 块，暖纸色背景 + 粗黑边的方块风格
- 所有可点区域最小 44×44 px（iOS 的可点击下限）
- `<div id="app"></div>` 作为唯一挂载点
- `<script type="module" src="./src/app.js"></script>`
- 支持深色模式（`prefers-color-scheme`）

- [ ] **Step 3: 在 `app.js` 里实现 token 引导**

- 从 `localStorage.getItem('plants.token')` 读 token
- 没有 token 时渲染一个配置页：一句说明 + 一个输入框 + 「保存」按钮
- 存之前先用它调一次 `readJson('config.json')` 验证，**验证不通过不许存**，直接显示 GitHub 返回的错误
- 提供「清除 token」入口（编辑态里），换 token 时用

- [ ] **Step 4: 本地起服务器看效果**

```bash
cd ~/Documents/plants-nfc && python3 -m http.server 8000
```

浏览器打开 `http://localhost:8000/`，确认 token 配置页正常显示、输错 token 会报错。

- [ ] **Step 5: 截图给 Annie 看，确认视觉风格后再继续**

⚠️ **这是一个人工检查点。** 样式不要自己拍板，截图确认过再往下做，否则后面几个界面全要返工。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "Add page shell, styles, and token setup flow"
```

---

## Task 8: 单盆页面

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`（样式）

- [ ] **Step 1: 实现渲染**

按 spec 第 5.1 节：

- 从 `parsePlantId(location.search)` 拿植物代号
- 并行 `readJson('config.json')` 和 `readJson('log.json')`，把两个 sha 记在内存里
- 代号在 `config.plants` 里查不到 → 渲染「这盆还没名字，取一个？」的取名界面（Task 9 处理）
- 顶部：植物名 + 「上次施肥 8/30 · 7 天前」
- 有上次记录时显示大按钮「今天也施 {上次的肥}」；从没记录过则隐藏这个按钮
- 下方 `visibleFertilizers(config, 上次的肥)` 渲染成按钮网格
- 底部历史列表，`entriesFor` 的结果

- [ ] **Step 2: 实现记录写入**

点任意肥料按钮：

1. 按钮立刻进入「记录中…」的禁用态，防止连点记两笔
2. `addEntry(log, id, todayLocal(), fert)`
3. `writeJson('log.json', newLog, logSha, \`${植物名} ${肥料名}\`)`
4. 成功 → 更新内存里的 log 和 sha，重新渲染，顶部给一条「已记录」提示
5. **失败 → 明确显示「没存上：{错误}」并把按钮恢复可点**，内存里的 log 回滚到写之前。绝不能假装成功

- [ ] **Step 3: 本地验证**

用真 token 连真仓库，在 `http://localhost:8000/?p=test1` 上：

- 取名 → 记一笔 → 刷新页面，记录还在
- 断网再点一次，确认显示的是失败而不是成功
- 去 GitHub 仓库页面看，确认多了两个 commit

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "Add single-plant view with one-tap repeat logging"
```

---

## Task 9: 编辑态与未登记芯片

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`（样式）

- [ ] **Step 1: 未登记芯片的取名界面**

- 输入框 + 「登记」按钮
- `addPlant(config, id, name)` → `writeJson('config.json', ...)`
- 成功后直接进入该植物的单盆页面

- [ ] **Step 2: 编辑态开关**

- 右上角「✏️编辑」按钮切换 `editing` 状态
- 编辑态下每个肥料按钮角上显示 ✏️ 和 🗑
- **编辑态下点按钮本体不记录**，避免误记

- [ ] **Step 3: 新增肥料**

- 网格末尾虚线「＋」按钮 → `prompt()` 输入名字 → `addFertilizer` → 写 config
- `addFertilizer` 抛的错（空名/重名）直接显示出来

- [ ] **Step 4: 重命名（带历史询问）**

1. `prompt()` 输入新名字
2. `countFertilizerUses(log, oldName)` 算出历史条数
3. 条数 > 0 时 `confirm('历史里的 N 条旧名字也一起改吗？')`；条数为 0 时跳过询问，直接按 `false` 处理
4. `renameFertilizer(config, log, old, new, alsoHistory)`
5. `alsoHistory` 为真时要写**两个**文件。先写 `log.json` 再写 `config.json`；若第二个写失败，提示「历史已改但按钮名没改成功，请重试」——说清楚状态，不要让用户以为什么都没发生

- [ ] **Step 5: 删除（只隐藏）**

- `confirm('把「X」从列表里拿掉？历史记录不受影响。')`
- `hideFertilizer` → 写 config

- [ ] **Step 6: 本地把每条路径都点一遍**

新增 / 重命名选是 / 重命名选否 / 删除 / 删掉后再新增同名（应该复活而不是重复），每步都去 GitHub 仓库对一眼实际文件内容。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "Add edit mode for fertilizers and new-tag registration"
```

---

## Task 10: 首页总览

**Files:**
- Modify: `src/app.js`
- Modify: `index.html`（样式）

- [ ] **Step 1: 实现**

- `parsePlantId` 返回 null 时走这条路径
- `plantOverview(config, log, todayLocal())` 渲染成列表
- 每行：植物名 + 「N 天前 · 肥料名」，从没施过的显示「还没记过」
- 点一行跳到 `?p={id}`
- 植物一个都没有时显示引导文字：怎么写第一枚芯片

- [ ] **Step 2: 本地验证**

`http://localhost:8000/` 能看到全部植物，顺序是最久没施肥的在最上面。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "Add home overview sorted by staleness"
```

---

## Task 11: 上线与实机验证

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README**

内容：这是什么、怎么配 token、怎么给芯片写网址、本地怎么跑测试。

- [ ] **Step 2: 建远程仓库并推送**

⚠️ **推送前必须先给 Annie 看 diff 并等她明确说「推」**（用户全局规则）。

```bash
cd ~/Documents/plants-nfc
gh repo create pyyannie/plants --public --source=. --remote=origin
git push -u origin main
```

- [ ] **Step 3: 开 GitHub Pages**

```bash
gh api -X POST repos/pyyannie/plants/pages -f 'source[branch]=main' -f 'source[path]=/'
```

等约 1 分钟，确认 `https://pyyannie.github.io/plants/` 能打开。

- [ ] **Step 4: 生成 fine-grained token（Annie 手动操作）**

`https://github.com/settings/personal-access-tokens/new`

- Repository access：**Only select repositories** → `pyyannie/plants`
- Permissions → Repository permissions → **Contents: Read and write**
- 其他权限一律不给

- [ ] **Step 5: 手机上跑一遍**

1. 手机 Safari 打开 `https://pyyannie.github.io/plants/`，贴 token
2. 装 NFC Tools，给一枚芯片写 `https://pyyannie.github.io/plants/?p=test1`
3. 碰一下 → 点横幅 → 取名 → 记一笔
4. 去 GitHub 看 commit 是否出现

- [ ] **Step 6: 剩下的芯片批量写入**

每盆一枚，代号用拼音。写完逐个碰一次取名。

⚠️ 贴纸不要直接贴金属花盆，会读不到，需要垫防磁贴。

---

## 全程要守的规矩

- 每个 Task 结束都跑一次 `npm test`，全绿才提交
- commit message 用英文（用户全局规则第 6 条）
- 代码注释用英文（用户全局规则第 8 条）
- **任何 `git push` 前先给 Annie 看 diff，等她明确说「推」**（用户全局规则第 5 条）
- Task 7 的视觉风格是人工检查点，不要自己拍板
