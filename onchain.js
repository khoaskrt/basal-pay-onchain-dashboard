// Cấu hình vault/chain và logic tải giao dịch on-chain (Etherscan V2 cho Polygon…, NodeReal cho BSC).
// Dùng chung cho index.html (bản local, trình duyệt tự tải) và api/sync.js (bản Vercel, server tải rồi lưu vào Blob).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Onchain = factory();
})(typeof self !== "undefined" ? self : this, function () {

// Các ví Central Vault của Basal Pay. Giao dịch giữa các vault là chuyển nội bộ.
const VAULTS = [
  { id: 1, name: "Central Vault (1)", short: "CV1", addr: "0xb8ED09af8cFE40A4AD9Bd44513817Ab476BCf853" },
  { id: 2, name: "Central Vault (2)", short: "CV2", addr: "0x9E0aF3f1ee72D5D576e402d952EAed228e361D4B" },
];
// Màu theo chain cố định (màu đi theo thực thể, không theo thứ hạng)
const CHAINS = [
  { id: 56,    name: "BSC",      native: "BNB", cg: "binancecoin",             explorer: "https://bscscan.com",               color: "--s1", on: true },
  { id: 137,   name: "Polygon",  native: "POL", cg: "polygon-ecosystem-token", explorer: "https://polygonscan.com",           color: "--s2", on: true },
  { id: 1,     name: "Ethereum", native: "ETH", cg: "ethereum",                explorer: "https://etherscan.io",              color: "--s3", on: false },
  { id: 42161, name: "Arbitrum", native: "ETH", cg: "ethereum",                explorer: "https://arbiscan.io",               color: "--s4", on: false },
  { id: 8453,  name: "Base",     native: "ETH", cg: "ethereum",                explorer: "https://basescan.org",              color: "--s5", on: false },
  { id: 10,    name: "Optimism", native: "ETH", cg: "ethereum",                explorer: "https://optimistic.etherscan.io",   color: "--s8", on: false },
  // Kaia, Plasma: chưa có nguồn API — chỉ hiển thị dữ liệu đã audit của Central Vault (1)
  { id: 8217,  name: "Kaia",     native: "KAIA", cg: "kaia",                   explorer: "https://kaiascan.io",               color: "--s6", on: false, api: false },
  { id: 9745,  name: "Plasma",   native: "XPL", cg: "plasma",                  explorer: "https://plasmascan.to",             color: "--s7", on: false, api: false },
];
const chainById = Object.fromEntries(CHAINS.map(c => [c.id, c]));
// Chỉ tính USDT chuẩn — nhận diện theo ĐỊA CHỈ HỢP ĐỒNG, không theo tên (ví bị spam token giả tên "USDT").
// Đã đối chiếu symbol() on-chain ngày 2026-10-19. Mọi token khác (kể cả BNB/POL native) không được tính.
const VERIFIED = {
  "56:0x55d398326f99059ff775485246999027b3197955": "USDT",   // Tether USD (BSC-USD) trên BNB Chain
  "137:0xc2132d05d31c914a87c6611c10748aeb04b58e8f": "USDT0", // USDT0 trên Polygon PoS
  "8217:0xd077a400968890eacc75cdc901f0356c943e4fdb": "USDT", // Tether USD trên Kaia (theo sổ đối soát)
  "9745:0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb": "USDT0", // USDT0 trên Plasma (theo sổ đối soát)
};
// Số dư on-chain: USDT chuẩn (balanceOf) + native (gas). BSC qua NodeReal, Polygon qua Etherscan,
// Kaia/Plasma qua RPC công khai (chỉ số dư — giao dịch vẫn lấy từ sổ audit).
// decimals USDT đã đối chiếu on-chain: BSC-USD 18, Polygon USDT0 6 (2026-10-20); Kaia USDT 6, Plasma USDT0 6 (2026-10-21). Native luôn 18.
const BAL_CHAINS = [
  { id: 56, dec: 18 }, { id: 137, dec: 6 },
  { id: 8217, dec: 6, rpc: "https://public-en.node.kaia.io" }, { id: 9745, dec: 6, rpc: "https://rpc.plasma.to" },
];
const contractOf = id => Object.keys(VERIFIED).find(k => k.startsWith(id + ":")).split(":")[1];
const fromUnits = (raw, dec) => { const b = BigInt(raw), d = 10n ** BigInt(dec); return Number(b / d) + Number(b % d) / Number(d); };

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Giới hạn tốc độ dùng chung cho các lượt tải chạy song song: tối đa n lệnh trong mỗi khoảng ms
function rateGate(n, ms) {
  const sent = []; let chain = Promise.resolve();
  return () => chain = chain.then(async () => {
    while (sent.length >= n) { const wait = sent[0] + ms - Date.now(); if (wait > 0) await sleep(wait); sent.shift(); }
    sent.push(Date.now());
  });
}

function normalize(chainid, raw, kind, addr, vault) {
  const me = addr.toLowerCase(), c = chainById[chainid];
  return raw.flatMap(x => {
    if (x.isError === "1") return [];
    const from = (x.from || "").toLowerCase(), to = (x.to || "").toLowerCase();
    const dir = from === me && to === me ? "self" : to === me ? "in" : from === me ? "out" : null;
    if (!dir || dir === "self") return [];
    let token, amount, contract = "";
    if (kind === "token") {
      const dec = +x.tokenDecimal || 0;
      token = (x.tokenSymbol || "?").toUpperCase(); contract = x.contractAddress.toLowerCase();
      amount = Number(x.value) / 10 ** dec;
    } else { token = c.native; amount = Number(x.value) / 1e18; }
    if (!(amount > 0)) return []; // bỏ transfer 0 (thường là address poisoning)
    return [{ vault, chain: chainid, ts: +x.timeStamp, block: +x.blockNumber, hash: x.hash, from, to, dir, token, contract, amount, kind,
              cp: dir === "in" ? from : to }];
  });
}

// cfg: { esUrl, esKey, nrUrls } — trình duyệt local gọi thẳng API bằng key trong config.local.js,
// server gọi thẳng bằng biến môi trường. note(msg) báo tiến trình khi phải chờ giới hạn tốc độ.
function create({ esUrl = "https://api.etherscan.io/v2/api?", esKey = "", nrUrls = [] }) {
  const esGate = rateGate(3, 1050); // Etherscan free: 3 lệnh/giây
  const nrGate = rateGate(7, 60000); // NodeReal free: ~8 lệnh/phút (đo ngày 2026-10-20), giữ dưới ngưỡng

  async function esCall(chainid, params) {
    const qs = new URLSearchParams({ chainid, ...params, apikey: esKey });
    for (let attempt = 0; attempt < 4; attempt++) {
      await esGate();
      let j;
      try { j = await (await fetch(esUrl + qs)).json(); }
      catch (e) { if (attempt === 3) throw e; await sleep(2000); continue; } // lỗi mạng / phản hồi hỏng: thử lại
      if (j.status === "1") return j.result;
      if (j.message === "No transactions found" || (Array.isArray(j.result) && j.result.length === 0)) return [];
      const msg = typeof j.result === "string" ? j.result : j.message;
      if (/rate limit/i.test(msg)) { await sleep(1200); continue; }
      throw new Error(msg);
    }
    throw new Error("Rate limit liên tục");
  }
  async function esAll(chainid, action, addr, start = 0) {
    // Etherscan chỉ trả tối đa 10.000 bản ghi mỗi truy vấn (page × offset) → hết 10 trang thì
    // tải tiếp từ block cuối cùng; bỏ các bản ghi của block cuối ở lượt trước để không trùng.
    const out = []; const offset = 1000;
    for (let round = 0; round < 50; round++) {
      const batch = [];
      for (let page = 1; page <= 10; page++) {
        const res = await esCall(chainid, { module: "account", action, address: addr, startblock: start, endblock: 999999999, page, offset, sort: "asc" });
        batch.push(...res);
        if (res.length < offset) { out.push(...batch); return out; }
      }
      const last = +batch[batch.length - 1].blockNumber;
      const keep = batch.filter(x => +x.blockNumber < last);
      if (!keep.length) throw new Error(`block ${last} có hơn 10.000 bản ghi, không tải hết được`);
      out.push(...keep); start = last;
    }
    throw new Error("quá nhiều bản ghi (> 50 lượt × 10.000)");
  }

  // Gọi NodeReal: lỗi giới hạn tốc độ/mạng thì chuyển sang URL dự phòng, hết URL thì chờ tăng dần rồi thử lại
  async function nrCall(method, params, note) {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) {
        const wait = 15000 * attempt; // 15s, 30s, 45s — giới hạn của NodeReal tính theo phút
        note(`NodeReal giới hạn tốc độ, thử lại sau ${wait / 1000}s…`);
        await sleep(wait);
      }
      for (const url of nrUrls) {
        try {
          await nrGate();
          const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
          const j = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
          if (!j.error) return j;
          lastErr = new Error(j.error.message);
          if (!/limit|rate|too many|quota|exceed|HTTP 429|HTTP 5/i.test(j.error.message)) throw lastErr; // lỗi khác: không thử lại
        } catch (e) {
          if (e === lastErr) throw e;
          lastErr = e; // lỗi mạng: thử URL tiếp theo
        }
      }
    }
    throw lastErr;
  }
  let nrHead = null; // block mới nhất của BSC: { at, p: Promise }
  // Trả về { rows, scanned }: scanned là block đã quét tới, dùng làm cursor (vault ít giao dịch thì cursor vẫn tiến lên)
  async function fetchNodeReal(addr, vault, fromBlock, note) {
    if (!nrUrls.length) throw new Error("cần NodeReal URL trong config.local.js (chạy ./set-key.sh)");
    if (!nrHead || Date.now() - nrHead.at > 10000) nrHead = { at: Date.now(), p: nrCall("eth_blockNumber", [], note) }; // các vault dùng chung
    const latest = parseInt((await nrHead.p.catch(e => { nrHead = null; throw e; })).result, 16);
    // index của NodeReal có thể chậm hơn eth_blockNumber ("blockNum not reached") → lùi toBlock, lỗi thì lùi thêm
    for (const lag of [50, 500]) {
      const scanned = latest - lag;
      // lọc theo block thì NodeReal bắt buộc có cả toBlock, và khoảng phải < 2.000.000 block;
      // khoảng dài hơn thì tải không lọc rồi bỏ bản ghi trước fromBlock (ít lệnh hơn chia nhiều khoảng)
      const range = scanned - fromBlock < 1999999 ? [Math.min(fromBlock, scanned - 1), scanned] : null;
      try { return { rows: await nrScan(addr, vault, fromBlock, range, note), scanned: range ? scanned : latest - 500 }; }
      catch (e) { if (!range || lag === 500 || !/not reached/i.test(e.message)) throw e; }
    }
  }
  async function nrScan(addr, vault, fromBlock, range, note) {
    const me = addr.toLowerCase(), out = [];
    await Promise.all(["toAddress", "fromAddress"].map(async side => {
      let pageKey = "";
      for (let i = 0; i < 20; i++) {
        const q = { category: ["external", "internal", "20"], [side]: addr, order: "asc", excludeZeroValue: true, maxCount: "0x3e8" };
        if (range) { q.fromBlock = "0x" + range[0].toString(16); q.toBlock = "0x" + range[1].toString(16); }
        if (pageKey) q.pageKey = pageKey;
        const j = await nrCall("nr_getAssetTransfers", [q], note);
        for (const x of j.result.transfers) {
          if (x.receiptsStatus !== 1) continue;
          const block = parseInt(x.blockNum, 16);
          if (block < fromBlock) continue;
          const from = x.from.toLowerCase(), to = (x.to || "").toLowerCase();
          const dir = to === me && from !== me ? "in" : from === me && to !== me ? "out" : null;
          if (!dir) continue;
          const isTok = x.category === "20";
          const amount = Number(BigInt(x.value)) / 10 ** (isTok ? +x.decimal || 0 : 18);
          if (!(amount > 0)) continue;
          out.push({ vault, chain: 56, ts: x.blockTimeStamp, block, hash: x.hash, from, to, dir,
                     token: isTok ? (x.asset || "?") : "BNB", contract: isTok ? x.contractAddress.toLowerCase() : "",
                     amount, kind: isTok ? "token" : x.category === "internal" ? "internal" : "native", cp: dir === "in" ? from : to });
        }
        pageKey = j.result.pageKey;
        if (!pageKey) break;
      }
    }));
    return out;
  }

  // Tải giao dịch của một vault + chain từ block start. Trả về { rows, cursor, detail };
  // cursor là block đã quét tới — lần sau tải tiếp từ đó.
  async function fetchRange(v, chainid, start, note) {
    let rows, detail, scanned = 0;
    if (chainid === 56) {
      ({ rows, scanned } = await fetchNodeReal(v.addr, v.id, start, note));
      detail = `trong đó ${rows.filter(t => VERIFIED["56:" + t.contract]).length} là USDT chuẩn`;
    } else {
      if (!esKey) throw new Error("cần Etherscan API key trong config.local.js (chạy ./set-key.sh)");
      const [tok, nat, internal] = await Promise.all(["tokentx", "txlist", "txlistinternal"].map(a => esAll(chainid, a, v.addr, start)));
      rows = [...normalize(chainid, tok, "token", v.addr, v.id), ...normalize(chainid, nat, "native", v.addr, v.id), ...normalize(chainid, internal, "internal", v.addr, v.id)];
      detail = `token ${tok.length}, native ${nat.length}, internal ${internal.length} bản ghi gốc`;
    }
    return { rows, detail, cursor: rows.reduce((m, t) => Math.max(m, t.block), Math.max(start, scanned)) };
  }

  // JSON-RPC công khai (Kaia, Plasma): lỗi mạng / HTTP thì thử lại tối đa 2 lần
  async function rpcCall(url, method, params) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
        if (j.error) throw new Error(j.error.message);
        return j.result;
      } catch (e) { if (attempt === 2) throw e; await sleep(1500); }
    }
  }

  // Trả về { usdt, native } của một vault trên một chain
  async function fetchBalance(v, chainid, note) {
    const c = BAL_CHAINS.find(b => b.id === chainid), contract = contractOf(chainid);
    const call = [{ to: contract, data: "0x70a08231" + v.addr.slice(2).toLowerCase().padStart(64, "0") }, "latest"];
    let usdt, native;
    if (c.rpc) {
      [usdt, native] = await Promise.all([rpcCall(c.rpc, "eth_call", call), rpcCall(c.rpc, "eth_getBalance", [v.addr, "latest"])]);
    } else if (chainid === 56) {
      if (!nrUrls.length) throw new Error("cần NodeReal URL trong config.local.js");
      [usdt, native] = (await Promise.all([nrCall("eth_call", call, note), nrCall("eth_getBalance", [v.addr, "latest"], note)])).map(j => j.result);
    } else {
      if (!esKey) throw new Error("cần Etherscan API key trong config.local.js");
      [usdt, native] = await Promise.all([
        esCall(chainid, { module: "account", action: "tokenbalance", contractaddress: contract, address: v.addr, tag: "latest" }),
        esCall(chainid, { module: "account", action: "balance", address: v.addr, tag: "latest" }),
      ]);
    }
    return { usdt: fromUnits(usdt, c.dec), native: fromUnits(native, 18) };
  }

  return { esCall, esAll, nrCall, rpcCall, fetchNodeReal, fetchRange, fetchBalance };
}

return { VAULTS, CHAINS, chainById, VERIFIED, BAL_CHAINS, normalize, create };
});
