import type { Address, Log } from "viem";
import { erc20Abi } from "./abi";
import { config, publicClient, socketClient } from "./chain";

export interface IncomingTransfer {
  txHash: `0x${string}`;
  logIndex: number;
  from: Address;
  to: Address;
  amount: bigint;
  blockNumber: bigint;
  time: number;
}

export type WatchStatus = "connecting" | "live" | "polling" | "offline";

/**
 * Watch token transfers into a till. Prefers a websocket subscription and falls
 * back to polling when the socket drops. On every (re)connect it also replays
 * logs since the last block seen, so a payment that landed while the merchant's
 * phone was offline is still surfaced (flow §4.6).
 */
export function watchTransfers(opts: {
  till: Address;
  onTransfer: (t: IncomingTransfer) => void;
  onStatus?: (s: WatchStatus) => void;
}): () => void {
  const token = config.token.address;
  const http = publicClient();
  const seen = new Set<string>();
  let lastBlock: bigint | undefined;
  let stopped = false;
  let unwatch: (() => void) | undefined;
  let status: WatchStatus = "connecting";

  const setStatus = (s: WatchStatus) => {
    if (s !== status) {
      status = s;
      opts.onStatus?.(s);
    }
  };

  const timeCache = new Map<bigint, number>();
  async function blockTime(n: bigint): Promise<number> {
    const cached = timeCache.get(n);
    if (cached) return cached;
    try {
      const b = await http.getBlock({ blockNumber: n });
      const t = Number(b.timestamp) * 1000;
      timeCache.set(n, t);
      return t;
    } catch {
      return Date.now();
    }
  }

  async function handle(logs: Log[]) {
    for (const log of logs) {
      if (!log.transactionHash || log.logIndex == null || log.blockNumber == null) continue;
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const args = (log as unknown as { args: { from: Address; to: Address; value: bigint } }).args;
      if (!args) continue;
      if (lastBlock === undefined || log.blockNumber > lastBlock) lastBlock = log.blockNumber;
      opts.onTransfer({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        from: args.from,
        to: args.to,
        amount: args.value,
        blockNumber: log.blockNumber,
        time: await blockTime(log.blockNumber),
      });
    }
  }

  /** Replay anything missed since the last block seen. */
  async function catchUp() {
    try {
      const head = await http.getBlockNumber();
      const from = lastBlock !== undefined ? lastBlock + 1n : head > 2000n ? head - 2000n : 0n;
      if (from > head) return;
      const logs = await http.getContractEvents({
        address: token,
        abi: erc20Abi,
        eventName: "Transfer",
        args: { to: opts.till },
        fromBlock: from,
        toBlock: head,
      });
      await handle(logs as Log[]);
      if (lastBlock === undefined || head > lastBlock) lastBlock = head;
    } catch {
      setStatus("offline");
    }
  }

  function startPolling() {
    if (stopped) return;
    setStatus("polling");
    unwatch = http.watchContractEvent({
      address: token,
      abi: erc20Abi,
      eventName: "Transfer",
      args: { to: opts.till },
      poll: true,
      pollingInterval: 1000,
      onLogs: (logs) => {
        setStatus("polling");
        void handle(logs as Log[]);
      },
      onError: () => setStatus("offline"),
    });
  }

  function startSocket() {
    const ws = socketClient();
    if (!ws) return startPolling();
    try {
      unwatch = ws.watchContractEvent({
        address: token,
        abi: erc20Abi,
        eventName: "Transfer",
        args: { to: opts.till },
        onLogs: (logs) => {
          setStatus("live");
          void handle(logs as Log[]);
        },
        onError: () => {
          unwatch?.();
          startPolling();
        },
      });
      setStatus("live");
    } catch {
      startPolling();
    }
  }

  void catchUp().then(() => {
    if (!stopped) startSocket();
  });

  const onOnline = () => {
    void catchUp().then(() => {
      if (status === "offline") {
        unwatch?.();
        startSocket();
      }
    });
  };
  const onOffline = () => setStatus("offline");
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  // A periodic catch-up guards against a silent socket.
  const interval = window.setInterval(() => void catchUp(), 15_000);

  return () => {
    stopped = true;
    unwatch?.();
    window.clearInterval(interval);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
