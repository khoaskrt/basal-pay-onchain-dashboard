#!/bin/zsh
# Nhập Etherscan API key và NodeReal BSC URL (không hiện trên màn hình) rồi lưu vào config.local.js cho dashboard.
# Bỏ trống một mục = giữ giá trị đang có trong config.local.js.
cd "$(dirname "$0")"
TEST_ADDR=0x9E0aF3f1ee72D5D576e402d952EAed228e361D4B
old() { [[ -f config.local.js ]] && sed -n "s/^window\.$1 = \"\(.*\)\";$/\1/p" config.local.js; }

printf "Dán Etherscan API key rồi Enter (bỏ trống để giữ nguyên): "
read -rs KEY; echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
if [[ -z "$KEY" ]]; then KEY=$(old ETHERSCAN_API_KEY)
elif [[ ! "$KEY" =~ ^[A-Za-z0-9]+$ ]]; then echo "Key không hợp lệ (chỉ gồm chữ và số)."; exit 1
else
  RES=$(curl -s "https://api.etherscan.io/v2/api?chainid=137&module=account&action=balance&address=$TEST_ADDR&apikey=$KEY")
  if [[ "$RES" == *'"status":"1"'* ]]; then echo "Etherscan key hợp lệ (Polygon OK)."; else echo "Cảnh báo: Etherscan trả về: $RES"; fi
fi

printf "Dán NodeReal BSC URL (https://bsc-mainnet.nodereal.io/v1/<key>) hoặc chỉ key, rồi Enter (bỏ trống để giữ nguyên): "
read -rs NR; echo
NR=$(printf '%s' "$NR" | tr -d '[:space:]')
if [[ -z "$NR" ]]; then NR=$(old NODEREAL_BSC_URL)
else
  [[ "$NR" =~ ^[A-Za-z0-9]+$ ]] && NR="https://bsc-mainnet.nodereal.io/v1/$NR"
  if [[ ! "$NR" =~ ^https://[A-Za-z0-9.-]+\.nodereal\.io/v1/[A-Za-z0-9]+$ ]]; then echo "NodeReal URL không hợp lệ."; exit 1; fi
  RES=$(curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$NR")
  if [[ "$RES" == *'"result"'* ]]; then echo "NodeReal URL hợp lệ (BSC OK)."; else echo "Cảnh báo: NodeReal trả về: $RES"; fi
fi

umask 077
{
  printf 'window.ETHERSCAN_API_KEY = "%s";\n' "$KEY"
  printf 'window.NODEREAL_BSC_URL = "%s";\n' "$NR"
} > config.local.js
echo "Đã lưu vào config.local.js. Tải lại dashboard (http://localhost:8765) rồi bấm 'Tải dữ liệu on-chain'."
