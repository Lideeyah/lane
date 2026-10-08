#!/usr/bin/env bash
# Starts a local Anvil chain, deploys the registry and a mock stablecoin, funds a
# demo customer, and writes web/.env.local so `npm run dev` works end to end.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Anvil's well-known default accounts (test mnemonic). Never used off localhost.
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
TREASURY_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
CUSTOMER_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
CUSTOMER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

if ! nc -z 127.0.0.1 8545 2>/dev/null; then
  echo "▸ starting anvil on :8545 (block time 1s)"
  (anvil --block-time 1 --chain-id 31337 --silent > "$ROOT/.anvil.log" 2>&1 &)
  for _ in $(seq 1 30); do nc -z 127.0.0.1 8545 2>/dev/null && break; sleep 0.2; done
else
  echo "▸ anvil already running on :8545"
fi

echo "▸ deploying registry + mock token"
cd "$ROOT/contracts"
OUT=$(DEPLOYER_PRIVATE_KEY=$DEPLOYER_PK DEV_CUSTOMER=$CUSTOMER forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast 2>&1)
REGISTRY=$(echo "$OUT" | grep -E '^\s*TILL_REGISTRY' | awk '{print $2}')
TOKEN=$(echo "$OUT" | grep -E '^\s*TOKEN' | awk '{print $2}')
if [[ -z "$REGISTRY" || -z "$TOKEN" ]]; then echo "$OUT"; echo "deploy failed"; exit 1; fi
echo "  registry $REGISTRY"
echo "  token    $TOKEN"

cat > "$ROOT/web/.env.local" <<ENV
NEXT_PUBLIC_CHAIN=local
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8545
NEXT_PUBLIC_TOKEN_ADDRESS=$TOKEN
NEXT_PUBLIC_TOKEN_SYMBOL=mUSD
NEXT_PUBLIC_TOKEN_DECIMALS=6
NEXT_PUBLIC_REGISTRY_ADDRESS=$REGISTRY
TREASURY_PRIVATE_KEY=$TREASURY_PK
DRIP_AMOUNT_MON=0.05
ENV
echo "▸ wrote web/.env.local"
echo
echo "Demo customer (has 10,000 mUSD): $CUSTOMER"
echo "Import this key into a browser wallet pointed at http://127.0.0.1:8545 (chain 31337):"
echo "  $CUSTOMER_PK"
echo
echo "Simulate a customer paying a till from the command line:"
echo "  scripts/pay.sh <till-address> <amount e.g. 12.50>"
