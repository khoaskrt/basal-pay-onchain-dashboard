// Proxy Etherscan API V2 — key lấy từ biến môi trường ETHERSCAN_API_KEY trên Vercel, không gửi xuống trình duyệt.
// Chỉ cho các lệnh dashboard dùng (module=account), apikey từ phía client bị bỏ qua.
const ACTIONS = new Set(["tokentx", "txlist", "txlistinternal", "tokenbalance"]);

module.exports = async (req, res) => {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return res.status(500).json({ status: "0", message: "NOTOK", result: "Chưa đặt ETHERSCAN_API_KEY trên Vercel" });
  const { apikey, ...params } = req.query;
  if (params.module !== "account" || !ACTIONS.has(params.action))
    return res.status(400).json({ status: "0", message: "NOTOK", result: "Lệnh không được phép qua proxy" });
  const r = await fetch("https://api.etherscan.io/v2/api?" + new URLSearchParams({ ...params, apikey: key }));
  res.status(r.status).setHeader("content-type", "application/json").send(await r.text());
};
