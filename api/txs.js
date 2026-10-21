// Trả bộ giao dịch dùng chung đã đồng bộ ở server (txs.json trong Vercel Blob riêng tư) — đọc qua function
// nên vẫn nằm sau Vercel Authentication. Chưa đồng bộ lần nào thì trả bộ rỗng (syncedAt null).
const store = require("./_store.js");

module.exports = async (req, res) => {
  try {
    const r = await store.get(store.DATA, { access: "private", useCache: false });
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json");
    if (!r || r.statusCode !== 200) return res.status(200).send(JSON.stringify({ syncedAt: null, cursor: {}, jobs: {}, balances: {}, txs: [] }));
    res.status(200).send(Buffer.from(await new Response(r.stream).arrayBuffer()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
