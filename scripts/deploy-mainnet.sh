#!/usr/bin/env bash
# Prepares and deploys Lane on Monad mainnet (143). Run it in two steps:
#   1. scripts/deploy-mainnet.sh          creates the deployer and treasury keys in
#      .secrets/mainnet/ (git-ignored) if they do not exist, verifies the stablecoins
#      on chain, prints the two addresses to fund with MON, and stops.
#   2. Fund them, then scripts/deploy-mainnet.sh --deploy
#      deploys the TillRegistry and prints the environment for the mainnet host.
#
# Real money: nothing here sends a transaction until --deploy is given and the
# deployer holds MON. The treasury key is never sent anywhere by this script;
# add it to the host yourself (see the end of the output).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.secrets/mainnet"
RPC=https://rpc.monad.xyz
WS=wss://rpc.monad.xyz
EXPLORER=https://monadexplorer.com
# Verified 15 Oct 2026 against Circle's and USDT0's published addresses, and on chain below.
USDC=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
USDT0=0xe7cd86e13AC4309349F30B3435a9d337750fC82D

[[ "$(cast chain-id --rpc-url $RPC)" == "143" ]] || { echo "RPC is not Monad mainnet"; exit 1; }

check() { # address expected-symbol
  local sym dec
  sym=$(cast call "$1" 'symbol()(string)' --rpc-url $RPC | tr -d '"')
  dec=$(cast call "$1" 'decimals()(uint8)' --rpc-url $RPC)
  [[ "$sym" == "$2" && "$dec" == "6" ]] || { echo "token $1 reads as $sym/$dec, expected $2/6"; exit 1; }
  echo "  $2 $1 ok (6 decimals)"
}
echo "▸ verifying stablecoins on chain"
check $USDC USDC
check $USDT0 USDT0

mkdir -p "$DIR"
chmod 700 "$DIR"
for who in deployer treasury; do
  if [[ ! -f "$DIR/$who.key" ]]; then
    out=$(cast wallet new)
    echo "$out" | awk '/Private key/ {print $3}' > "$DIR/$who.key"
    echo "$out" | awk '/Address/ {print $2}' > "$DIR/$who.addr"
    chmod 600 "$DIR/$who.key"
    echo "▸ created a new $who key in .secrets/mainnet/"
  fi
done
DEPLOYER=$(cat "$DIR/deployer.addr")
TREASURY=$(cat "$DIR/treasury.addr")
bal() { cast balance "$1" --rpc-url $RPC --ether; }
echo "▸ deployer $DEPLOYER  $(bal "$DEPLOYER") MON   (the registry deploy costs about 0.08 MON; send 0.2)"
echo "▸ treasury $TREASURY  $(bal "$TREASURY") MON   (pays each new shop's first gas, about 0.03 MON per shop)"

if [[ "${1:-}" != "--deploy" ]]; then
  echo
  echo "Fund both addresses with MON, then run: scripts/deploy-mainnet.sh --deploy"
  exit 0
fi

if [[ -f "$DIR/registry.addr" ]]; then
  REGISTRY=$(cat "$DIR/registry.addr")
  echo "▸ reusing registry $REGISTRY"
else
  echo "▸ deploying the TillRegistry to Monad mainnet"
  cd "$ROOT/contracts"
  OUT=$(DEPLOYER_PRIVATE_KEY=$(cat "$DIR/deployer.key") forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast --gas-estimate-multiplier 110 2>&1)
  REGISTRY=$(echo "$OUT" | grep -E '^\s*TILL_REGISTRY' | awk '{print $2}')
  [[ -n "$REGISTRY" ]] || { echo "$OUT"; echo "registry deploy failed"; exit 1; }
  echo "$REGISTRY" > "$DIR/registry.addr"
  echo "  registry $REGISTRY"
fi

cat <<ENV

Environment for the mainnet host (public values):
NEXT_PUBLIC_CHAIN=mainnet
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_WS_URL=$WS
NEXT_PUBLIC_EXPLORER_URL=$EXPLORER
NEXT_PUBLIC_TOKEN_ADDRESS=$USDC
NEXT_PUBLIC_TOKEN_SYMBOL=USDC
NEXT_PUBLIC_TOKEN_DECIMALS=6
NEXT_PUBLIC_EXTRA_TOKENS=$USDT0:USDT0
NEXT_PUBLIC_REGISTRY_ADDRESS=$REGISTRY
DRIP_AMOUNT_MON=0.03

Add the treasury key to the host yourself, as a sensitive value:
  TREASURY_PRIVATE_KEY  from .secrets/mainnet/treasury.key
ENV
