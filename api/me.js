// Người đang xem dashboard, lấy từ cookie phiên của Vercel Authentication (_vercel_jwt). Vercel đã kiểm token ở cổng
// trước khi request tới đây nên chỉ giải mã payload, không verify. Cookie không có tên/email thì trả name null.
module.exports = (req, res) => {
  res.setHeader("cache-control", "no-store");
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)_vercel_jwt=([^;]+)/);
  if (!m) return res.status(200).json({ signedIn: false });
  let p = {};
  try { p = JSON.parse(Buffer.from(m[1].split(".")[1], "base64url").toString("utf8")); } catch {}
  res.status(200).json({
    signedIn: true,
    name: p.email || p.username || p.name || null,
    exp: p.exp || null,
    claims: Object.keys(p),
  });
};
