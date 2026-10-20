// Proxy NodeReal BSC — URL (chứa key) lấy từ NODEREAL_BSC_URL và NODEREAL_BSC_URL_BACKUP (tuỳ chọn) trên Vercel.
// Lỗi giới hạn tốc độ / mạng ở URL chính thì thử URL dự phòng; client tự chờ và thử lại khi vẫn lỗi.
const METHODS = new Set(["eth_blockNumber", "eth_call", "nr_getAssetTransfers"]);
const RETRYABLE = /limit|rate|too many|quota|exceed|HTTP 429|HTTP 5/i;

module.exports = async (req, res) => {
  const urls = [process.env.NODEREAL_BSC_URL, process.env.NODEREAL_BSC_URL_BACKUP].filter(Boolean);
  const fail = message => res.status(200).json({ jsonrpc: "2.0", id: 1, error: { message } });
  if (!urls.length) return fail("Chưa đặt NODEREAL_BSC_URL trên Vercel");
  if (req.method !== "POST") return res.status(405).end();
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || !METHODS.has(body.method)) return fail("Lệnh không được phép qua proxy");
  let last = "HTTP 502";
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
      if (!j.error || !RETRYABLE.test(j.error.message)) return res.status(200).json(j);
      last = j.error.message;
    } catch (e) { last = "HTTP 502 " + e.message; }
  }
  fail(last);
};
