import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayLocal, formatShortDate, daysSince, entriesFor, lastFertEntry, lastNoteEntry,
  visibleFertilizers, addFertilizer, hideFertilizer, countFertilizerUses, renameFertilizer,
  parsePlantId, addPlant, renamePlant, addEntry, plantOverview, checkLogDate, deleteEntry,
  avatarLayout, clampCrop, setAvatarCrop, changeEntryDate,
  encodeBase64Utf8, decodeBase64Utf8, bytesToBase64, base64ToBytes,
} from '../src/logic.js';

const LOG = [
  { p: '龟背竹', date: '2026-08-02', fert: '花多多02' },
  { p: '琴叶榕', date: '2026-09-02', fert: '磷酸二氢钾' },
  { p: '龟背竹', date: '2026-08-30', fert: '花多多01', note: '新叶有点黄' },
  { p: '龟背竹', date: '2026-09-03', note: '发现有虫' },
];

const CONFIG = {
  plants: { 龟背竹: '龟背竹', 琴叶榕: '琴叶榕' },
  fertilizers: [
    { name: '花多多01', hidden: false },
    { name: '花多多02', hidden: false },
    { name: '奥绿A2', hidden: true },
  ],
};

// --- dates and queries ---

test('todayLocal formats a Date as YYYY-MM-DD in local time', () => {
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

test('entriesFor returns only that plant, newest first, notes included', () => {
  const got = entriesFor(LOG, '龟背竹');
  assert.deepEqual(got.map((e) => e.date), ['2026-09-03', '2026-08-30', '2026-08-02']);
  assert.deepEqual(entriesFor(LOG, 'nope'), []);
});

test('entriesFor keeps same-day entries in the order they were logged, newest first', () => {
  const log = [
    { p: 'a', date: '2026-09-01', fert: '早上' },
    { p: 'a', date: '2026-09-01', note: '晚上' },
  ];
  assert.deepEqual(entriesFor(log, 'a').map((e) => e.fert ?? e.note), ['晚上', '早上']);
});

test('lastFertEntry skips note-only entries', () => {
  assert.equal(lastFertEntry(LOG, '龟背竹').fert, '花多多01');
  assert.equal(lastFertEntry(LOG, 'nope'), null);
});

test('lastNoteEntry finds the newest entry carrying a note, fertilized or not', () => {
  assert.equal(lastNoteEntry(LOG, '龟背竹').note, '发现有虫');
  assert.equal(lastNoteEntry(LOG, '琴叶榕'), null);
});

// --- fertilizer list ---

test('visibleFertilizers drops hidden ones and can exclude the big-button one', () => {
  assert.deepEqual(visibleFertilizers(CONFIG), ['花多多01', '花多多02']);
  assert.deepEqual(visibleFertilizers(CONFIG, '花多多01'), ['花多多02']);
});

test('addFertilizer appends without mutating the input', () => {
  const next = addFertilizer(CONFIG, '磷酸二氢钾');
  assert.deepEqual(visibleFertilizers(next), ['花多多01', '花多多02', '磷酸二氢钾']);
  assert.equal(CONFIG.fertilizers.length, 3, 'original config must not be mutated');
});

test('addFertilizer un-hides an existing hidden name instead of duplicating it', () => {
  const next = addFertilizer(CONFIG, '奥绿A2');
  assert.equal(next.fertilizers.length, 3);
  assert.deepEqual(visibleFertilizers(next), ['花多多01', '花多多02', '奥绿A2']);
});

test('addFertilizer rejects blank and duplicate-visible names', () => {
  assert.throws(() => addFertilizer(CONFIG, '   '), /名字不能为空/);
  assert.throws(() => addFertilizer(CONFIG, null), /名字不能为空/);
  assert.throws(() => addFertilizer(CONFIG, '花多多01'), /已经有了/);
});

test('hideFertilizer only flags it hidden, leaving history alone', () => {
  const next = hideFertilizer(CONFIG, '花多多01');
  assert.deepEqual(visibleFertilizers(next), ['花多多02']);
  assert.equal(next.fertilizers.find((f) => f.name === '花多多01').hidden, true);
});

test('countFertilizerUses counts matching history entries', () => {
  assert.equal(countFertilizerUses(LOG, '花多多01'), 1);
  assert.equal(countFertilizerUses(LOG, '没用过的肥'), 0);
});

test('renameFertilizer with alsoHistory=false leaves the log untouched', () => {
  const { config, log } = renameFertilizer(CONFIG, LOG, '花多多01', '花多多通用型', false);
  assert.ok(visibleFertilizers(config).includes('花多多通用型'));
  assert.equal(countFertilizerUses(log, '花多多01'), 1);
});

test('renameFertilizer with alsoHistory=true rewrites the log, keeping notes', () => {
  const { log } = renameFertilizer(CONFIG, LOG, '花多多01', '花多多通用型', true);
  assert.equal(countFertilizerUses(log, '花多多01'), 0);
  const renamed = log.find((e) => e.fert === '花多多通用型');
  assert.equal(renamed.note, '新叶有点黄');
});

test('renaming onto a hidden name explains that it was deleted', () => {
  assert.throws(() => renameFertilizer(CONFIG, LOG, '花多多01', '奥绿A2', false), /以前删掉过/);
  assert.throws(() => renameFertilizer(CONFIG, LOG, '花多多01', '花多多02', false), /已经有了/);
});

// --- plants and entries ---

test('parsePlantId reads ?p= and URL-decodes it', () => {
  assert.equal(parsePlantId('?p=龟背竹'), '龟背竹');
  assert.equal(parsePlantId('?p=%E9%BE%9F&x=1'), '龟');
  assert.equal(parsePlantId(''), null);
  assert.equal(parsePlantId('?p=  '), null);
});

test('addPlant registers a new id and rejects blanks and duplicates', () => {
  const next = addPlant(CONFIG, '文竹', '文竹');
  assert.equal(next.plants['文竹'], '文竹');
  assert.equal(CONFIG.plants['文竹'], undefined);
  assert.throws(() => addPlant(CONFIG, 'x', '  '), /名字不能为空/);
  assert.throws(() => addPlant(CONFIG, '龟背竹', '别的名'), /已经登记/);
});

test('renamePlant changes only the display name, keeping the id', () => {
  const next = renamePlant(CONFIG, '龟背竹', ' 龟背竹（阳台） ');
  assert.equal(next.plants['龟背竹'], '龟背竹（阳台）');
  assert.equal(CONFIG.plants['龟背竹'], '龟背竹');
  assert.throws(() => renamePlant(CONFIG, '龟背竹', ''), /名字不能为空/);
  assert.throws(() => renamePlant(CONFIG, '没登记', '名'), /没登记/);
});

test('addEntry stores fert and a trimmed note, omitting empty fields', () => {
  const both = addEntry(LOG, '龟背竹', '2026-09-06', '花多多01', '  稀释1000倍 ');
  assert.deepEqual(both.at(-1), { p: '龟背竹', date: '2026-09-06', fert: '花多多01', note: '稀释1000倍' });

  const fertOnly = addEntry(LOG, '龟背竹', '2026-09-06', '花多多01', '   ');
  assert.deepEqual(fertOnly.at(-1), { p: '龟背竹', date: '2026-09-06', fert: '花多多01' });

  const noteOnly = addEntry(LOG, '龟背竹', '2026-09-06', null, '发现有虫');
  assert.deepEqual(noteOnly.at(-1), { p: '龟背竹', date: '2026-09-06', note: '发现有虫' });

  assert.equal(LOG.length, 4, 'original log must not be mutated');
});

test('addEntry refuses an entry with neither fertilizer nor note', () => {
  assert.throws(() => addEntry(LOG, '龟背竹', '2026-09-06', null, '  '), /备注不能为空/);
});

test('plantOverview sorts by days since last fertilizing, ignoring note-only entries', () => {
  const config = addPlant(CONFIG, '文竹', '文竹');
  const rows = plantOverview(config, LOG, '2026-09-06');
  assert.deepEqual(rows.map((r) => r.id), ['文竹', '龟背竹', '琴叶榕']);
  assert.deepEqual(rows[0], { id: '文竹', name: '文竹', lastDate: null, lastFert: null, days: null });
  assert.equal(rows[1].days, 7, 'the 9/03 note must not reset the count');
  assert.equal(rows[2].days, 4);
});

test('plantOverview keeps every plant when several have never been fertilized', () => {
  let config = CONFIG;
  for (const id of ['a', 'b', 'c', 'd']) config = addPlant(config, id, `植物${id}`);
  const rows = plantOverview(config, LOG, '2026-09-06');
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.slice(-2).map((r) => r.id), ['龟背竹', '琴叶榕']);
});

// --- base64 ---

test('base64 round-trips Chinese text and tolerates GitHub newlines', () => {
  const s = JSON.stringify({ name: '龟背竹', fert: '磷酸二氢钾' });
  assert.equal(decodeBase64Utf8(encodeBase64Utf8(s)), s);
  assert.throws(() => btoa('龟背竹'), 'sanity check: raw btoa is the trap we avoid');
  const wrapped = encodeBase64Utf8('龟背竹').replace(/(.{4})/g, '$1\n');
  assert.equal(decodeBase64Utf8(wrapped), '龟背竹');
});

test('bytesToBase64 / base64ToBytes round-trip binary data', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
  const back = base64ToBytes(bytesToBase64(bytes));
  assert.deepEqual(back, bytes);
});

