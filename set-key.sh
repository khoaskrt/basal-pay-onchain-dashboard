#!/bin/zsh
# Nhập Etherscan API key (không hiện trên màn hình) và lưu vào config.local.js cho dashboard
cd "$(dirname "$0")"
printf "Dán Etherscan API key rồi Enter: "
read -rs KEY; echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
if [[ ! "$KEY" =~ ^[A-Za-z0-9]+$ ]]; then echo "Key không hợp lệ (chỉ gồm chữ và số)."; exit 1; fi
RES=$(curl -s "https://api.etherscan.io/v2/api?chainid=137&module=account&action=balance&address=0x9E0aF3f1ee72D5D576e402d952EAed228e361D4B&apikey=$KEY")
if [[ "$RES" == *'"status":"1"'* ]]; then echo "Key hợp lệ (Polygon OK)."; else echo "Cảnh báo: Etherscan trả về: $RES"; fi
RES=$(curl -s "https://api.etherscan.io/v2/api?chainid=56&module=account&action=balance&address=0x9E0aF3f1ee72D5D576e402d952EAed228e361D4B&apikey=$KEY")
if [[ "$RES" == *'"status":"1"'* ]]; then echo "BSC OK."; else echo "BSC: $RES"; fi
umask 077
printf 'window.ETHERSCAN_API_KEY = "%s";\n' "$KEY" > config.local.js
echo "Đã lưu vào config.local.js. Tải lại dashboard (http://localhost:8765) rồi bấm 'Tải dữ liệu on-chain'."
