# Lane contracts

`TillRegistry.sol` records which till addresses belong to which owner. It holds no funds and has no shared counters, so unrelated merchants never contend on storage. `MockUSD.sol` exists only for the local Anvil chain.

```bash
git submodule update --init   # forge-std
forge test
DEPLOYER_PRIVATE_KEY=... forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
```
