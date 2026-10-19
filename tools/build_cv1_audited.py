#!/usr/bin/env python3
"""Tạo cv1_audited.local.js — dữ liệu chuẩn (đã audit) của Central Vault (1) cho dashboard.

Đọc event on-chain từ thư mục đối soát (chỉ đọc, không sửa gì ở đó), bổ sung thời gian block
qua RPC công khai, rồi đối chiếu tổng IN/OUT từng chain với evidence/netflow_consolidated.json.
Lệch quá 1e-6 là dừng, không xuất file.

    python3 tools/build_cv1_audited.py /đường/dẫn/thư-mục-đối-soát

Đầu vào thêm (local, không commit): tools/cv1_extra_events.local.json — các event đã audit nằm
ngoài file evidence (danh sách object: chain, block, tx, from, to, amount, time_utc).

Đầu ra (đều nằm trong .gitignore, không commit):
    cv1_audited.local.js          dữ liệu cho dashboard
    tools/blocktimes.local.json   cache thời gian block
"""
import json, sys, time, urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if len(sys.argv) < 2:
    sys.exit(__doc__)
RECON = Path(sys.argv[1])
EV = RECON / "evidence"
VAULT = "0xb8ed09af8cfe40a4ad9bd44513817ab476bcf853"

CHAIN_ID = {"BSC": 56, "Polygon": 137, "Kaia": 8217, "Plasma": 9745}
RPC = {
    56: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
    137: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.gateway.tenderly.co"],
    8217: ["https://public-en.node.kaia.io"],
    9745: ["https://rpc.plasma.to"],
}
# block cuối của cửa sổ đã audit (bao gồm block này)
CUTOFF_BLOCK = {56: 113485949, 137: 92148912, 8217: 223428965, 9745: 28688373}
# Polygon dùng danh sách đầy đủ tới 17/08; tổng Phase 1–3 so tới block cuối Phase 3
POLYGON_P3_END = 91282519
# Có trong netflow nhưng evidence không có tx hash nên không dựng được dòng giao dịch:
# Plasma Phase 3 dust 0.00001 USDT0 (address poisoning, phase3_vault_Plasma_events.json)
EXCLUDED_IN = {"Plasma": Decimal("0.00001")}


def load(name, base=EV):
    return json.loads((base / name).read_text())


def ev(chain, block, tx, frm, to, amount, log_index=None, ts=None):
    frm, to = frm.lower(), to.lower()
    d = "in" if to == VAULT and frm != VAULT else "out" if frm == VAULT and to != VAULT else None
    assert d, f"event không thuộc vault: {tx}"
    return {"chain": CHAIN_ID[chain], "block": int(block), "tx": tx.lower(), "li": log_index,
            "from": frm, "to": to, "dir": d, "amount": Decimal(str(amount)), "ts": ts}


