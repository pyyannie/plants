import { GitHubStore } from './github.js';
import {
  todayLocal, formatShortDate, daysSince, entriesFor, lastFertEntry, lastNoteEntry,
  visibleFertilizers, addFertilizer, hideFertilizer, countFertilizerUses, renameFertilizer,
  parsePlantId, addPlant, renamePlant, addEntry, plantOverview, checkLogDate, deleteEntry,
  avatarLayout, clampCrop, setAvatarCrop, changeEntryDate,
} from './logic.js';

const TOKEN_KEY = 'plants.token';
const PHOTO_MAX_WIDTH = 800;
const PHOTO_QUALITY = 0.7;

// Used until the data repo has its own config.json; the first write creates it.
const DEFAULT_CONFIG = {
  plants: {},
  fertilizers: ['花多多01', '花多多02', '花多多08', '花多多10', '磷酸二氢钾', '缓释肥', 'HB101']
    .map((name) => ({ name, hidden: false })),
};

const app = document.getElementById('app');

let createStore;
let skipToken;
let store;
const state = {
  config: null,
  log: [],
  plantId: null,
  editing: false,
  busy: false,
  noteDraft: '',
  // null = today. Holds a YYYY-MM-DD only while backfilling a past day.
  logDate: null,
  // True while a photo is on its way to GitHub.
  uploading: false,
};
// plant id -> { url, w, h }, or null when the plant is known to have no photo.
const photos = new Map();

// Tiny element builder: h('button', { class: 'x', onclick }, 'text', child, ...).
// Children that are null/false are skipped, which keeps conditional markup terse.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Same child rules as h(): arrays are flattened and null/false are skipped,
// so views can pass `cond && el` and mapped lists straight in.
function mount(...nodes) {
  app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
  // Plain gradient by default; renderPlant() swaps in the plant's photo.
  setBackdrop(null);
}

let toastTimer;
function toast(text, isError = false) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: isError ? 'toast error' : 'toast' }, text);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 2000);
}

// A big blocking notice for mistakes that must not slip by, unlike a toast.
function modal(title, text) {
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', role: 'alertdialog' },
      h('div', { class: 'modal-title' }, title),
      h('p', {}, text),
      h('button', { onclick: close }, '知道了'),
    ),
  );
  document.body.append(backdrop);
}

function daysText(days) {
  return days === 0 ? '今天' : `${days} 天前`;
}

function plantName(id) {
  return state.config.plants[id];
}

function goHome() {
  location.href = location.pathname;
}

// --- token setup ---

function renderSetup(errorText = '') {
  // Marked up as a standard username + password login so iOS offers to save the
  // token in the Passwords app (encrypted, Face ID to fill) and autofills it
  // after Safari's 7-day storage purge. The fixed username only gives the saved
  // entry a name; it is visually hidden but must not be display:none or
  // type=hidden, which Safari ignores.
  const username = h('input', {
    type: 'text',
    name: 'username',
    autocomplete: 'username',
    value: 'plants',
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  const input = h('input', {
    type: 'password',
    name: 'password',
    placeholder: 'github_pat_…',
    autocomplete: 'current-password',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  const error = h('div', { class: 'error', hidden: !errorText }, errorText);
  const save = h('button', { type: 'submit' }, '保存');

  async function onSubmit(e) {
    e.preventDefault();
    const token = input.value.trim();
    if (!token) return;
    save.disabled = true;
    save.textContent = '验证中…';
    error.hidden = true;
    try {
      // Never store a token that has not been proven to work against the data repo.
      await createStore(token).checkAccess();
      localStorage.setItem(TOKEN_KEY, token);
      // start() replaces the form; Safari treats a submitted form disappearing
      // as a successful login and offers to save it. A failed check leaves the
      // form in place, so a bad token is not offered for saving.
      start();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      save.disabled = false;
      save.textContent = '保存';
    }
  }

  mount(
    h('h1', {}, '🌱 植物施肥记录'),
    h('form', { class: 'card', method: 'post', action: '#', onsubmit: onSubmit },
      h('p', {}, '需要贴一下 GitHub token。'),
      h('p', { class: 'muted small' },
        '保存后 iPhone 会问要不要存储密码，点「存储」。以后 token 被清掉（7 天没打开或清了历史记录），点输入框选「plants」、刷一下 Face ID 就能填回来，数据不会丢。'),
      username,
      input,
      save,
      error,
    ),
  );
}

function clearToken() {
  if (!confirm('清除这台手机上的 token？之后要重新贴一次。')) return;
  localStorage.removeItem(TOKEN_KEY);
  location.href = location.pathname;
}

function renderLoadError(message) {
  mount(
    h('h1', {}, '🌱 植物施肥记录'),
    h('div', { class: 'error' }, `读取数据失败：${message}`),
    h('div', { class: 'footer-actions' },
      h('button', { onclick: start }, '🔄 重试'),
      !skipToken && h('button', { onclick: clearToken }, '🔑 换 token'),
    ),
  );
}

// --- photo ---

const AVATAR_SIZE = 104; // keep in sync with .avatar in style.css

async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, PHOTO_MAX_WIDTH / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('照片压缩失败'))),
        'image/jpeg',
        PHOTO_QUALITY,
      ),
    );
    return { blob, w: canvas.width, h: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The crop math needs the photo's pixel size, which only decoding reveals.
async function photoFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { url, w: img.naturalWidth, h: img.naturalHeight };
}

