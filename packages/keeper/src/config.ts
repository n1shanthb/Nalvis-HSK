import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getAddress, zeroAddress } from 'viem';
import { assertWritableChain, policySchema } from '../../core/src/index.js';

export function repositoryRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Repository root not found');
    dir = parent;
  }
}
export const modes = ['dry', 'anvil', 'testnet'] as const;
export const optionsSchema = z.object({
  exec: z.enum(modes).default('dry'),
  target: z.enum(['vault', 'router']).default('vault'),
  preset: z.enum(['conservative', 'balanced', 'patient']).default('balanced'),
  once: z.boolean().default(false),
  interval: z.coerce.number().int().min(30).default(300),
  demo: z.enum(['trade', 'resize', 'wait', 'reject']).optional(),
  receipts: z.string().default('receipts'),
  deployment: z.string().optional(),
});
export type Options = z.infer<typeof optionsSchema>;
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((a) => getAddress(a))
  .refine((a) => a !== zeroAddress);
export const deploymentSchema = z
  .object({
    vault: address,
    router: address,
    owner: address,
    agent: address,
    deployer: address,
    block: z.coerce.bigint().nonnegative(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .refine(
    (d) =>
      new Set([d.owner, d.agent, d.deployer].map((a) => a.toLowerCase()))
        .size === 3,
    'Roles must be distinct',
  );
export type Deployment = z.infer<typeof deploymentSchema>;
export function loadDeployment(
  chainId: number,
  path?: string,
  mainnet = false,
): Deployment {
  if (chainId !== 177 || !mainnet) assertWritableChain(chainId);
  // T3 writes manifests relative to the Foundry project root.
  return deploymentSchema.parse(
    JSON.parse(
      readFileSync(
        path ?? join(repositoryRoot(), `contracts/deployments/${chainId}.json`),
        'utf8',
      ),
    ),
  );
}
export function loadPolicy() {
  return policySchema.parse(
    JSON.parse(
      readFileSync(join(repositoryRoot(), 'policy/default.json'), 'utf8'),
    ),
  );
}
export function parseOptions(argv: string[]): Options {
  if (argv.shift() !== 'run')
    throw new Error(
      'Usage: keeper run [--once] [--interval 300] --exec dry|anvil|testnet --target vault|router --preset balanced [--demo trade|resize|wait|reject]',
    );
  const values: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].slice(2);
    if (
      !argv[i].startsWith('--') ||
      ![
        'exec',
        'target',
        'preset',
        'once',
        'interval',
        'demo',
        'receipts',
        'deployment',
      ].includes(key)
    )
      throw new Error(`Unknown option ${argv[i]}`);
    if (key in values) throw new Error(`Duplicate option ${key}`);
    values[key] = key === 'once' ? true : argv[++i];
    if (values[key] === undefined) throw new Error(`Missing value for ${key}`);
  }
  return optionsSchema.parse(values);
}
export function assertTestnetHuman(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'test' || env.CI === 'true')
    throw new Error('Testnet is human-run only; refused in test/CI');
}
export function assertLocalAnvil(url: string) {
  const u = new URL(url);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  )
    throw new Error('Anvil execution requires a loopback RPC');
}
