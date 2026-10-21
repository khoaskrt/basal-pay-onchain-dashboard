// Đăng xuất: xoá cookie phiên Vercel Authentication trên domain này rồi về trang chủ. Vercel sẽ hiện trang đăng nhập —
// nhưng nếu trình duyệt còn đăng nhập vercel.com thì Vercel cấp lại phiên ngay, muốn ra hẳn phải đăng xuất cả vercel.com.
module.exports = (req, res) => {
  res.setHeader("cache-control", "no-store");
  res.setHeader("set-cookie", "_vercel_jwt=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax");
  res.statusCode = 302;
  res.setHeader("location", "/");
  res.end();
};
