import { GitHubStore } from './github.js';
import {
  todayLocal, formatShortDate, daysSince, entriesFor, lastFertEntry, lastNoteEntry,
  visibleFertilizers, addFertilizer, hideFertilizer, countFertilizerUses, renameFertilizer,
  parsePlantId, addPlant, renamePlant, addEntry, plantOverview,
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
};
// plant id -> object URL, or null when the plant is known to have no photo.
const photoUrls = new Map();

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
}

let toastTimer;
function toast(text, isError = false) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: isError ? 'toast error' : 'toast' }, text);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 2000);
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
  const input = h('input', {
    type: 'password',
    placeholder: 'github_pat_…',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  const error = h('div', { class: 'error', hidden: !errorText }, errorText);
  const save = h('button', { onclick: onSave }, '保存');

  async function onSave() {
    const token = input.value.trim();
    if (!token) return;
    save.disabled = true;
    save.textContent = '验证中…';
    error.hidden = true;
    try {
      // Never store a token that has not been proven to work against the data repo.
      await createStore(token).checkAccess();
      localStorage.setItem(TOKEN_KEY, token);
      start();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      save.disabled = false;
      save.textContent = '保存';
    }
  }

  mount(
    h('h1', {}, '🌱 植物施肥记录'),
    h('div', { class: 'card' },
      h('p', {}, '第一次在这台手机上打开，需要贴一下 GitHub token。'),
      h('p', { class: 'muted small' },
        'token 只存在这台手机的浏览器里。iOS 7 天没打开会自动清掉，到时候再贴一次就行，数据不会丢。'),
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
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('照片压缩失败'))),
        'image/jpeg',
        PHOTO_QUALITY,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pickPhoto(id) {
  const input = h('input', { type: 'file', accept: 'image/*' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const previous = photoUrls.get(id) ?? null;
    try {
      const blob = await compressPhoto(file);
      // Show the local copy straight away instead of waiting for GitHub.
      photoUrls.set(id, URL.createObjectURL(blob));
      refreshPhoto(id);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await store.writeBinary(`photos/${id}.jpg`, bytes, `Photo ${id}`);
      if (previous) URL.revokeObjectURL(previous);
      toast('✅ 照片已保存');
    } catch (e) {
      photoUrls.set(id, previous);
      refreshPhoto(id);
      toast(`照片没存上：${e.message}`, true);
    }
  });
  input.click();
}

async function loadPhoto(id) {
  if (photoUrls.has(id)) return;
  try {
    const file = await store.readBinary(`photos/${id}.jpg`);
    photoUrls.set(id, file ? URL.createObjectURL(new Blob([file.bytes], { type: 'image/jpeg' })) : null);
  } catch {
    // A failed photo read should not block logging; show the empty slot.
    photoUrls.set(id, null);
  }
  refreshPhoto(id);
}

// Swap just the photo block so a late-arriving photo does not wipe the note box.
function refreshPhoto(id) {
  if (state.plantId !== id) return;
  document.querySelector('.photo')?.replaceWith(photoBlock(id));
}

function photoBlock(id) {
  if (!photoUrls.has(id)) {
    return h('div', { class: 'photo empty' }, h('span', {}, '照片加载中…'));
  }
  const url = photoUrls.get(id);
  if (!url) {
    return h('div', { class: 'photo empty', onclick: () => pickPhoto(id) },
      h('span', { class: 'icon' }, '📷'),
      '点我加照片',
    );
  }
  return h('div', { class: 'photo' },
    h('img', { src: url, alt: plantName(id) }),
    state.editing && h('button', { class: 'change', onclick: () => pickPhoto(id) }, '📷 换照片'),
  );
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
    photoBlock(id),
    h('div', { class: 'title-row' },
      h('h1', {}, plantName(id)),
      editing && h('button', { class: 'rename', onclick: onRenamePlant, 'aria-label': '改名' }, '✏️'),
      h('button', {
        class: editing ? 'edit-toggle on' : 'edit-toggle',
        onclick: () => { state.editing = !state.editing; renderPlant(); },
      }, editing ? '完成' : '✏️ 编辑'),
    ),
    h('div', { class: 'status' }, statusItems),
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
  loadPhoto(id);
}

function historyList(id) {
  const entries = entriesFor(state.log, id);
  if (!entries.length) return h('p', { class: 'muted small' }, '还没有记录');
  return h('ul', { class: 'history' }, entries.map((e) =>
    h('li', {},
      h('span', { class: 'date' }, formatShortDate(e.date)),
      h('span', { class: 'what' },
        e.fert && h('span', { class: 'fert' }, e.fert),
        e.note && (e.fert ? h('span', { class: 'note' }, e.note) : `📝 ${e.note}`),
      ),
    ),
  ));
}

// fert === null means "note only".
async function logEntry(fert) {
  if (state.busy) return;
  const id = state.plantId;
  const note = state.noteDraft;
  const name = plantName(id);
  state.busy = true;
  renderPlant();
  try {
    // Pass a function, not a precomputed array, so a conflict retry re-applies
    // this append on top of whatever another device just wrote.
    state.log = await store.update(
      'log.json', [],
      (log) => addEntry(log, id, todayLocal(), fert, note),
      fert ? `Log ${name} / ${fert}` : `Note ${name}`,
    );
    state.noteDraft = '';
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
