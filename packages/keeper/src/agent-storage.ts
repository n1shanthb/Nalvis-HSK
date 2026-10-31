import {
  mkdir,
  open,
  readFile,
  rm,
  rename,
  cp,
  readdir,
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
  const target = resolve(data);
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
/** Exclusive process lock; dead local PIDs can be recovered, live writers cannot. */
export async function agentLock(root: string) {
  await mkdir(root, { recursive: true });
  const lock = join(root, '.service.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const f = await open(lock, 'wx', 0o600);
      await f.writeFile(String(process.pid));
      await f.sync();
      await f.close();
      return () => rm(lock, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(await readFile(lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw Error('Invalid service lock; inspect manually');
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          await rm(lock);
          continue;
        }
        throw error;
      }
      throw Error('Agent store already has a writer');
    }
  }
  throw Error('Could not acquire service lock');
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