// Reloading or closing the page mid-upload silently drops the photo, so ask first.
function warnBeforeLeaving(e) {
  e.preventDefault();
  e.returnValue = '';
}

function pickPhoto(id) {
  if (state.uploading) return;
  // Kept in the DOM until used: iOS Safari can drop a detached file input
  // before its change event fires.
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
  document.body.append(input);
  input.addEventListener('change', async () => {
    input.remove();
    const file = input.files?.[0];
    if (!file) return;
    const previous = photos.get(id) ?? null;
    let saved = false;
    state.uploading = true;
    window.addEventListener('beforeunload', warnBeforeLeaving);
    try {
      const { blob, w, h: height } = await compressPhoto(file);
      // Show the local copy straight away, under an "uploading" overlay.
      photos.set(id, { url: URL.createObjectURL(blob), w, h: height });
      refreshPhoto(id);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await store.writeBinary(`photos/${id}.jpg`, bytes, `Photo ${id}`);
      if (previous) URL.revokeObjectURL(previous.url);
      saved = true;
      toast('✅ 照片已保存');
    } catch (e) {
      photos.set(id, previous);
      modal('⚠️ 照片没存上', `${e.message}。照片已经退回原来那张，可以再换一次。`);
    } finally {
      state.uploading = false;
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      refreshPhoto(id);
    }
    if (!saved) return;
    // The old crop was framed for the old photo; drop it, then let the user frame the new one.
    if (state.config.avatars?.[id]) {
      await saveConfig((cfg) => setAvatarCrop(cfg, id, null), `Reset avatar crop ${id}`);
      refreshPhoto(id);
    }
    openCropper(id);
  });
  input.click();
}

async function loadPhoto(id) {
  if (photos.has(id)) return;
  try {
    const file = await store.readBinary(`photos/${id}.jpg`);
    photos.set(id, file ? await photoFromBlob(new Blob([file.bytes], { type: 'image/jpeg' })) : null);
  } catch {
    // A failed photo read should not block logging; show the empty slot.
    photos.set(id, null);
  }
  refreshPhoto(id);
}

// Swap just the avatar header so a late-arriving photo does not wipe the note box.
function refreshPhoto(id) {
  if (state.plantId !== id) return;
  document.querySelector('.hero')?.replaceWith(heroBlock(id));
  setBackdrop(photos.get(id)?.url ?? null);
}