// --- backfill dates and deleting entries ---

test('checkLogDate accepts today and past days but rejects the future', () => {
  assert.doesNotThrow(() => checkLogDate('2026-10-05', '2026-10-05'));
  assert.doesNotThrow(() => checkLogDate('2026-10-03', '2026-10-05'));
  assert.throws(() => checkLogDate('2026-10-06', '2026-10-05'), /日期选错了/);
  assert.throws(() => checkLogDate('', '2026-10-05'), /日期/);
});

test('a backfilled entry sorts into place and updates the days count', () => {
  const log = addEntry(LOG, '琴叶榕', '2026-09-04', '花多多10');
  assert.equal(lastFertEntry(log, '琴叶榕').fert, '花多多10');
  assert.equal(plantOverview(CONFIG, log, '2026-09-06').find((r) => r.id === '琴叶榕').days, 2);
  const older = addEntry(LOG, '琴叶榕', '2026-08-01', '花多多10');
  assert.equal(lastFertEntry(older, '琴叶榕').fert, '磷酸二氢钾', 'an older backfill must not become "last"');
});

test('deleteEntry removes the matching entry by content without mutating the input', () => {
  const next = deleteEntry(LOG, { p: '龟背竹', date: '2026-08-30', fert: '花多多01', note: '新叶有点黄' });
  assert.equal(next.length, 3);
  assert.equal(next.some((e) => e.date === '2026-08-30'), false);
  assert.equal(LOG.length, 4);
});

