import { spawn } from 'node:child_process';
import {
  mkdir,
  open,
  readFile,
  rm,
  rename,
  cp,
  readdir,
  realpath,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonFileStore, createJournal } from '../../core/src/agent/index.js';
/** A writable dedicated mount is required unless explicitly opted into ephemeral storage. */
export async function storageReady(data: string, allowEphemeral: boolean) {
  await mkdir(data, { recursive: true });
  const probe = join(data, `.probe-${randomUUID()}`);
  const f = await open(probe, 'wx', 0o600);
  await f.sync();
  await f.close();
  await rm(probe);
  if (allowEphemeral) return;
  const mounts = await readFile('/proc/self/mountinfo', 'utf8');
  const target = await realpath(resolve(data));
  const durable = mounts.split('\n').some((line) => {
    const [before, after] = line.split(' - '),
      point = before?.split(' ')[4]?.replace(/\\040/g, ' ');
    const type = after?.split(' ')[0];
    return (
      point &&
      point !== '/' &&
      (target === point || target.startsWith(point + '/')) &&
      !['tmpfs', 'overlay', 'proc', 'sysfs'].includes(type)
    );
  });
  if (!durable)
    throw Error(
      'Persistent volume required; AGENT_ALLOW_EPHEMERAL=1 explicitly permits local storage',
    );
}
/** Linux advisory lock: kernel releases it on process/container death, even with PID reuse. */
export async function agentLock(root: string) {
  await mkdir(root, { recursive: true });
  const child = spawn(
    'flock',
    [
      '--exclusive',
      '--nonblock',
      join(root, '.service.lock'),
      'sh',
      '-c',
      'printf "READY\\n"; cat >/dev/null',
    ],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  await new Promise<void>((resolve, reject) => {
    child.once('error', () =>
      reject(Error('flock is required for the service writer lock')),
    );
    child.once('exit', () => reject(Error('Agent store already has a writer')));
    child.stdout.once('data', () => resolve());
  });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const done = new Promise<void>((r) => {
      if (child.exitCode !== null) r();
      else child.once('exit', () => r());
    });
    child.stdin.end();
    await done;
    // Keep the lock inode: unlinking it can let concurrent writers lock different files.
  };
}
/** Export only while holding the writer lock or from the service's serialized queue. */
export async function exportSnapshot(root: string, destination: string) {
  const store = jsonFileStore(root);
  await createJournal(store); // Reject truncated/tampered chains.
  if (await store.read('pending.json'))
    throw Error('Unresolved intent; cannot freeze snapshot');
  await store.write('journal.json', (await createJournal(store)).entries);
  const staging = destination + `.staging-${randomUUID()}`;
  await mkdir(staging, { recursive: true });
  const allowed =
    /^(policy\.json|journal\.jsonl|journal\.json|watches\.json|runtime\.json|feed\.json|prompts|evidence|states|policies|receipts)$/;
  for (const name of await readdir(root))
    if (allowed.test(name))
      await cp(join(root, name), join(staging, name), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
}
