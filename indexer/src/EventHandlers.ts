import { TillRegistry, Token } from "generated";

/*
 * Lane indexer. Only transfers touching a registered till are stored, so the
 * handler stays cheap on a token with millions of unrelated transfers. The
 * ledger groups by till and by day in the query; nothing is accumulated here.
 */

TillRegistry.TillRegistered.handler(async ({ event, context }) => {
  context.Till.set({
    id: event.params.till.toLowerCase(),
    owner: event.params.owner.toLowerCase(),
    label: event.params.label,
    retired: false,
    registeredAt: BigInt(event.block.timestamp),
  });
});

TillRegistry.TillRelabelled.handler(async ({ event, context }) => {
  const till = await context.Till.get(event.params.till.toLowerCase());
  if (till) context.Till.set({ ...till, label: event.params.label });
});

TillRegistry.TillRetired.handler(async ({ event, context }) => {
  const till = await context.Till.get(event.params.till.toLowerCase());
  if (till) context.Till.set({ ...till, retired: true });
});

Token.Transfer.handler(async ({ event, context }) => {
  const to = event.params.to.toLowerCase();
  const from = event.params.from.toLowerCase();
  const [tillTo, tillFrom] = await Promise.all([context.Till.get(to), context.Till.get(from)]);
  const till = tillTo ?? tillFrom;
  if (!till) return;
  context.Transfer.set({
    id: `${event.transaction.hash}:${event.logIndex}`,
    txHash: event.transaction.hash,
    from,
    to,
    value: event.params.value,
    timestamp: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    till: till.id,
    owner: till.owner,
  });
});
