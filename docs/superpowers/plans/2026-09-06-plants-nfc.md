# 植物施肥记录 NFC 应用 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个单页网页应用，用手机碰花盆上的 NFC 贴纸即可查看该植物的施肥档案并一键补记一笔，数据存在 GitHub 仓库里。

**Architecture:** 纯静态站点托管在 GitHub Pages，无服务器、无构建步骤、无第三方依赖。业务逻辑拆成三层：`src/logic.js` 是不碰 DOM 也不联网的纯函数（可用 node 直接测），`src/github.js` 封装 GitHub Contents API 的读写与冲突重试，`src/app.js` 只负责渲染和事件。数据落在同仓库的 `config.json` 和 `log.json`，每次记录 = 一个 commit。

**Tech Stack:** 原生 ES modules + 原生 fetch，零依赖；测试用 Node 25 内置的 `node:test`（本机已确认 v25.9.0）。

**Spec:** `docs/superpowers/specs/2026-09-06-plants-nfc-design.md`

---

## ⚠️ 2026-10-04 修订：以 spec 第 11 节为准

下面各 Task 的代码是 09-06 初版。10-04 需求有变（见 spec 第 11 节），实施时按以下调整，**以仓库里实际提交的代码为准**：

| Task | 调整 |
|---|---|
| 2 | 新增 `lastFertEntry` / `lastNoteEntry`：上次施肥只看带 `fert` 的记录，最新备注只看带 `note` 的记录 |
| 3 | 示例肥料名改为花多多01 等（不带 #） |
| 4 | `addEntry(log, p, date, fert, note)`：`fert`/`note` 都可选但至少一个；新增 `renamePlant`；`plantOverview` 按上次**施肥**排序 |
| 6 | 默认数据仓库改为 private 的 `plants-data`；新增 `readBinary` / `writeBinary` 读写照片 |
| 7 | 初始 `config.json` 为 7 个肥料；数据文件不进代码仓库（数据仓库为空时按空数据处理） |
| 8 | 照片区始终占位、可上传（canvas 压缩）；「上次施肥」+「最新备注」同时显示；备注框 + 「只记备注」；大按钮去掉「今天也施」 |
| 9 | 编辑态加植物改名、换照片 |
| 11 | 不再需要 Annie 一次性提供名单和照片，改为在手机上逐盆取名、拍照 |

---

## 与 Spec 的一处偏离（已确认）

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
| `photos/<代号>.jpg` | 每盆一张压缩过的照片，单盆页面顶部显示 |
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
    "test": "node --test"
  }
}
```

⚠️ 必须是 `node --test`，**不能**写 `node --test test/`。Node 22 之后位置参数按通配符解释，`test/` 会匹配到目录本身并当模块加载，实测报 `Cannot find module '.../test'` 且 `pass 0 fail 1`。这个错误信息跟 Step 3 期望看到的很像，容易误判成通道是通的。

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

test('renaming onto a hidden name explains that it was deleted, not that it exists', () => {
  // 奥绿A2 is hidden, so the user cannot see it in the grid. A bare
  // "already exists" message would look like the app is lying to them.
  assert.throws(
    () => renameFertilizer(CONFIG, LOG, '花多多#01', '奥绿A2', false),
    /以前删掉过/
  );
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
  // rawName may be null: prompt() returns null when the user taps Cancel.
  const name = (rawName ?? '').trim();
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
  const newName = (rawNewName ?? '').trim();
  if (!newName) throw new Error('名字不能为空');
  if (newName === oldName) return { config, log };

  const clash = config.fertilizers.find((f) => f.name === newName);
  if (clash) {
    // Distinguish visible from hidden: a hidden clash is invisible to the user,
    // so "already exists" would look like a lie.
    throw new Error(
      clash.hidden
        ? `「${newName}」以前删掉过，先用＋把它加回来`
        : `「${newName}」已经有了`
    );
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

Expected: PASS，16 passing

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

test('plantOverview keeps every plant when several have never been fertilized', () => {
  // A fresh install has config.plants = {} and every newly registered plant
  // has days === null. Guards against the NaN comparator dropping or shuffling rows.
  let config = CONFIG;
  for (const id of ['a', 'b', 'c', 'd']) config = addPlant(config, id, `植物${id}`);
  const rows = plantOverview(config, LOG, '2026-09-06');
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.slice(-2).map((r) => r.id), ['guibeizhu', 'qinyerong']);
  assert.ok(rows.slice(0, 4).every((r) => r.days === null));
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
  const name = (rawName ?? '').trim();
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
    .sort((a, b) => {
      // Both null would give Infinity - Infinity = NaN, and a comparator that
      // returns NaN makes sort order implementation-defined. On a fresh install
      // every plant has days === null, so this is the common case, not an edge one.
      const av = a.days ?? Infinity;
      const bv = b.days ?? Infinity;
      return av === bv ? 0 : bv - av;
    });
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: PASS，22 passing

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

Expected: PASS，25 passing

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Add UTF-8 safe base64 helpers for the Contents API"
```