// The page background is a blurred copy of the plant's photo, or a green
// gradient when there is none. It sits outside #app so mount() leaves it alone.
function setBackdrop(url) {
  let el = document.querySelector('.backdrop');
  if (!el) {
    el = h('div', { class: 'backdrop' });
    document.body.prepend(el);
  }
  el.style.backgroundImage = url ? `url("${url}")` : '';
  el.classList.toggle('plain', !url);
}

function cropStyle(photo, size, crop, offset = 0) {
  const l = avatarLayout(photo.w, photo.h, size, crop);
  return `width:${l.width}px;height:${l.height}px;left:${offset + l.left}px;top:${offset + l.top}px`;
}

// Round avatar beside the name: a small circle hides how near or far each photo
// was taken, so 30+ plants look consistent. Tap it for the full photo, or in
// edit mode to re-frame it.
function heroBlock(id) {
  const { editing, uploading } = state;
  const name = plantName(id);
  const photo = photos.get(id);
  let avatar;
  if (!photos.has(id)) {
    avatar = h('div', { class: 'avatar empty' }, '…');
  } else if (!photo) {
    avatar = h('button', { class: 'avatar empty', onclick: () => pickPhoto(id), 'aria-label': '加照片' },
      h('span', { class: 'icon' }, '📷'),
      '加照片',
    );
  } else {
    avatar = h('button', {
      class: 'avatar',
      onclick: () => (editing && !uploading ? openCropper(id) : showPhoto(photo.url, name)),
      'aria-label': editing ? '调整头像' : '看大图',
    },
      h('img', { src: photo.url, alt: name, style: cropStyle(photo, AVATAR_SIZE, state.config.avatars?.[id]) }),
      uploading && h('span', { class: 'uploading' }, '⏳'),
    );
  }
  return h('div', { class: 'hero' },
    h('div', { class: 'avatar-wrap' },
      avatar,
      editing && photo && !uploading &&
        h('button', { class: 'change', onclick: () => pickPhoto(id), 'aria-label': '换照片' }, '📷'),
    ),
    h('div', { class: 'hero-right' },
      h('h1', {}, name),
      uploading && h('p', { class: 'uploading-note' }, '⏳ 照片上传中，别关页面'),
      editing && photo && !uploading && h('p', { class: 'uploading-note' }, '点头像调整大小和位置'),
      h('div', { class: 'hero-actions' },
        editing && h('button', { class: 'rename', onclick: onRenamePlant, 'aria-label': '改名' }, '✏️ 改名'),
        h('button', {
          class: editing ? 'edit-toggle on' : 'edit-toggle',
          onclick: () => { state.editing = !state.editing; renderPlant(); },
        }, editing ? '完成' : '✏️ 编辑'),
      ),
    ),
  );
}

// Full photo over the page; tap anywhere to close.
function showPhoto(url, name) {
  const backdrop = h('div', { class: 'lightbox', onclick: () => backdrop.remove() },
    h('img', { src: url, alt: name }),
    h('p', {}, '点任意位置关闭'),
  );
  document.body.append(backdrop);
}

