# Lane

Lane turns a phone into a shop's payment counter. The owner sets up with a fingerprint,
the customer scans a code and pays from their own wallet, and the money lands in the shop's
own account on Monad in under a second. The shop never installs a wallet: the fingerprint
creates its accounts on the phone, through [Mera](https://mera.category.xyz/), Category Labs' passkey
library. Lane never holds a key or the money.

Built for Monad Metropolis, Consumer Products & Payments track.
Demo video: https://youtu.be/hfj2WTRs3-Y

## Live on Monad testnet

- App: https://lane-mu.vercel.app
- TillRegistry: `0xc4C275cA0E095aA7C6012C426E08f9bE27e718DB` (chain 10143)
- Token: Circle test USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`, verified on chain (USDC, 6 decimals)
- Every push to `main` deploys the app. `scripts/deploy-testnet.sh` deploys the registry and sets the public settings; the treasury key is added to Vercel by hand, never by script.

Measured on testnet, 8 Oct 2026, at about 103 gwei:

| Step | Gas | MON |
|---|---|---|
| Gas drip | 21,000 | 0.0022 |
| Register a till | 71,625 | 0.0074 |
| Customer pays USDC | 100,504 | 0.0104 |
| Sweep a till | 100,516 | 0.0103 |

The node at `wss://testnet-rpc.monad.xyz` serves live subscriptions.

## Built around Monad

- **One passkey, many keys, through Mera.** Mera runs the passkey ceremonies and returns the PRF output; Lane derives the shop's account and one per till from it, and every transaction signs through a Mera signing session that zeroes its key when the action ends.

- **Settlement before the customer walks away.** In the demo the shop's phone showed Paid 0.8 seconds after the customer confirmed.
- **No contract between customer and shop.** A payment is one plain USDC transfer into the till, so any wallet can pay with one signature and nothing can fail or need an approval in between.
- **Tills run in parallel.** Each till is its own account, and the only contract is a registry with no shared counters, so sales into different tills never touch the same state.
- **The reserve balance rule, handled.** Accounts stay undelegated; sweeps are batched per till, a repeat sweep inside two seconds is queued, and back-to-back sends from one account are spaced three blocks apart.
- **Exact gas, declared.** Monad charges the declared gas limit, so every transaction declares the estimate for that exact call.
- **Public endpoint limits.** Monad's public testnet endpoint serves logs over at most 100 blocks, so all history is read in 100-block spans and tills are restored by reading the registry directly.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry. `TillRegistry.sol` (owner→till registry, no funds, no shared slots), `MockUSD.sol` (local chain only), deploy script, 10 tests. |
| `web/` | Next.js 16 app. All product code under `web/src`. |
| `web/src/lib/` | Technical core: `passkey.ts` (passkeys and PRF output via Mera), `accounts.ts` (BIP-44 derivation from the PRF output, Mera signing sessions), `request.ts` (payment requests carried in the link fragment, matching), `watch.ts` (websocket subscription with polling fallback and catch-up), `ledger.ts` (this device's records plus a recent chain scan, or the indexer; balances always from chain), `chain.ts` (config, 100-block history spans), `tx.ts` (explicit-gas sends, registration, per-till sweep with a two-second queue, refunds, same-sender pacing), `shop.ts`, `staff.ts`, `storage.ts`. |
| `web/src/app/api/drip/route.ts` | Gas treasury: one-at-a-time sends, shared rate limits, 21,000 explicit gas. |
| `web/src/app/api/pair/` | Six-digit staff pairing codes: issue and one-time redeem, rate limited. |
| `web/src/proxy.ts` | Strict content security policy with a per-request nonce; unknown paths go to `/`. |
| `indexer/` | Envio project (optional; app falls back to chain logs). |
| `scripts/dev-chain.sh` | Starts Anvil, deploys, writes `web/.env.local`. `scripts/pay.sh <till> <amount>` simulates a customer. |

## Screens

| Path | What |
|---|---|
| `/` | Landing page. Primary action reads "Start taking payments", or "Continue to your till" for a returning merchant. It never redirects. |
| `/start` | Cold open, passkey prompt, dismissed and unsupported-authenticator recovery, insecure-context refusal, shop setup with a non-blocking preparing line, and "I already have a shop" restore. |
| `/till` | Merchant home. Pad, request code, paid / paid short / overpaid / offline band; tills (add with one prompt, rename, hand to staff, unpair); ledger (today first, by till / by day, sale detail, refund, catching-up balances); close the day (sweep, per-till retry, day summary); settings and recovery phrase. |
| `/pay#…` | Customer page. No header or navigation, rebuilt from the fragment alone. Wallet path (injected provider or `ethereum:` link) and face path, balance check before signing, paid / declined / insufficient / expired / unreadable states. |
| `/staff#…` | Staff phone. One till, its pad and today's sales. No key, no balances, no other tills. |
| anything else | Redirects to `/`. |

## Run locally

```bash
scripts/dev-chain.sh
cd web && npm install && npm run build && PORT=3100 npm run start
```

Simulate a customer with `scripts/pay.sh <till-address> <amount>`, or import the demo
customer key printed by `dev-chain.sh` into a browser wallet on chain 31337.

## Tests

```bash
cd contracts && forge test
cd web && npm test && npm run typecheck
cd web && LANE_ORIGIN=http://localhost:3100 npm run e2e
```

The e2e suite needs Anvil and a running server. It covers the treasury drip, till
registration, a customer payment, the chain-read ledger, the sweep and its two-second
queue, and a refund from the main account.

## Deploying to Monad

1. Verify the stablecoin address with its issuer (architecture §13). Do not take it from memory.
2. `forge script script/Deploy.s.sol --rpc-url $MONAD_RPC_URL --broadcast` with `DEPLOYER_PRIVATE_KEY` set.
3. Fill `web/.env.example` into the host's environment with `NEXT_PUBLIC_CHAIN=mainnet`, both addresses, and a dedicated funded `TREASURY_PRIVATE_KEY`.
4. Optionally run the Envio indexer in `indexer/` and set `NEXT_PUBLIC_INDEXER_URL`.

## Staff pairing

The owner taps Hand to staff and sees a six-digit code. The staff member types it at `/staff`. Codes live in Upstash Redis (Vercel Marketplace) for ten minutes and work once; redemption is limited to 10 tries per network address per ten minutes. The store holds only the till's public address and two labels, never key material, so the claim that no server can move money still holds. The QR code and link remain as a fallback when the store is unavailable. The same store holds the treasury's rate limits.

## Licence

MIT. See [LICENSE](LICENSE).