def iso_ts(s):
    return int(datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def dedup(rows):
    # cửa sổ Phase n và n+1 dùng chung block ranh giới → bỏ event trùng (tx, log_index)
    seen, out = set(), []
    for r in rows:
        k = (r["chain"], r["tx"], r["li"], r["dir"], r["amount"]) if r["li"] is not None else id(r)
        if k in seen:
            continue
        seen.add(k); out.append(r)
    return out


def collect():
    rows = []
    # BSC — Phase 1/2/3
    p1 = load("phase1_vault_BSC_events.json")
    for d in ("in", "out"):
        rows += [ev("BSC", x["block"], x["tx"], x["from"], x["to"], x["amount"]) for x in p1["events"][d]]
    for f in ("phase2_vault_BSC_events.json", "phase3_vault_BSC_events.json"):
        p = load(f)
        for d in ("in", "out"):
            rows += [ev("BSC", x["block"], x["tx"], x["from"], x["to"], x["amount"], x["log_index"]) for x in p[d]["list"]]
    # Polygon — danh sách hoàn chỉnh (flow identity đã chứng minh tại block 92,148,912)
    pw = load("polygon_inbound_final.json")["wallets"]["old_vault_0xb8ed"]
    assert pw["address"].lower() == VAULT and pw["flow_identity"]["holds"]
    for d in ("in", "out"):
        rows += [ev("Polygon", x["block"], x["tx"], x["from"], x["to"], Decimal(x["amount_raw"]) / Decimal(10**6), x["log_index"])
                 for x in pw["events"][d]]
    # event đã audit nằm ngoài file evidence (vd. khoản IN trước lo_block của Phase 1)
    extra = HERE / "cv1_extra_events.local.json"
    for x in (json.loads(extra.read_text()) if extra.exists() else []):
        rows.append(ev(x["chain"], x["block"], x["tx"], x["from"], x["to"], x["amount"], ts=iso_ts(x["time_utc"])))
    k1 = load("phase1_vault_Kaia_events.json")
    for d in ("in", "out"):
        rows += [ev("Kaia", x["block"], x["tx"], x["from"], x["to"], x["amount"]) for x in k1["events"][d]]
    for f in ("phase2_vault_Kaia_events.json", "phase3_vault_Kaia_events.json"):
        p = load(f)
        for d in ("in", "out"):
            rows += [ev("Kaia", x["block"], x["tx"], x["from"], x["to"], Decimal(x["amount_raw"]) / Decimal(10**6), x["log_index"]) for x in p[d]["list"]]
    # Plasma — event tới 11/01/2026 từ báo cáo lưu trữ, sau đó 2 lệnh OUT ghi riêng trong evidence Phase 2/3
    pa = load("PLASMA_CENTRAL_VAULT_RECONCILIATION_20260111_detail.json", RECON / "archive_old")
    for x in pa["onchain_usdt0_inbound"] + pa["onchain_usdt0_outbound"]:
        rows.append(ev("Plasma", x["block"], x["tx_hash"], x["from"], x["to"], x["amount"], ts=iso_ts(x["timestamp_utc"])))
    u = load("phase2_vault_Plasma_events.json")["phase2_outbound"]["unmatched"][0]
    rows.append(ev("Plasma", u["block"], u["tx"], VAULT, u["to"], u["amount"], ts=iso_ts(u["time_utc"])))
    o = load("phase3_vault_Plasma_events.json")["out"]
    rows.append(ev("Plasma", o["block"], o["tx"], VAULT, o["to"], o["amount"], ts=iso_ts(o["block_time"])))
    # Plasma Phase 3 có 1 dust 0.00001 không ghi tx hash; netflow cũng không tính → bỏ qua
    rows = [r for r in rows if r["amount"] > 0]
    return dedup(rows)


def check(rows):
    nf = load("netflow_consolidated.json")["by_phase_chain"]
    report = {}
    for chain, cid in CHAIN_ID.items():
        # số dư mở đầu Phase 1 (Kaia 19.96) là khoản nạp trước cửa sổ quét → tính là IN
        opening = sum(Decimal(r["opening"]) for r in nf if r["chain"] == chain and r["phase"] == "Phase 1")
        exp_in = opening + sum(Decimal(r["in"]) for r in nf if r["chain"] == chain)
        exp_out = sum(Decimal(r["out"]) for r in nf if r["chain"] == chain)
        exp_in -= EXCLUDED_IN.get(chain, 0)
        lim = POLYGON_P3_END if cid == 137 else CUTOFF_BLOCK[cid]
        sel = [r for r in rows if r["chain"] == cid and r["block"] <= lim]
        got_in = sum((r["amount"] for r in sel if r["dir"] == "in"), Decimal(0))
        got_out = sum((r["amount"] for r in sel if r["dir"] == "out"), Decimal(0))
        ok = abs(got_in - exp_in) <= Decimal("1e-6") and abs(got_out - exp_out) <= Decimal("1e-6")
        print(f"{chain:8} in {got_in:>16.6f} / audit {exp_in:>16.6f}   out {got_out:>16.6f} / audit {exp_out:>16.6f}   {'OK' if ok else 'LỆCH'}")
        if not ok:
            sys.exit(f"Dừng: tổng {chain} không khớp netflow_consolidated.json")
        report[chain] = {"in": str(exp_in), "out": str(exp_out)}
    return report


def rpc_batch(cid, blocks):
    body = json.dumps([{"jsonrpc": "2.0", "id": i, "method": "eth_getBlockByNumber", "params": [hex(b), False]}
                       for i, b in enumerate(blocks)]).encode()
    last = None
    for attempt in range(6):
        url = RPC[cid][attempt % len(RPC[cid])]
        try:
            req = urllib.request.Request(url, body, {"content-type": "application/json", "user-agent": "basal-dashboard"})
            res = json.loads(urllib.request.urlopen(req, timeout=60).read())
            got = {blocks[x["id"]]: int(x["result"]["timestamp"], 16) for x in res if x.get("result")}
            if len(got) == len(blocks):
                return got
            last = f"thiếu {len(blocks) - len(got)} block"
        except Exception as e:  # noqa: BLE001 — thử lại với RPC khác
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"không lấy được thời gian block chain {cid}: {last}")