// Pinch to zoom, drag to move, or use the slider. Only { zoom, x, y } is saved
// to config.json; the photo itself is never cropped.
function openCropper(id) {
  const photo = photos.get(id);
  if (!photo) return;
  const size = Math.min(260, window.innerWidth - 110);
  const pad = 24;
  let crop = clampCrop(photo.w, photo.h, state.config.avatars?.[id]);

  const img = h('img', { src: photo.url, alt: '' });
  const slider = h('input', {
    type: 'range', min: 1, max: 4, step: 0.01, value: crop.zoom, 'aria-label': '缩放',
    oninput: () => {
      crop = clampCrop(photo.w, photo.h, { ...crop, zoom: Number(slider.value) });
      place();
    },
  });
  function place() {
    img.setAttribute('style', cropStyle(photo, size, crop, pad));
    slider.value = crop.zoom;
  }

  const stage = h('div', { class: 'crop-stage', style: `width:${size + pad * 2}px;height:${size + pad * 2}px` },
    img,
    h('div', { class: 'crop-ring', style: `left:${pad}px;top:${pad}px;width:${size}px;height:${size}px` }),
  );
  const pointers = new Map();
  let lastDist = null;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastDist = null;
  });
  stage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      // Dragging moves the photo, so the circle's center moves the opposite way.
      const { width, height } = avatarLayout(photo.w, photo.h, size, crop);
      crop = clampCrop(photo.w, photo.h, {
        ...crop,
        x: crop.x - (cur.x - prev.x) / width,
        y: crop.y - (cur.y - prev.y) / height,
      });
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist) crop = clampCrop(photo.w, photo.h, { ...crop, zoom: crop.zoom * (dist / lastDist) });
      lastDist = dist;
    }
    place();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    lastDist = null;
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  const close = () => backdrop.remove();
  const save = h('button', {
    class: 'primary',
    onclick: async () => {
      save.disabled = true;
      save.textContent = '保存中…';
      if (await saveConfig((cfg) => setAvatarCrop(cfg, id, crop), `Crop avatar ${id}`)) {
        close();
        toast('✅ 头像已调整');
        refreshPhoto(id);
        return;
      }
      save.disabled = false;
      save.textContent = '保存';
    },
  }, '保存');

  const backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal cropper', role: 'dialog' },
      h('div', { class: 'modal-title' }, '调整头像'),
      h('p', {}, '双指捏合放大缩小，单指拖动挪位置'),
      stage,
      h('label', { class: 'zoom-row' }, '🔍', slider),
      h('div', { class: 'modal-actions' },
        h('button', { onclick: close }, '取消'),
        save,
      ),
    ),
  );
  document.body.append(backdrop);
  place();
}

// --- single plant ---

function renderPlant() {
  const id = state.plantId;
  const { config, log, editing } = state;
  const lastFert = lastFertEntry(log, id);
  const lastNote = lastNoteEntry(log, id);
  const bigName = lastFert && visibleFertilizers(config).includes(lastFert.fert) ? lastFert.fert : null;

  const statusItems = [];
  if (lastFert) {
    statusItems.push(h('div', { class: 'status-item' },
      h('div', { class: 'status-label' },
        `🌱 上次施肥 · ${formatShortDate(lastFert.date)} · ${daysText(daysSince(lastFert.date, todayLocal()))}`),
      h('div', { class: 'status-value' }, lastFert.fert),
      // Same entry carries the newest note: show it here instead of repeating it below.
      lastNote === lastFert && h('div', { class: 'status-note' }, `📝 ${lastNote.note}`),
    ));
  }
  if (lastNote && lastNote !== lastFert) {
    statusItems.push(h('div', { class: 'status-item' },
      h('div', { class: 'status-label' }, `📝 最新备注 · ${formatShortDate(lastNote.date)}`),
      h('div', { class: 'status-note' }, lastNote.note),
    ));
  }
  if (!statusItems.length) {
    statusItems.push(h('div', { class: 'status-item muted' }, '还没有记录'));
  }

  const noteBox = h('textarea', {
    placeholder: '比如：稀释1000倍、叶子发黄',
    value: state.noteDraft,
    oninput: () => {
      state.noteDraft = noteBox.value;
      okButton.disabled = state.busy || !noteBox.value.trim();
    },
  });
  const okButton = h('button', {
    class: 'note-ok',
    disabled: state.busy || !state.noteDraft.trim(),
    onclick: () => logEntry(null),
  }, 'OK');

  const fertButtons = editing
    ? visibleFertilizers(config).map((name) => h('div', { class: 'cell' },
        // No click handler: in edit mode tapping a fertilizer must not log it.
        h('button', {}, name),
        h('button', { class: 'corner rename-f', onclick: () => onRenameFertilizer(name), 'aria-label': '改名' }, '✏️'),
        h('button', { class: 'corner hide-f', onclick: () => onHideFertilizer(name), 'aria-label': '删除' }, '🗑'),
      ))
    : visibleFertilizers(config, bigName).map((name) =>
        h('button', { disabled: state.busy, onclick: () => logEntry(name) }, name));

  mount(
    heroBlock(id),
    h('div', { class: 'status' }, statusItems),
    // Above the buttons: the order of use is pick a date, then tap a fertilizer.
    !editing && dateRow(),
    editing && h('p', { class: 'muted small', style: 'margin-top:20px' }, '编辑中：点按钮不会打卡'),
    !editing && bigName && h('button', {
      class: 'repeat',
      disabled: state.busy,
      onclick: () => logEntry(bigName),
    }, bigName),
    h('div', { class: 'grid' },
      fertButtons,
      h('button', { class: 'add', onclick: onAddFertilizer, 'aria-label': '加肥料' }, '＋'),
    ),
    !editing && h('label', { class: 'note-label' }, '备注（可不填）'),
    !editing && h('div', { class: 'note-row' }, noteBox, okButton),
    h('h2', {}, '历史'),
    historyList(id),
    h('div', { class: 'footer-actions' },
      h('button', { onclick: goHome }, '🏠 全部植物'),
      editing && !skipToken && h('button', { onclick: clearToken }, '🔑 换 token'),
    ),
  );
  setBackdrop(photos.get(id)?.url ?? null);
  loadPhoto(id);
}

