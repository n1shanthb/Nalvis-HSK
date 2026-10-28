import { defineChain, type Chain } from 'viem';

export const hskMainnet: Chain = defineChain({
  id: 177,
  name: 'HashKey Chain',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: {
    default: {
      http: [(typeof process !== 'undefined' && process.env.HSK_MAINNET_RPC) || 'https://mainnet.hsk.xyz'],
    },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://hsk.blockscout.com' },
  },
});
export const hskTestnet: Chain = defineChain({
  id: 133,
  name: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'Test HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: {
    default: {
      http: [(typeof process !== 'undefined' && process.env.HSK_TESTNET_RPC) || 'https://testnet.hsk.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://testnet-explorer.hskchain.net',
    },
  },
  testnet: true,
});
