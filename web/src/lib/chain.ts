import { createPublicClient, defineChain, fallback, http, webSocket, type Address, type Chain, type PublicClient } from "viem";

/**
 * Chain configuration. Monad mainnet (143) is the target, testnet (10143) is the
 * configured fallback, and a local Anvil chain (31337) exists for end-to-end
 * development with the mock stablecoin from contracts/script/Deploy.s.sol.
 *
 * Token and registry addresses are never taken from memory: they come from the
 * environment, which is where the verified addresses belong (architecture §13).
 */

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"], webSocket: ["wss://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "https://monadexplorer.com" } },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"], webSocket: ["wss://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monad Testnet Explorer", url: "https://testnet.monadexplorer.com" } },
  testnet: true,
});

export const localChain = defineChain({
  id: 31337,
  name: "Lane Local",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"], webSocket: ["ws://127.0.0.1:8545"] } },
});

export type ChainKey = "mainnet" | "testnet" | "local";

function pickChain(key: string | undefined): Chain {
  switch (key) {
    case "mainnet":
      return monad;
    case "testnet":
      return monadTestnet;
    default:
      return localChain;
  }
}

const chainKey = (process.env.NEXT_PUBLIC_CHAIN as ChainKey | undefined) ?? "local";

function requireAddress(name: string, value: string | undefined): Address {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} is not set to a valid address. Copy web/.env.example to web/.env.local and fill it in.`);
  }
  return value as Address;
}

export const config = {
  chainKey,
  chain: pickChain(chainKey),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || pickChain(chainKey).rpcUrls.default.http[0],
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || undefined,
  indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL || undefined,
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL || pickChain(chainKey).blockExplorers?.default.url,
  token: {
    get address(): Address {
      return requireAddress("NEXT_PUBLIC_TOKEN_ADDRESS", process.env.NEXT_PUBLIC_TOKEN_ADDRESS);
    },
    symbol: process.env.NEXT_PUBLIC_TOKEN_SYMBOL || "USD",
    decimals: Number(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || 6),
  },
  get registryAddress(): Address {
    return requireAddress("NEXT_PUBLIC_REGISTRY_ADDRESS", process.env.NEXT_PUBLIC_REGISTRY_ADDRESS);
  },
  /** Display-only expiry for a payment request (flow §4.8). */
  requestExpiryMs: 15 * 60 * 1000,
  /** Two sweeps from one till inside this window are queued, not sent (architecture §6). */
  sweepWindowMs: 2000,
} as const;

let _public: PublicClient | undefined;
/** HTTP client for reads. One per page lifetime. */
export function publicClient(): PublicClient {
  if (_public) return _public;
  _public = createPublicClient({
    chain: config.chain,
    transport: fallback([http(config.rpcUrl, { batch: true, retryCount: 3 })]),
    pollingInterval: 1000,
  });
  return _public;
}

/** WebSocket client for subscriptions, or undefined when no socket endpoint is configured. */
export function socketClient(): PublicClient | undefined {
  if (!config.wsUrl) return undefined;
  return createPublicClient({
    chain: config.chain,
    transport: webSocket(config.wsUrl, { reconnect: { attempts: 5, delay: 1000 }, retryCount: 2 }),
  });
}

export function explorerTx(hash: string): string | undefined {
  return config.explorerUrl ? `${config.explorerUrl}/tx/${hash}` : undefined;
}