---

## Task 6: GitHub 读写客户端（github.js）

spec 第 8 节的两条要求落在这里：读要绕开缓存，写要处理 sha 冲突。

### 接口决定：`update(path, fallback, updateFn, message)`，不是 `writeJson(path, data, ...)`

冲突重试**只补 sha 是不够的**。假如另一台设备刚记了一笔，本机手上的 `data` 是基于旧快照算出来的；只换新 sha 再提交，HTTP 会成功、界面会显示「已记录」，但对方那笔被整份覆盖——正是 spec 第 8 节要防的静默丢失，只是更隐蔽。

所以由客户端自己完成「读 → 改 → 写」整个循环，调用方传的是**怎么改**（一个函数），不是**改成什么**（一份算好的数据）。冲突时重读最新数据，**把改动重新施加一遍**再提交。附带好处：调用方完全不用管 sha。

**Files:**
- Create: `src/github.js`
- Create: `test/github.test.js`

- [ ] **Step 1: 写失败的测试**

`test/github.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubStore } from '../src/github.js';
import { encodeBase64Utf8, decodeBase64Utf8 } from '../src/logic.js';

function makeStore(fetchImpl) {
  return new GitHubStore({
    owner: 'pyyannie', repo: 'plants', token: 't', fetchImpl,
  });
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const err = (status, message) => ({ ok: false, status, json: async () => ({ message }) });
const putBody = (opts) => JSON.parse(opts.body);
const putData = (opts) => JSON.parse(decodeBase64Utf8(putBody(opts).content));

test('readJson parses content and returns the sha', async () => {
  const calls = [];
  const store = makeStore(async (url, opts) => {
    calls.push({ url, opts });
    return ok({ content: encodeBase64Utf8('{"a":"龟背竹"}'), sha: 'abc' });
  });

  const { data, sha } = await store.readJson('config.json');
  assert.deepEqual(data, { a: '龟背竹' });
  assert.equal(sha, 'abc');
  assert.match(calls[0].url, /repos\/pyyannie\/plants\/contents\/config\.json/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer t');
});

test('readJson defeats caching two ways, since Safari honours them inconsistently', async () => {
  let seen;
  const store = makeStore(async (url, opts) => {
    seen = opts;
    return ok({ content: encodeBase64Utf8('{}'), sha: 'abc' });
  });
  await store.readJson('config.json');
  // api.github.com returns `Cache-Control: private, max-age=60` on authenticated
  // requests, so a just-written entry can be invisible for a minute without this.
  assert.equal(seen.headers['Cache-Control'], 'no-cache');
  assert.equal(seen.cache, 'no-store');
});

test('readJson returns a null sha when the file does not exist yet', async () => {
  const store = makeStore(async () => err(404, 'Not Found'));
  const { data, sha } = await store.readJson('log.json', []);
  assert.deepEqual(data, []);
  assert.equal(sha, null);
});

test('update reads, applies the change, and PUTs with the sha it read', async () => {
  let put;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') { put = opts; return ok({}); }
    return ok({ content: encodeBase64Utf8('[]'), sha: 'abc' });
  });

  const result = await store.update('log.json', [], (log) => [...log, { fert: '花多多#01' }], 'log it');
  assert.equal(putBody(put).sha, 'abc');
  assert.equal(putBody(put).message, 'log it');
  assert.deepEqual(putData(put), [{ fert: '花多多#01' }]);
  assert.deepEqual(result, [{ fert: '花多多#01' }], 'returns the new data for in-memory state');
});

test('update re-applies the change to fresh data after a conflict, keeping both entries', async () => {
  // The core regression guard: another device committed 琴叶榕 between our read
  // and our write. Retrying with only a fresh sha would silently erase it.
  let puts = 0;
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') {
      puts += 1;
      return puts === 1 ? err(409, 'conflict') : ok({});
    }
    const content = puts === 0
      ? JSON.stringify([{ fert: '花多多#02' }])
      : JSON.stringify([{ fert: '花多多#02' }, { fert: '琴叶榕的肥' }]);
    return ok({ content: encodeBase64Utf8(content), sha: puts === 0 ? 'stale' : 'fresh' });
  });

  let lastPut;
  const spy = store.fetchImpl;
  store.fetchImpl = async (url, opts) => {
    const res = await spy(url, opts);
    if (opts?.method === 'PUT') lastPut = opts;
    return res;
  };

  await store.update('log.json', [], (log) => [...log, { fert: '我的肥' }], 'msg');
  assert.equal(putBody(lastPut).sha, 'fresh');
  assert.deepEqual(putData(lastPut).map((e) => e.fert), ['花多多#02', '琴叶榕的肥', '我的肥']);
});

test('update throws when the retry also fails, so the UI can report it', async () => {
  const store = makeStore(async (url, opts) => {
    if (opts?.method === 'PUT') return err(409, 'still conflicting');
    return ok({ content: encodeBase64Utf8('[]'), sha: 'fresh' });
  });
  await assert.rejects(() => store.update('log.json', [], (l) => l, 'msg'), /still conflicting/);
});

test('a 401 surfaces as a token problem, not a generic failure', async () => {
  const store = makeStore(async () => err(401, 'Bad credentials'));
  await assert.rejects(() => store.readJson('config.json'), /token/);
});

test('a 403 rate limit says "slow down", not "your token is broken"', async () => {
  // GitHub returns 403 for secondary rate limits too. Telling a non-programmer
  // their token is invalid would send them off regenerating it for nothing.
  const limited = makeStore(async () => err(403, 'You have exceeded a secondary rate limit'));
  await assert.rejects(() => limited.readJson('config.json'), /等一分钟/);

  const forbidden = makeStore(async () => err(403, 'Resource not accessible by personal access token'));
  await assert.rejects(() => forbidden.readJson('config.json'), /token/);
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
  // It must stay wrapped in an arrow, NOT `globalThis.fetch` directly: assigning
  // fetch onto `this` and calling `this.fetchImpl(...)` rebinds its receiver, and
  // the browser's fetch has a brand check that throws "Illegal invocation".
  // Node's fetch has no such check, so a direct reference passes every test here
  // and then fails on the phone.
  constructor({ owner, repo, token, branch = 'main', fetchImpl = (...a) => globalThis.fetch(...a) }) {
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
      // api.github.com sends `Cache-Control: private, max-age=60` on authenticated
      // requests. Without this, iOS Safari can serve a stale copy for a minute and
      // a just-logged entry appears to have vanished.
      'Cache-Control': 'no-cache',
    };
  }

  async #fail(res) {
    const body = await res.json().catch(() => ({}));
    const message = body.message ?? '';
    // GitHub also returns 403 for secondary rate limits, which the rename flow
    // (two writes back to back) can trigger. Telling Annie her token is invalid
    // would send her off regenerating it for no reason.
    if (res.status === 403 && /rate limit/i.test(message)) {
      throw new Error('操作太快了，等一分钟再试');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`token 无效或权限不够（${res.status}）：${message}`);
    }
    throw new Error(`GitHub 返回 ${res.status}：${message || '未知错误'}`);
  }

  // Returns { data, sha }. sha is null when the file does not exist yet, which
  // is what a first-time PUT needs.
  async readJson(path, fallback = null) {
    const res = await this.fetchImpl(`${this.#url(path)}?ref=${this.branch}`, {
      headers: this.#headers(),
      cache: 'no-store',
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

  // Read-modify-write. updateFn receives the current data and returns the new data.
  //
  // On conflict (409/422 = someone committed since we read) we re-read and run
  // updateFn AGAIN against the fresh data. Retrying with only a fresh sha would
  // re-submit our stale snapshot and silently erase the other commit -- which is
  // exactly the data loss the retry exists to prevent.
  //
  // Returns the data that was written, so the caller can update its in-memory copy.
  async update(path, fallback, updateFn, message) {
    const first = await this.readJson(path, fallback);
    let data = updateFn(first.data);
    let res = await this.#put(path, data, first.sha, message);

    if (res.status === 409 || res.status === 422) {
      const fresh = await this.readJson(path, fallback);
      data = updateFn(fresh.data);
      res = await this.#put(path, data, fresh.sha, message);
    }

    if (!res.ok) await this.#fail(res);
    return data;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd ~/Documents/plants-nfc && npm test
```

Expected: PASS，33 passing

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
- **不要**加 `apple-mobile-web-app-capable`。它暗示「加到主屏当 App 用」，但 NFC 打开的链接一律走 Safari、进不了主屏 App，而且两边的 localStorage 是分开的，等于要配两次 token。
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

- 从 `parsePlantId(location.search)` 拿植物代号（代号直接用中文，`?p=龟背竹`，URLSearchParams 自动解码）
- 并行 `readJson('config.json')` 和 `readJson('log.json', [])` 取初始数据。**不要在 app 层记 sha** —— `store.update()` 自己管
- 代号在 `config.plants` 里查不到 → 渲染「这盆还没名字，取一个？」的取名界面（Task 9 处理）
- **最顶部：照片** `<img src="photos/{代号}.jpg">`

  ```js
  // No photo for this plant: remove the block entirely rather than showing
  // a broken-image icon or leaving a gap.
  img.onerror = () => img.closest('.photo').remove();
  ```

  照片路径**用相对路径**（`photos/...`），不要用 `/photos/...` —— 站点部署在 `/plants/` 子路径下，绝对路径会 404。
- 植物名 + 「上次施肥 8/30 · 7 天前」
- 有上次记录时显示大按钮「今天也施 {上次的肥}」；从没记录过则隐藏这个按钮
- 下方 `visibleFertilizers(config, 上次的肥)` 渲染成按钮网格
- 底部历史列表，`entriesFor` 的结果

- [ ] **Step 2: 实现记录写入**

点任意肥料按钮：

1. 按钮立刻进入「记录中…」的禁用态，防止连点记两笔
2. 调 `store.update('log.json', [], (log) => addEntry(log, id, todayLocal(), fert), \`Log ${植物名} / ${肥料名}\`)`

   传函数而不是算好的数组，是为了让冲突重试能在最新数据上重放这次追加（见 Task 6 的接口说明）。

   commit message 定为 `Log 龟背竹 / 花多多#01` —— 英文动词开头守全局规则第 6 条，植物名和肥料名保留中文原样。
3. 成功 → `update` 的返回值就是新的 log，用它替换内存里的副本，重新渲染，顶部给一条「已记录」提示
4. **失败 → 明确显示「没存上：{错误}」并把按钮恢复可点**，内存里的 log 保持原样。绝不能假装成功

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

- [ ] **Step 0: 统一处理 `prompt()` 被取消**

本任务所有输入都用 `prompt()`，而用户点「取消」时它返回 `null`。手机上误触取消是大概率事件，所以定一条规矩：

```js
// prompt() returns null on Cancel. Bail out silently rather than
// letting null reach the logic layer.
const name = prompt('肥料名字');
if (name === null) return;
```

`logic.js` 里的 `addFertilizer` / `addPlant` / `renameFertilizer` 已经对 `null` 做了兜底（当空名处理并抛「名字不能为空」），但**调用点仍要先判 null 直接 return** —— 取消不该弹错误提示。

- [ ] **Step 1: 未登记芯片的取名界面**

- 输入框 + 「登记」按钮（这里用真的 `<input>`，不用 `prompt()`）
- `store.update('config.json', null, (cfg) => addPlant(cfg, id, name), message)`
- 成功后直接进入该植物的单盆页面

- [ ] **Step 2: 编辑态开关**

- 右上角「✏️编辑」按钮切换 `editing` 状态
- 编辑态下每个肥料按钮角上显示 ✏️ 和 🗑
- **编辑态下点按钮本体不记录**，避免误记
- 编辑态里放一个「清除 token」入口

- [ ] **Step 3: 新增肥料**

- 网格末尾虚线「＋」按钮 → `prompt()` 输入名字（按 Step 0 判 null）→ `addFertilizer` → `store.update('config.json', ...)`
- `addFertilizer` 抛的错（空名/重名）直接显示出来

- [ ] **Step 4: 重命名（带历史询问）**

1. `prompt()` 输入新名字，按 Step 0 判 null
2. `countFertilizerUses(log, oldName)` 算出历史条数
3. 条数 > 0 时 `confirm('历史里的 N 条旧名字也一起改吗？')`；条数为 0 时跳过询问，直接按 `false` 处理
4. `renameFertilizer(config, log, old, new, alsoHistory)` 先在内存里算一遍，把它抛的错（空名、重名、撞上隐藏项）显示出来
5. `alsoHistory` 为真时要写**两个**文件。先写 `log.json` 再写 `config.json`；若第二个写失败，提示「历史已改但按钮名没改成功，请重试」——说清楚状态，不要让用户以为什么都没发生
6. 这里是背靠背两次写入，**最容易撞上 GitHub 的二级限流**（短时间内连续写同一仓库会被挡）。`github.js` 已经把这种 403 翻译成「操作太快了，等一分钟再试」，UI 直接把这句话显示出来就行

- [ ] **Step 5: 删除（只隐藏）**

- `confirm('把「X」从列表里拿掉？历史记录不受影响。')`
- `hideFertilizer` → `store.update('config.json', ...)`

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

## Task 11: 植物名单与照片入库

Annie 会提供一份植物名单文件和对应照片。**这个任务在拿到文件之前做不了，拿到后再动手。**

**Files:**
- Modify: `config.json`
- Create: `photos/<代号>.jpg`

- [ ] **Step 1: 从 Annie 给的文件生成 `config.json` 的 `plants` 部分**

代号直接用中文植物名，代号和显示名一致：

```json
{
  "plants": { "龟背竹": "龟背竹", "琴叶榕": "琴叶榕" },
  "fertilizers": [ ... ]
}
```

同名重复时（比如两盆龟背竹）加后缀区分：`龟背竹1` / `龟背竹2`，显示名可以写「龟背竹（阳台）」。

- [ ] **Step 2: 压缩照片**

手机原图一张 3–5 MB，15 盆就是 70 MB 进 public 仓库，手机用流量打开会很慢。用 macOS 自带的 `sips`，不用装东西：

```bash
cd ~/Documents/plants-nfc && mkdir -p photos
# --resampleWidth only shrinks; it never upscales a small photo.
for f in <Annie 给的照片目录>/*.{jpg,jpeg,JPG,HEIC}; do
  [ -e "$f" ] || continue
  sips -s format jpeg -s formatOptions 70 --resampleWidth 800 \
       "$f" --out "photos/$(basename "${f%.*}").jpg"
done
du -sh photos && ls -la photos | head
```

`sips` 能直接读 iPhone 的 HEIC，输出 jpeg。**验收标准：`photos/` 总体积 < 3 MB。**超了就把 `formatOptions` 从 70 降到 55 再跑一遍。

- [ ] **Step 3: 核对文件名与代号严格一致**

```bash
cd ~/Documents/plants-nfc && node -e '
const cfg = JSON.parse(require("fs").readFileSync("config.json"));
const have = new Set(require("fs").readdirSync("photos").map(f => f.replace(/\.jpg$/, "")));
for (const id of Object.keys(cfg.plants)) if (!have.has(id)) console.log("缺照片:", id);
for (const f of have) if (!cfg.plants[f]) console.log("多余照片:", f);
'
```

⚠️ macOS 的文件名对中文用 NFD 形式（分解式）存储，而 JSON 里是 NFC 形式（组合式），**看起来一模一样但字节不同**，页面会 404。带声调或罕见字的名字尤其容易中招。上面这段脚本会把它们当成「缺照片 + 多余照片」同时报出来——出现这种成对报错就是这个问题，用 `id.normalize('NFC')` 统一后重命名文件。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "Add plant roster and compressed photos"
```

---

## Task 12: 上线与实机验证

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README**

内容：这是什么、怎么配 token、怎么给芯片写网址、本地怎么跑测试。

必须包含这两条，否则 Annie 迟早会被卡住：

- **token 会被自动清掉。** iOS Safari 会删除 7 天未访问站点的 localStorage。冬天两周没碰植物，再打开就退回配置页。**token 要另存一份**（备忘录或密码管理器），重贴一次即可，数据不会丢——数据在 GitHub 上。
- **改代码前先 `git pull --rebase`。** 手机每记一笔就在远端 `main` 上多一个 commit，本地不拉就直接改，下次 push 会被拒。

- [ ] **Step 2: 先关掉公开邮箱（Annie 手动操作，必须在建仓库之前）**

打开 `https://github.com/settings/emails`，确认 **Keep my email address private** 已勾选。

> 为什么单独一步：spec 7.3 配的是仓库级 `user.email`，那只管 Mac 上 `git commit`。手机每记一笔走的是 GitHub API，作者邮箱取的是**账号设置里的默认值**，本地配置管不着。仓库是 public，这里没勾的话每一笔施肥记录都会带上真实邮箱，而且**已经提交的改不掉**。

- [ ] **Step 3: 建远程仓库并推送**

⚠️ **推送前必须先给 Annie 看 diff 并等她明确说「推」**（用户全局规则）。

```bash
cd ~/Documents/plants-nfc
gh repo create pyyannie/plants --public --source=. --remote=origin
git push -u origin main
```

- [ ] **Step 4: 开 GitHub Pages**

```bash
gh api -X POST repos/pyyannie/plants/pages -f 'source[branch]=main' -f 'source[path]=/'
```

等约 1 分钟，确认 `https://pyyannie.github.io/plants/` 能打开。

- [ ] **Step 5: 生成 fine-grained token（Annie 手动操作）**

`https://github.com/settings/personal-access-tokens/new`

- Repository access：**Only select repositories** → `pyyannie/plants`
- Permissions → Repository permissions → **Contents: Read and write**
- 其他权限一律不给
- 生成后**立刻另存一份**（见 Step 1）

- [ ] **Step 6: 手机上跑一遍**

1. 手机 Safari 打开 `https://pyyannie.github.io/plants/`，贴 token
2. 装 NFC Tools，给一枚芯片写 `https://pyyannie.github.io/plants/?p=test1`
3. 碰一下 → 点横幅 → 取名 → 记一笔
4. 去 GitHub 看 commit 是否出现，**确认作者邮箱是 noreply 而不是真实邮箱**

> 这一步是唯一能验出 `fetchImpl` 绑定问题的地方。浏览器的 `fetch` 有身份校验，`this` 不对会抛 `Illegal invocation`，而 Node 没有这个校验——所以 33 个测试全绿也不代表手机上能跑。真机点通了才算数。

- [ ] **Step 7: 剩下的芯片批量写入**

每盆一枚，代号用拼音。写完逐个碰一次取名。

⚠️ 贴纸不要直接贴金属花盆，会读不到，需要垫防磁贴。

---

## 已确认的决定

1. **与 spec 的偏离**：单文件改成 `index.html` + `src/` 下三个 js。✅ Annie 同意（2026-09-06）
2. **植物代号直接用中文**，`?p=龟背竹`，不另起拼音代号。
3. **commit message** 定为 `Log 龟背竹 / 花多多#01` —— 英文动词开头守规则第 6 条，数据部分保留中文。
4. **照片显示在单盆页面顶部**，缺照片时整块不渲染。照片从 Mac 推进仓库，不做应用内上传。

## 还缺的输入

- **Annie 的植物名单文件 + 对应照片** —— Task 11 的前置条件。Task 1–10 不依赖它，可以先做。

---

## 全程要守的规矩

- 每个 Task 结束都跑一次 `npm test`，全绿才提交
- commit message 用英文（用户全局规则第 6 条）
- 代码注释用英文（用户全局规则第 8 条）
- **任何 `git push` 前先给 Annie 看 diff，等她明确说「推」**（用户全局规则第 5 条）
- 上线之后每次改代码前先 `git pull --rebase`，手机记的那些 commit 在远端
- Task 7 的视觉风格是人工检查点，不要自己拍板
