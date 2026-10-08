# Lane indexer

Envio indexer for the registry contract and token transfers into registered tills.
Set the two contract addresses in `config.yaml`, then `npm i && npm run codegen && npm run dev`.
Point `NEXT_PUBLIC_INDEXER_URL` in `web/.env.local` at the GraphQL endpoint it prints.

The app does not depend on it: with no indexer configured the ledger reads logs
directly from the chain and balances always come from the chain.