test('deleteEntry tells note-only and fertilizer entries apart', () => {
  const log = [
    { p: 'a', date: '2026-10-01', fert: '花多多01' },
    { p: 'a', date: '2026-10-01', fert: '花多多01', note: '稀释' },
  ];
  assert.deepEqual(deleteEntry(log, { p: 'a', date: '2026-10-01', fert: '花多多01' }), [log[1]]);
});

test('deleteEntry removes only one of two identical entries', () => {
  const e = { p: 'a', date: '2026-10-01', fert: '花多多01' };
  assert.equal(deleteEntry([e, { ...e }], e).length, 1);
});

test('deleteEntry explains when the entry is already gone', () => {
  assert.throws(() => deleteEntry(LOG, { p: '龟背竹', date: '2000-01-01', fert: 'x' }), /已经不在了/);
});

// --- avatar crop ---

test('avatarLayout with no crop fills the circle and centers the photo', () => {
  // Portrait 800x1000 into a 100px circle: short side fits exactly.
  const l = avatarLayout(800, 1000, 100, null);
  assert.equal(l.width, 100);
  assert.equal(l.height, 125);
  assert.equal(l.left, 0);
  assert.equal(l.top, -12.5);
});

test('avatarLayout zooms around the chosen center', () => {
  const l = avatarLayout(800, 800, 100, { zoom: 2, x: 0.25, y: 0.75 });
  assert.equal(l.width, 200);
  assert.equal(l.left, 0, 'x=0.25 at zoom 2 puts the left edge at the circle edge');
  assert.equal(l.top, -100);
});