def fill_times(rows):
    cache_f = HERE / "blocktimes.local.json"
    cache = json.loads(cache_f.read_text()) if cache_f.exists() else {}
    need = {}
    for r in rows:
        if r["ts"] is None and str(r["block"]) not in cache.get(str(r["chain"]), {}):
            need.setdefault(r["chain"], set()).add(r["block"])
    for cid, b in CUTOFF_BLOCK.items():
        if str(b) not in cache.get(str(cid), {}):
            need.setdefault(cid, set()).add(b)
    for cid, blocks in need.items():
        blocks = sorted(blocks); c = cache.setdefault(str(cid), {})
        print(f"chain {cid}: lấy thời gian {len(blocks)} block…")
        for i in range(0, len(blocks), 40):
            c.update({str(k): v for k, v in rpc_batch(cid, blocks[i:i + 40]).items()})
            cache_f.write_text(json.dumps(cache))
            time.sleep(0.3)
    for r in rows:
        bt = cache.get(str(r["chain"]), {}).get(str(r["block"]))
        if r["ts"] is None:
            r["ts"] = bt
        elif bt is not None:
            assert abs(bt - r["ts"]) <= 1, f"thời gian trong evidence lệch block time: {r['tx']}"
    return {cid: {"block": b, "ts": cache[str(cid)][str(b)]} for cid, b in CUTOFF_BLOCK.items()}


def main():
    rows = collect()
    print(f"{len(rows)} event từ {RECON}")
    totals = check(rows)
    cutoffs = fill_times(rows)
    rows.sort(key=lambda r: (r["ts"], r["chain"], r["block"]))
    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "vault": VAULT,
        "source": "evidence/netflow_consolidated.json (Phase 1–3)",
        "cutoffs": cutoffs,
        "audited_totals_phase1_3": totals,
        "cols": ["chain", "ts", "block", "hash", "from", "to", "dir", "amount"],
        "rows": [[r["chain"], r["ts"], r["block"], r["tx"], r["from"], r["to"], r["dir"], float(r["amount"])] for r in rows],
    }
    dest = ROOT / "cv1_audited.local.js"
    dest.write_text("// Tạo bởi tools/build_cv1_audited.py — dữ liệu đối soát, KHÔNG commit\nwindow.CV1_AUDITED = "
                    + json.dumps(out, separators=(",", ":")) + ";\n")
    for cid, c in cutoffs.items():
        print(f"mốc cắt chain {cid}: block {c['block']} = {datetime.fromtimestamp(c['ts'], timezone.utc):%Y-%m-%d %H:%M:%S} UTC")
    print(f"Đã ghi {dest} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
