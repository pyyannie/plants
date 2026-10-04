import { GitHubStore } from './github.js';

const TOKEN_KEY = 'plants.token';
const app = document.getElementById('app');

// Tiny element builder: h('button', { class: 'x', onclick }, 'text', child, ...).
// Children that are null/false are skipped, which keeps conditional markup terse.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function mount(...nodes) {
  app.replaceChildren(...nodes);
}

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
      await new GitHubStore({ token }).checkAccess();
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

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  renderSetup();
}

function start() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return renderSetup();
  // Plant and home views are added in the next tasks.
  mount(h('h1', {}, '🌱 已连接'));
}

start();