// The native date input sits invisibly on top of the row, so tapping anywhere
// opens the iOS date wheel while the row shows our own wording.
function dateRow() {
  const today = todayLocal();
  const date = state.logDate ?? today;
  const backfilling = date !== today;
  const input = h('input', {
    type: 'date',
    class: 'date-input',
    value: date,
    'aria-label': '记录日期',
    onchange: () => {
      const picked = input.value || today;
      try {
        checkLogDate(picked, todayLocal());
      } catch (e) {
        modal('⚠️ 日期选错了', `${e.message}。日期已经改回今天，这一笔没有记录。`);
        state.logDate = null;
        renderPlant();
        return;
      }
      state.logDate = picked === todayLocal() ? null : picked;
      renderPlant();
    },
  });
  return h('label', { class: backfilling ? 'date-row past' : 'date-row' },
    backfilling
      ? `📅 记在 ${formatShortDate(date)}（不是今天）`
      : `📅 日期：今天 ${formatShortDate(today)}`,
    h('span', { class: 'chevron' }, '▾'),
    input,
  );
}

function historyList(id) {
  const entries = entriesFor(state.log, id);
  if (!entries.length) return h('p', { class: 'muted small' }, '还没有记录');
  return h('ul', { class: 'history' }, entries.map((e) =>
    h('li', {},
      state.editing
        ? h('label', { class: 'date editable' },
            formatShortDate(e.date),
            h('input', {
              type: 'date',
              class: 'date-input',
              value: e.date,
              'aria-label': '改这条的日期',
              onchange: (ev) => onChangeEntryDate(e, ev.target.value),
            }),
          )
        : h('span', { class: 'date' }, formatShortDate(e.date)),
      h('span', { class: 'what' },
        e.fert && h('span', { class: 'fert' }, e.fert),
        e.note && (e.fert ? h('span', { class: 'note' }, e.note) : `📝 ${e.note}`),
      ),
      state.editing && h('button', {
        class: 'del',
        onclick: () => onDeleteEntry(e),
        'aria-label': '删除这条记录',
      }, '🗑'),
    ),
  ));
}

async function onChangeEntryDate(entry, date) {
  if (!date || date === entry.date) return;
  try {
    checkLogDate(date, todayLocal());
  } catch (e) {
    modal('⚠️ 日期选错了', `${e.message}。这条记录的日期没有改。`);
    renderPlant();
    return;
  }
  const name = plantName(state.plantId);
  try {
    state.log = await store.update(
      'log.json', [],
      (log) => changeEntryDate(log, entry, date),
      `Redate ${name} / ${entry.fert ?? 'note'} ${entry.date} -> ${date}`,
    );
    toast(`✅ 已改到 ${formatShortDate(date)}`);
  } catch (e) {
    toast(`没改成：${e.message}`, true);
  }
  renderPlant();
}

