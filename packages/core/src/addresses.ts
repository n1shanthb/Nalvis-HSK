import { getAddress, type Address } from 'viem';

export type AddressEntry = {
  readonly address: Address;
  readonly decimals?: number;
};
// Decimals omitted for unused tokens: UNVERIFIED; do not infer them.
export const addresses = {
  177: {
    factory: {
      address: getAddress('0x972ca9d1662f5e029cd18327d29026532e84c742'),
    },
    quoterV2: {
      address: getAddress('0x603f70466fddbe3f238220b9a74fff419a2bbfdd'),
    },
    swapRouter02: {
      address: getAddress('0x2c16f75b95cf1390c328ab70e2cee7f4b80bd8f3'),
    },
    universalRouter: {
      address: getAddress('0x76d86a6e224b19270c2cda31477a4c79b2d56918'),
    },
    positionManager: {
      address: getAddress('0xdf0a9b833db0e4ceea103a4408f3b68e7fc0cad5'),
    },
    v4PoolManager: {
      address: getAddress('0xa5ef140471486a25a71cd75ae38a26e945d2e3c4'),
    },
    permit2: {
      address: getAddress('0x000000000022d473030f116ddee9f6b43ac78ba3'),
    },
    multicall: {
      address: getAddress('0xca11bde05977b3631167028862be2a173976ca11'),
    },
    whsk: {
      address: getAddress('0xb210d2120d57b758ee163cffb43e73728c471cf1'),
      decimals: 18,
    },
    usdt: {
      address: getAddress('0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029'),
      decimals: 6,
    },
    weth: { address: getAddress('0xefd4bc9afd210517803f293ababd701caeecdfd0') },
    wbtc: { address: getAddress('0x6119ca49a79f5825c8b345f8d7ac36b272565b14') },
    usdc: { address: getAddress('0x054ed45810dbbab8b27668922d110669c9d88d0a') },
    primaryPool: {
      address: getAddress('0x4ff515761864e7838b0adb8b5b2b8b7a068905dc'),
    },
    wethPool: {
      address: getAddress('0xb92b79ed6b370d5cfee2e14b1d0983c258304c16'),
    },
    wbtcPool: {
      address: getAddress('0xd9ea2ce468957ba49ccc38c4758ed6ecd561449a'),
    },
    apro: {
      address: getAddress('0x86ce42c1b714149dc3a7b17169ef67b5f78a224b'),
      decimals: 8,
    },
  },
  133: {
    factory: {
      address: getAddress('0x2dc2c21d1049f786c535bf9d45f999db5474f3a0'),
    },
    quoterV2: {
      address: getAddress('0x73820d9ee5bf1bfcd429580320fc7a374e8fa1cc'),
    },
    swapRouter02: {
      address: getAddress('0xa6914e66690c6794244b5f66a09eaebf66254237'),
    },
    positionManager: {
      address: getAddress('0x73dec6bfa6751509b08480bd97f54b874e3b20e8'),
    },
    multicall: {
      address: getAddress('0x47f625ec29637445aa1570d7008cf78692cda096'),
    },
    whsk: {
      address: getAddress('0xca8aaceec5db1e91b9ed3a344ba026c4a2b3ebf6'),
      decimals: 18,
    },
    usdt: {
      address: getAddress('0x98b6173a8b7dfc52ce8bc88f1184a918a1ccaa4f'),
      decimals: 18,
    },
    primaryPool: {
      address: getAddress('0xc076fb478b77633736738579c7f48d2539604a50'),
    },
    secondaryPool: {
      address: getAddress('0xff2b7e501c870980bf5641b4a70d0f9fb0f6f6ab'),
    },
  },
} as const satisfies Record<177 | 133, Record<string, AddressEntry>>;

export const CHAIN_ALLOWLIST_WRITE = [133, 31337] as const;
/** Mainnet is opt-in at each signing boundary; decoding/read-only replay is separate. */
export function assertExecutionChain(
  chainId: number,
): asserts chainId is 133 | 177 | 31337 {
  if (![133, 177, 31337].includes(chainId))
    throw new Error(`Unsupported execution chain ${chainId}`);
}
export function assertWritableChain(
  chainId: number,
): asserts chainId is 133 | 31337 {
  if (!CHAIN_ALLOWLIST_WRITE.some((allowed) => allowed === chainId)) {
    throw new Error(`Writes forbidden on chain ${chainId}`);
  }
}
