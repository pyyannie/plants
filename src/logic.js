// Pure functions only: no DOM, no network. Everything here is unit-tested in node.
// Every function returns new data and never mutates its input, so the caller can
// fall back to the old value when a GitHub write fails.

// --- dates and queries ---

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

// All entries for one plant, newest first. Entries on the same day keep their
// logging order (later in the array = newer), since dates carry no time of day.
export function entriesFor(log, plantId) {
  return log
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.p === plantId)
    .sort((a, b) => (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : b.i - a.i))
    .map(({ e }) => e);
}

// Newest entry that actually applied fertilizer; note-only entries are skipped
// so "N days ago" is not reset by a note.
export function lastFertEntry(log, plantId) {
  return entriesFor(log, plantId).find((e) => e.fert) ?? null;
}

// Newest entry carrying a note, whether or not it also applied fertilizer.
export function lastNoteEntry(log, plantId) {
  return entriesFor(log, plantId).find((e) => e.note) ?? null;
}

// --- fertilizer list ---

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
    fertilizers: config.fertilizers.map((f) => (f.name === name ? { ...f, hidden: true } : f)),
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
    // A hidden clash is invisible to the user, so "already exists" would look like a lie.
    throw new Error(
      clash.hidden ? `「${newName}」以前删掉过，先用＋把它加回来` : `「${newName}」已经有了`
    );
  }

  const nextConfig = {
    ...config,
    fertilizers: config.fertilizers.map((f) => (f.name === oldName ? { ...f, name: newName } : f)),
  };
  const nextLog = alsoHistory
    ? log.map((e) => (e.fert === oldName ? { ...e, fert: newName } : e))
    : log;

  return { config: nextConfig, log: nextLog };
}

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

// Changes only the display name. The id is baked into the NFC tag's URL and
// keys the photo and log entries, so it never changes.
export function renamePlant(config, id, rawName) {
  const name = (rawName ?? '').trim();
  if (!name) throw new Error('名字不能为空');
  if (!config.plants[id]) throw new Error(`「${id}」还没登记`);
  return { ...config, plants: { ...config.plants, [id]: name } };
}

// fert and note are both optional, but at least one is required. A missing
// fert means "note only, no fertilizer applied". Empty fields are omitted
// rather than stored as null so log.json stays readable.
export function addEntry(log, plantId, date, fert, rawNote = '') {
  const note = (rawNote ?? '').trim();
  if (!fert && !note) throw new Error('备注不能为空');
  const entry = { p: plantId, date };
  if (fert) entry.fert = fert;
  if (note) entry.note = note;
  return [...log, entry];
}

// Backfilling a past day is allowed; a future day is always a mis-pick.
// The date picker is left unrestricted on purpose: Annie wants a loud error
// rather than a picker that silently refuses.
export function checkLogDate(date, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('日期格式不对');
  if (date > todayIso) {
    throw new Error(`${formatShortDate(date)} 还没到，日期选错了`);
  }
}

const sameEntry = (a, b) =>
  a.p === b.p &&
  a.date === b.date &&
  (a.fert ?? null) === (b.fert ?? null) &&
  (a.note ?? null) === (b.note ?? null);

// Removes one entry equal to target. Matching by content rather than array
// index keeps the delete correct when update() re-applies it to fresh data
// after a conflict, where indexes may have shifted.
export function deleteEntry(log, target) {
  const i = log.findLastIndex((e) => sameEntry(e, target));
  if (i === -1) throw new Error('这条记录已经不在了，可能在别的手机上删过');
  return [...log.slice(0, i), ...log.slice(i + 1)];
}

// One row per plant, most overdue first. Plants never fertilized sort to the
// very top -- those are the ones most likely to have been forgotten.
export function plantOverview(config, log, todayIso) {
  return Object.entries(config.plants)
    .map(([id, name]) => {
      const last = lastFertEntry(log, id);
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
      // returns NaN makes sort order implementation-defined.
      const av = a.days ?? Infinity;
      const bv = b.days ?? Infinity;
      return av === bv ? 0 : bv - av;
    });
}

// --- base64 ---
// btoa/atob only handle Latin-1, so plain btoa('龟背竹') throws. Convert through
// bytes explicitly. btoa/atob and TextEncoder/TextDecoder exist in browsers and
// in Node, so these are testable without a DOM.

export function bytesToBase64(bytes) {
  // Build the binary string in chunks: one char at a time is slow for a 100 KB
  // photo, and spreading the whole array at once overflows the call stack.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  // The API returns base64 wrapped in newlines; atob rejects them.
  const binary = atob(b64.replace(/\s/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function encodeBase64Utf8(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

export function decodeBase64Utf8(b64) {
  return new TextDecoder().decode(base64ToBytes(b64));
}

// --- avatar crop ---
// A crop is { zoom, x, y }: zoom 1 means the short side of the photo just fills
// the circle; x/y are the circle's center as a fraction of the photo's width and
// height. Only these numbers are stored, never a cropped copy, so the full photo
// stays available and the avatar can be re-adjusted any time.

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Keeps zoom in range and the center far enough from the edges that the circle
// is always fully covered by the photo. Independent of the circle's pixel size.
export function clampCrop(w, h, crop) {
  const zoom = clamp(crop?.zoom ?? 1, MIN_ZOOM, MAX_ZOOM);
  const short = Math.min(w, h);
  const halfX = short / (w * zoom) / 2;
  const halfY = short / (h * zoom) / 2;
  return {
    zoom,
    x: clamp(crop?.x ?? 0.5, halfX, 1 - halfX),
    y: clamp(crop?.y ?? 0.5, halfY, 1 - halfY),
  };
}

// Pixel size and offset for a w x h photo inside a circle of `size` px.
export function avatarLayout(w, h, size, crop) {
  const { zoom, x, y } = clampCrop(w, h, crop);
  const scale = (size / Math.min(w, h)) * zoom;
  const width = w * scale;
  const height = h * scale;
  return { width, height, left: size / 2 - x * width, top: size / 2 - y * height };
}

export function setAvatarCrop(config, id, crop) {
  const avatars = { ...(config.avatars ?? {}) };
  // Four decimals is far finer than a pixel and keeps config.json readable.
  const round = (v) => Math.round(v * 10000) / 10000;
  if (crop) avatars[id] = { zoom: round(crop.zoom), x: round(crop.x), y: round(crop.y) };
  else delete avatars[id];
  return { ...config, avatars };
}
