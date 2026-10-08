export const erc20Abi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export const registryAbi = [
  {
    type: "function",
    name: "registerTill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "till", type: "address" },
      { name: "label", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "relabelTill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "till", type: "address" },
      { name: "label", type: "string" },
    ],
    outputs: [],
  },
  { type: "function", name: "retireTill", stateMutability: "nonpayable", inputs: [{ name: "till", type: "address" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "till", type: "address" }], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "tillOf",
    stateMutability: "view",
    inputs: [{ name: "till", type: "address" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "label", type: "string" },
      { name: "retired", type: "bool" },
    ],
  },
  {
    type: "event",
    name: "TillRegistered",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "till", type: "address", indexed: true },
      { name: "label", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TillRelabelled",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "till", type: "address", indexed: true },
      { name: "label", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TillRetired",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "till", type: "address", indexed: true },
    ],
  },
] as const;
