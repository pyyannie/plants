import { encodeBase64Utf8, decodeBase64Utf8, bytesToBase64, base64ToBytes } from './logic.js';

const API = 'https://api.github.com';

export class GitHubStore {
  // fetchImpl is injectable so the tests can run without a network.
  // It must stay wrapped in an arrow, NOT `globalThis.fetch` directly: assigning
  // fetch onto `this` and calling `this.fetchImpl(...)` rebinds its receiver, and
  // the browser's fetch has a brand check that throws "Illegal invocation".
  // Node's fetch has no such check, so a direct reference passes every test here
  // and then fails on the phone.
  constructor({
    owner = 'pyyannie',
    repo = 'plants-data',
    token,
    branch = 'main',
    fetchImpl = (...a) => globalThis.fetch(...a),
  }) {
    Object.assign(this, { owner, repo, token, branch, fetchImpl });
  }

  #url(path) {
    // Plant ids are Chinese, so photo paths must be percent-encoded. Encode each
    // segment separately so the slashes stay as path separators.
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${API}/repos/${this.owner}/${this.repo}/contents/${encoded}`;
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
    // GitHub also returns 403 for secondary rate limits, which back-to-back
    // writes can trigger. Calling that a bad token would send Annie off
    // regenerating it for no reason.
    if (res.status === 403 && /rate limit/i.test(message)) {
      throw new Error('操作太快了，等一分钟再试');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`token 无效或权限不够（${res.status}）：${message}`);
    }
    throw new Error(`GitHub 返回 ${res.status}：${message || '未知错误'}`);
  }

  // GET a contents entry. Returns null on 404 so callers can treat a missing
  // file as empty data.
  async #get(path) {
    const res = await this.fetchImpl(`${this.#url(path)}?ref=${this.branch}`, {
      headers: this.#headers(),
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) await this.#fail(res);
    return res.json();
  }

  async #put(path, base64, sha, message) {
    return this.fetchImpl(this.#url(path), {
      method: 'PUT',
      headers: { ...this.#headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: base64,
        branch: this.branch,
        ...(sha ? { sha } : {}),
      }),
    });
  }

  // A missing file returns 404, but so does a private repo the token cannot see.
  // Check the repo itself once at token setup so the second case is not mistaken
  // for "no data yet".
  async checkAccess() {
    const res = await this.fetchImpl(`${API}/repos/${this.owner}/${this.repo}`, {
      headers: this.#headers(),
      cache: 'no-store',
    });
    if (res.status === 404) {
      throw new Error(`找不到仓库 ${this.owner}/${this.repo}：仓库没建，或者 token 没授权这个仓库`);
    }
    if (!res.ok) await this.#fail(res);
  }

  // Returns { data, sha }. sha is null when the file does not exist yet, which
  // is what a first-time PUT needs.
  async readJson(path, fallback = null) {
    const body = await this.#get(path);
    if (!body) return { data: fallback, sha: null };
    return { data: JSON.parse(decodeBase64Utf8(body.content)), sha: body.sha };
  }

  // Read-modify-write. updateFn receives the current data and returns the new data.
  //
  // On conflict (409/422 = someone committed since we read) we re-read and run
  // updateFn AGAIN against the fresh data. Retrying with only a fresh sha would
  // re-submit our stale snapshot and silently erase the other commit.
  //
  // Returns the data that was written, so the caller can update its in-memory copy.
  async update(path, fallback, updateFn, message) {
    const encode = (data) => encodeBase64Utf8(JSON.stringify(data, null, 2) + '\n');

    const first = await this.readJson(path, fallback);
    let data = updateFn(first.data);
    let res = await this.#put(path, encode(data), first.sha, message);

    if (res.status === 409 || res.status === 422) {
      const fresh = await this.readJson(path, fallback);
      data = updateFn(fresh.data);
      res = await this.#put(path, encode(data), fresh.sha, message);
    }

    if (!res.ok) await this.#fail(res);
    return data;
  }

  // Returns { bytes, sha } or null when the file does not exist.
  // The Contents API inlines files up to 1 MB; compressed photos are ~100 KB.
  async readBinary(path) {
    const body = await this.#get(path);
    if (!body) return null;
    return { bytes: base64ToBytes(body.content), sha: body.sha };
  }

  // Create or overwrite. Overwriting needs the current sha, so fetch it first.
  // Last write wins: a photo has no meaningful merge, unlike the log.
  async writeBinary(path, bytes, message) {
    const current = await this.#get(path);
    const res = await this.#put(path, bytesToBase64(bytes), current?.sha ?? null, message);
    if (!res.ok) await this.#fail(res);
  }
}
