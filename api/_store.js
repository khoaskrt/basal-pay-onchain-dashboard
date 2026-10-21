// Bộ dữ liệu dùng chung lưu trong Vercel Blob (store riêng tư basal-pay-onchain-txs, token BLOB_READ_WRITE_TOKEN):
//   txs.json   { syncedAt, cursor: { "vault:chain": block }, jobs: { "vault:chain": { at, n, err } }, balances, txs: [...] }
//   lock.json  { at } — đang có lượt đồng bộ, tránh hai lượt cùng gọi NodeReal (~8 lệnh/phút)
const { get, put } = require("@vercel/blob");

const DATA = "txs.json", LOCK = "lock.json";
const LOCK_TTL = 330e3; // dài hơn thời gian chạy tối đa của function (300s) — quá hạn thì coi như lượt trước đã chết

async function readJSON(path) {
  const r = await get(path, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}
const writeJSON = (path, data) => put(path, JSON.stringify(data), {
  access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60,
});

const load = async () => (await readJSON(DATA)) || { syncedAt: null, cursor: {}, jobs: {}, balances: {}, txs: [] };
const save = data => writeJSON(DATA, data);

async function lock() {
  const cur = await readJSON(LOCK);
  if (cur && Date.now() - cur.at < LOCK_TTL) return false;
  await writeJSON(LOCK, { at: Date.now() });
  return true;
}
// ghi đè thay vì xoá: blob vừa xoá có thể vẫn đọc được trong một lúc, lượt sau tưởng đang bị khoá
const unlock = () => writeJSON(LOCK, { at: 0 }).catch(() => {});

module.exports = { DATA, get, load, save, lock, unlock };