async function onDeleteEntry(entry) {
  const what = [entry.fert, entry.note && `📝 ${entry.note}`].filter(Boolean).join(' ');
  if (!confirm(`删掉这条记录？\n\n${formatShortDate(entry.date)}  ${what}`)) return;
  const name = plantName(state.plantId);
  try {
    state.log = await store.update(
      'log.json', [],
      (log) => deleteEntry(log, entry),
      `Delete ${name} / ${entry.date} / ${entry.fert ?? 'note'}`,
    );
    toast('✅ 已删除');
  } catch (e) {
    toast(`没删掉：${e.message}`, true);
  }
  renderPlant();
}

// fert === null means "note only".
async function logEntry(fert) {
  if (state.busy) return;
  const id = state.plantId;
  const note = state.noteDraft;
  const name = plantName(id);
  // Checked again at save time: the page may have stayed open past midnight
  // since the date was picked.
  const date = state.logDate ?? todayLocal();
  try {
    checkLogDate(date, todayLocal());
  } catch (e) {
    modal('⚠️ 日期选错了', `${e.message}。日期已经改回今天，这一笔没有记录。`);
    state.logDate = null;
    renderPlant();
    return;
  }
  state.busy = true;
  renderPlant();
  try {
    // Pass a function, not a precomputed array, so a conflict retry re-applies
    // this append on top of whatever another device just wrote.
    state.log = await store.update(
      'log.json', [],
      (log) => addEntry(log, id, date, fert, note),
      fert ? `Log ${name} / ${fert}` : `Note ${name}`,
    );
    state.noteDraft = '';
    // Back to today after every save so the next entry is not misdated by accident.
    state.logDate = null;
    toast('✅ 已记录');
  } catch (e) {
    // Keep the note text so the user can simply tap again.
    toast(`没存上：${e.message}`, true);
  } finally {
    state.busy = false;
    renderPlant();
  }
}

// Validate locally first so input errors show without a network round trip,
// then write via update() so the change is re-applied to fresh data on conflict.
async function saveConfig(changeFn, message) {
  try {
    changeFn(state.config);
  } catch (e) {
    toast(e.message, true);
    return false;
  }
  try {
    state.config = await store.update('config.json', DEFAULT_CONFIG, changeFn, message);
    return true;
  } catch (e) {
    toast(`没存上：${e.message}`, true);
    return false;
  }
}

async function onAddFertilizer() {
  // prompt() returns null on Cancel: bail out silently.
  const name = prompt('新肥料的名字');
  if (name === null) return;
  if (await saveConfig((cfg) => addFertilizer(cfg, name), `Add fertilizer ${name.trim()}`)) {
    toast('✅ 已添加');
    renderPlant();
  }
}

async function onHideFertilizer(name) {
  if (!confirm(`把「${name}」从按钮里拿掉？历史记录不受影响。`)) return;
  if (await saveConfig((cfg) => hideFertilizer(cfg, name), `Hide fertilizer ${name}`)) {
    toast('✅ 已拿掉');
    renderPlant();
  }
}

async function onRenameFertilizer(oldName) {
  const newName = prompt('改成什么名字？', oldName);
  if (newName === null) return;
  const uses = countFertilizerUses(state.log, oldName);
  const alsoHistory = uses > 0 && confirm(
    `历史里有 ${uses} 条「${oldName}」，也一起改成「${newName.trim()}」吗？\n\n确定 = 一起改（适合改错字）\n取消 = 历史保留旧名（适合换了牌子）`,
  );

  try {
    renameFertilizer(state.config, state.log, oldName, newName, alsoHistory);
  } catch (e) {
    toast(e.message, true);
    return;
  }

  const message = `Rename fertilizer ${oldName} to ${newName.trim()}`;
  if (alsoHistory) {
    // Two files: log first, then config. If the second write fails, say exactly
    // what state things are in rather than a generic failure.
    try {
      state.log = await store.update('log.json', [],
        (log) => renameFertilizer(state.config, log, oldName, newName, true).log, message);
    } catch (e) {
      toast(`没存上：${e.message}`, true);
      return;
    }
  }
  try {
    state.config = await store.update('config.json', DEFAULT_CONFIG,
      (cfg) => renameFertilizer(cfg, [], oldName, newName, false).config, message);
    toast('✅ 已改名');
  } catch (e) {
    toast(alsoHistory
      ? `历史已改，但按钮名没改成功，请再改一次：${e.message}`
      : `没存上：${e.message}`, true);
  }
  renderPlant();
}

