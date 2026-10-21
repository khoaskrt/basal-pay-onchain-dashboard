// Đồng bộ ở server: tải phần mới kể từ cursor của từng vault + chain (giống runFetch ở bản local) rồi lưu vào Vercel Blob,
// mọi trình duyệt đọc chung qua /api/txs. Gọi bởi Vercel Cron (hằng ngày), khi trang thấy dữ liệu cũ, và nút tải lại.
// ?full=1 bỏ cursor, tải lại toàn bộ. Có lượt khác đang chạy thì chờ lượt đó xong rồi tải tiếp phần mới (thường chỉ vài giây).
const fs = require("fs");
const path = require("path");
const Onchain = require("../onchain.js");
const store = require("./_store.js");

// Mốc cắt của sổ đối soát CV1 (cv1_audited.local.js, deploy kèm qua includeFiles): trước mốc, trình duyệt dùng dữ liệu audit
// thay cho dữ liệu API → CV1 chỉ cần tải từ sau block cutoff. Không có file thì tải toàn bộ.
function auditCutoffs() {
  try {
    const m = fs.readFileSync(path.join(process.cwd(), "cv1_audited.local.js"), "utf8").match(/"cutoffs":(\{.*?\}\})/);
    return m ? JSON.parse(m[1]) : {};
  } catch { return {}; }
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  let waited = false;
  while (!(await store.lock())) {
    if (Date.now() - t0 > 240e3) return res.status(200).json({ busy: true, ms: Date.now() - t0 });
    waited = true;
    await new Promise(r => setTimeout(r, 5000));
  }
  try {
    const full = req.query.full === "1";
    const api = Onchain.create({
      esKey: process.env.ETHERSCAN_API_KEY || "",
      nrUrls: [process.env.NODEREAL_BSC_URL, process.env.NODEREAL_BSC_URL_BACKUP].filter(Boolean),
    });
    const data = await store.load();
    const cut = auditCutoffs();
    const chains = Onchain.CHAINS.filter(c => c.api !== false && c.on);
    // mỗi vault + chain xong thì lưu ngay (nối tiếp nhau) — function bị cắt giữa chừng vẫn giữ phần đã tải
    let saving = Promise.resolve();
    const persist = () => (saving = saving.then(() => store.save(data)));

    const jobs = await Promise.all(Onchain.VAULTS.flatMap(v => chains.map(async c => {
      const ck = v.id + ":" + c.id, tag = `${v.name} · ${c.name}`;
      const old = data.txs.filter(t => t.vault === v.id && t.chain === c.id);
      // chỉ tải tiếp khi đã có dữ liệu của vault + chain này; cursor mà không có dữ liệu thì tải lại toàn bộ
      const inc = !full && data.cursor[ck] != null && old.length > 0;
      const floor = v.id === 1 && cut[c.id] ? cut[c.id].block + 1 : 0;
      const start = Math.max(inc ? data.cursor[ck] : 0, floor);
      const notes = [];
      try {
        const { rows, cursor, detail } = await api.fetchRange(v, c.id, start, msg => notes.push(msg));
        // tải tiếp: giữ bản ghi trước block bắt đầu, phần từ block bắt đầu thay bằng dữ liệu mới
        const keep = inc ? old.filter(t => !(t.block >= start)) : [];
        data.txs = data.txs.filter(t => !(t.vault === v.id && t.chain === c.id)).concat(keep, rows);
        data.cursor[ck] = cursor;
        data.jobs[ck] = { at: Date.now(), n: rows.length };
        await persist();
        return { ck, tag, start, inc, n: rows.length, total: keep.length + rows.length, detail, notes };
      } catch (e) {
        data.jobs[ck] = { ...data.jobs[ck], err: e.message, errAt: Date.now() };
        return { ck, tag, start, inc, err: e.message, total: old.length, notes };
      }
    })));

    // Lỗi một vault · chain thì giữ số cũ, gắn cờ lỗi
    await Promise.all(Onchain.VAULTS.flatMap(v => Onchain.BAL_CHAINS.map(async c => {
      const k = v.id + ":" + c.id;
      try { const b = await api.fetchBalance(v, c.id, () => {}); data.balances[k] = { v: b.usdt, nat: b.native, at: Date.now() }; }
      catch (e) { data.balances[k] = { ...data.balances[k], err: true }; }
    })));
    data.txs.sort((a, b) => a.ts - b.ts);
    data.syncedAt = Date.now();
    await persist();
    res.status(200).json({ syncedAt: data.syncedAt, ms: Date.now() - t0, waited, jobs, balances: data.balances });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await store.unlock();
  }
};
