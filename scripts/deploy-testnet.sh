#!/usr/bin/env bash
# Deploys Lane to Monad testnet (10143):
#   1. deploys the TillRegistry with the deployer key in .secrets/ (git-ignored)
#   2. sets the public Vercel production settings
#   3. deploys the web app to production and prints its URL
#
# The treasury key is NOT handled here. Add it to Vercel yourself, once:
#   vercel env add TREASURY_PRIVATE_KEY production --sensitive < .secrets/treasury.key
# (run from web/). Fund both addresses with testnet MON first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC=https://testnet-rpc.monad.xyz
WS=wss://testnet-rpc.monad.xyz
EXPLORER=https://testnet.monadexplorer.com
# Circle's USDC on Monad testnet, verified on chain: symbol USDC, 6 decimals.
TOKEN=0x534b2f3A21130d7a60830c2Df862319e593943A3

DEPLOYER=$(cat "$ROOT/.secrets/deployer.addr")
TREASURY=$(cat "$ROOT/.secrets/treasury.addr")
bal() { cast balance "$1" --rpc-url $RPC --ether; }
echo "▸ deployer $DEPLOYER  $(bal "$DEPLOYER") MON"
echo "▸ treasury $TREASURY  $(bal "$TREASURY") MON"

if [[ -f "$ROOT/.secrets/registry.addr" ]]; then
  REGISTRY=$(cat "$ROOT/.secrets/registry.addr")
  echo "▸ reusing registry $REGISTRY"
else
  echo "▸ deploying registry"
  cd "$ROOT/contracts"
  OUT=$(DEPLOYER_PRIVATE_KEY=$(cat "$ROOT/.secrets/deployer.key") forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast --gas-estimate-multiplier 110 2>&1)
  REGISTRY=$(echo "$OUT" | grep -E '^\s*TILL_REGISTRY' | awk '{print $2}')
  [[ -n "$REGISTRY" ]] || { echo "$OUT"; echo "registry deploy failed"; exit 1; }
  echo "$REGISTRY" > "$ROOT/.secrets/registry.addr"
  echo "  registry $REGISTRY"
fi

echo "▸ setting public Vercel production settings"
cd "$ROOT/web"
setvar() { vercel env add "$1" production --force --no-sensitive --value "$2" --yes > /dev/null 2>&1 || { echo "failed to set $1"; exit 1; }; echo "  $1"; }
setvar NEXT_PUBLIC_CHAIN testnet
setvar NEXT_PUBLIC_RPC_URL $RPC
setvar NEXT_PUBLIC_WS_URL $WS
setvar NEXT_PUBLIC_EXPLORER_URL $EXPLORER
setvar NEXT_PUBLIC_TOKEN_ADDRESS $TOKEN
setvar NEXT_PUBLIC_TOKEN_SYMBOL USDC
setvar NEXT_PUBLIC_TOKEN_DECIMALS 6
setvar NEXT_PUBLIC_REGISTRY_ADDRESS "$REGISTRY"
setvar DRIP_AMOUNT_MON 0.03

if ! vercel env ls production 2>/dev/null | grep -q TREASURY_PRIVATE_KEY; then
  echo "  TREASURY_PRIVATE_KEY is not set yet. Gas drips will fail until you add it (see top of this file)."
fi

echo "▸ deploying web app"
URL=$(vercel deploy --prod --yes 2>/dev/null | tail -1)
echo
echo "Lane is live on Monad testnet: $URL"
