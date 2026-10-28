import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const names = ['EdgewiseVault', 'ProofTradeRouter', 'IQuoterV2', 'IERC20'];
mkdirSync('packages/core/src/abi', { recursive: true });
for (const name of names) {
  const artifact = JSON.parse(
    readFileSync(`contracts/out/${name}.sol/${name}.json`, 'utf8'),
  );
  if (!Array.isArray(artifact.abi)) throw new Error(`Missing ABI: ${name}`);
  writeFileSync(
    `packages/core/src/abi/${name}.ts`,
    `// Generated from contracts/out by scripts/export-abis.mjs. Do not edit.\nexport const ${name}Abi = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`,
  );
}