test('avatarLayout never leaves a gap inside the circle', () => {
  const l = avatarLayout(800, 800, 100, { zoom: 2, x: 0, y: 1 });
  assert.equal(l.left, 0);
  assert.equal(l.top, -100);
});

test('clampCrop keeps zoom in 1-4 and the center where the circle stays covered', () => {
  assert.deepEqual(clampCrop(800, 800, { zoom: 9, x: 0.5, y: 0.5 }), { zoom: 4, x: 0.5, y: 0.5 });
  assert.deepEqual(clampCrop(800, 800, { zoom: 0.2, x: 0.9, y: 0.1 }), { zoom: 1, x: 0.5, y: 0.5 });
  // Zoom 2 on a square: the visible half can slide between 0.25 and 0.75.
  assert.deepEqual(clampCrop(800, 800, { zoom: 2, x: 0, y: 1 }), { zoom: 2, x: 0.25, y: 0.75 });
});

test('setAvatarCrop stores a crop per plant and null removes it', () => {
  const withCrop = setAvatarCrop(CONFIG, '龟背竹', { zoom: 1.5, x: 0.4, y: 0.6 });
  assert.deepEqual(withCrop.avatars['龟背竹'], { zoom: 1.5, x: 0.4, y: 0.6 });
  assert.equal(CONFIG.avatars, undefined, 'original config must not be mutated');
  const rounded = setAvatarCrop(CONFIG, '龟背竹', { zoom: 3.3333333333, x: 0.42307692, y: 0.5615384 });
  assert.deepEqual(rounded.avatars['龟背竹'], { zoom: 3.3333, x: 0.4231, y: 0.5615 });
  const cleared = setAvatarCrop(withCrop, '龟背竹', null);
  assert.equal(cleared.avatars['龟背竹'], undefined);
});

test('changeEntryDate moves one matching entry to a new date, keeping its other fields', () => {
  const target = { p: '龟背竹', date: '2026-08-30', fert: '花多多01', note: '新叶有点黄' };
  const next = changeEntryDate(LOG, target, '2026-08-28');
  const moved = next.filter((e) => e.date === '2026-08-28');
  assert.deepEqual(moved, [{ ...target, date: '2026-08-28' }]);
  assert.equal(next.length, LOG.length);
  assert.equal(LOG[2].date, '2026-08-30', 'original log must not be mutated');
});

test('changeEntryDate changes only one of two identical entries', () => {
  const e = { p: 'a', date: '2026-10-05', fert: 'HB101' };
  const next = changeEntryDate([e, { ...e }], e, '2026-10-03');
  assert.deepEqual(next.map((x) => x.date).sort(), ['2026-10-03', '2026-10-05']);
});

test('changeEntryDate explains when the entry is already gone', () => {
  assert.throws(() => changeEntryDate(LOG, { p: 'x', date: '2000-01-01' }, '2026-01-01'), /已经不在了/);
});
