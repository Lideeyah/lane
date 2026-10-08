#!/usr/bin/env bash
# Sends a mock-stablecoin payment from the demo customer to a till on the local chain.
set -euo pipefail
TILL=${1:?till address}
AMOUNT=${2:?amount, e.g. 12.50}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN=$(grep NEXT_PUBLIC_TOKEN_ADDRESS "$ROOT/web/.env.local" | cut -d= -f2)
# Anvil default account #2: a public, well-known development key. Local chain only.
CUSTOMER_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
BASE=$(python3 -c "from decimal import Decimal; print(int(Decimal('$AMOUNT')*10**6))")
cast send "$TOKEN" "transfer(address,uint256)" "$TILL" "$BASE" --private-key "$CUSTOMER_PK" --rpc-url http://127.0.0.1:8545 --json | python3 -c "import sys,json; d=json.load(sys.stdin); print('paid', '$AMOUNT', 'to', '$TILL', 'tx', d['transactionHash'])"
