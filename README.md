# Lane

A payment counter that runs in a phone browser. Merchant signs in with a fingerprint
(passkey + PRF), accounts are derived in the browser, payments are plain stablecoin
transfers to per-till accounts on Monad. No wallet, no server that can move money.

Spec documents: the four `lane-*-2026-10-08.md` briefs (design, end-to-end flow,
landing page, technical architecture).

## Live on Monad testnet

- App: https://lane-mu.vercel.app
- TillRegistry: `0xc4C275cA0E095aA7C6012C426E08f9bE27e718DB` (chain 10143)
- Token: Circle test USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`, verified on chain (USDC, 6 decimals)
- Redeploy with `scripts/deploy-testnet.sh`. The treasury key is added to Vercel by hand, never by script.

Measured on testnet, 8 Oct 2026, at about 103 gwei:

| Step | Gas | MON |
|---|---|---|
| Gas drip | 21,000 | 0.0022 |
| Register a till | 71,625 | 0.0074 |
| Customer pays USDC | 100,504 | 0.0104 |
| Sweep a till | 100,516 | 0.0103 |

The node at `wss://testnet-rpc.monad.xyz` serves live subscriptions.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry. `TillRegistry.sol` (owner→till registry, no funds, no shared slots), `MockUSD.sol` (local chain only), deploy script, 10 tests. |
| `web/` | Next.js 16 app. All product code under `web/src`. |
| `web/src/lib/` | Technical core: `passkey.ts` (WebAuthn PRF), `accounts.ts` (BIP-44 derivation, one-call signing sessions), `request.ts` (fragment-borne payment requests, matching), `watch.ts` (websocket→polling transfer detection with catch-up), `ledger.ts` (indexer or chain logs, balances always from chain), `tx.ts` (explicit-gas sends, register, batched per-till sweep with 2s queue, refund planning), `storage.ts`, `staff.ts`. |
| `web/src/app/api/drip/route.ts` | Treasury gas drip: serialised nonce queue, rate limits, 21000 explicit gas. |
| `web/src/proxy.ts` | Strict CSP with per-request nonce. |
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
