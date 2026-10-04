// In-memory stand-in for the GitHub Contents API, so the real UI and the real
// GitHubStore can be clicked through locally without a token. Data lives only
// in memory and resets on reload. Add ?fail=1 to the URL to make every write
// fail, for checking the "not saved" path.
import { encodeBase64Utf8 } from '../src/logic.js';

const seedConfig = {
  plants: { 龟背竹: '龟背竹', 琴叶榕: '琴叶榕', 文竹: '文竹' },
  fertilizers: ['花多多01', '花多多02', '花多多08', '花多多10', '磷酸二氢钾', '缓释肥', 'HB101']
    .map((name) => ({ name, hidden: false })),
};
const seedLog = [
  { p: '琴叶榕', date: '2026-09-11', fert: '磷酸二氢钾' },
  { p: '龟背竹', date: '2026-09-14', fert: '磷酸二氢钾' },
  { p: '龟背竹', date: '2026-09-28', fert: '花多多01', note: '新叶有点黄，下次减量' },
  { p: '龟背竹', date: '2026-10-02', note: '发现有虫' },
];

const files = new Map([
  ['config.json', encodeBase64Utf8(JSON.stringify(seedConfig))],
  ['log.json', encodeBase64Utf8(JSON.stringify(seedLog))],
]);
const shas = new Map([...files.keys()].map((k) => [k, 'v0']));
let version = 0;

const failWrites = new URLSearchParams(location.search).has('fail');
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fakeFetch(url, opts = {}) {
  await sleep(300);
  const m = new URL(url).pathname.match(/\/contents\/(.+)$/);
  if (!m) return json(200, { full_name: 'pyyannie/plants-data' });
  const path = decodeURIComponent(m[1]);

  if (opts.method !== 'PUT') {
    return files.has(path)
      ? json(200, { content: files.get(path), sha: shas.get(path) })
      : json(404, { message: 'Not Found' });
  }

  if (failWrites) return json(500, { message: '（试玩页模拟的失败）' });
  const body = JSON.parse(opts.body);
  if ((body.sha ?? null) !== (shas.get(path) ?? null)) return json(409, { message: 'conflict' });
  files.set(path, body.content);
  shas.set(path, `v${++version}`);
  console.log('commit:', body.message);
  return json(200, {});
}