async function onRenamePlant() {
  const id = state.plantId;
  const name = prompt('这盆叫什么？', plantName(id));
  if (name === null) return;
  if (await saveConfig((cfg) => renamePlant(cfg, id, name), `Rename plant ${id} to ${name.trim()}`)) {
    toast('✅ 已改名');
    renderPlant();
  }
}

// --- unregistered tag ---

function renderRegister() {
  const id = state.plantId;
  const input = h('input', { placeholder: '比如：龟背竹', value: id });
  const button = h('button', { onclick: onRegister }, '登记');

  async function onRegister() {
    button.disabled = true;
    button.textContent = '登记中…';
    if (await saveConfig((cfg) => addPlant(cfg, id, input.value), `Add plant ${input.value.trim()}`)) {
      renderPlant();
      return;
    }
    button.disabled = false;
    button.textContent = '登记';
  }

  mount(
    h('h1', {}, '🌱 新的一盆'),
    h('div', { class: 'card' },
      h('p', {}, '这盆还没名字，取一个？'),
      h('p', { class: 'muted small' }, `芯片代号：${id}。名字以后在编辑里可以改。`),
      input,
      button,
    ),
    h('div', { class: 'footer-actions' }, h('button', { onclick: goHome }, '🏠 全部植物')),
  );
}

// --- home overview ---

function renderHome() {
  const rows = plantOverview(state.config, state.log, todayLocal());
  const tagUrl = `${location.origin}${location.pathname}?p=植物名`;
  mount(
    h('h1', {}, '🌱 全部植物'),
    rows.length
      ? h('p', { class: 'muted small' }, '按距上次施肥的天数排序，最久没施的在最上面')
      : h('div', { class: 'card' },
          h('p', {}, '还没有植物。'),
          h('p', { class: 'muted small' },
            `用 NFC Tools 给芯片写入网址 ${tagUrl}，碰一下芯片就能登记这盆。`),
        ),
    rows.map((r) => h('button', {
      class: r.days === null ? 'plant-row never' : 'plant-row',
      onclick: () => { location.search = `?p=${encodeURIComponent(r.id)}`; },
    },
      h('span', { class: 'name' }, r.name),
      h('span', { class: 'when' },
        r.days === null ? '还没记过' : [daysText(r.days), h('br'), r.lastFert]),
    )),
    !skipToken && h('div', { class: 'footer-actions' },
      h('button', { onclick: clearToken }, '🔑 换 token')),
  );
}

// --- boot ---

async function start() {
  const token = skipToken ? null : localStorage.getItem(TOKEN_KEY);
  if (!skipToken && !token) return renderSetup();
  store = createStore(token);
  state.plantId = parsePlantId(location.search);
  mount(h('p', { class: 'muted' }, '加载中…'));
  try {
    const [config, log] = await Promise.all([
      store.readJson('config.json', DEFAULT_CONFIG),
      store.readJson('log.json', []),
    ]);
    state.config = config.data;
    state.log = log.data;
  } catch (e) {
    return renderLoadError(e.message);
  }
  if (!state.plantId) return renderHome();
  if (!plantName(state.plantId)) return renderRegister();
  renderPlant();
}

// createStore is injectable so dev/index.html can run the real UI against an
// in-memory fake GitHub. skipToken hides the token flow there.
export function boot(options = {}) {
  createStore = options.createStore ?? ((token) => new GitHubStore({ token }));
  skipToken = options.skipToken ?? false;
  start();
}
