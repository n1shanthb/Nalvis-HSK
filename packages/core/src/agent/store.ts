import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical } from '../canonical.js';
export interface Store {
  read<T>(path: string): Promise<T | undefined>;
  write(path: string, value: unknown): Promise<void>;
  writeText(path: string, value: string): Promise<void>;
  append(path: string, line: string): Promise<void>;
  text(path: string): Promise<string>;
}
/** One writer per root, enforced by the service. Writes and appends fsync before returning. */
export function jsonFileStore(root: string): Store {
  const base = resolve(root);
  const path = (key: string) => {
    const p = resolve(join(base, key));
    if (!p.startsWith(base + '/')) throw new Error('Store path escapes root');
    return p;
  };
  return {
    async read<T>(key: string) {
      const raw = await this.text(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    async text(key) {
      try {
        return await readFile(path(key), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw e;
      }
    },
    async write(key, value) {
      return this.writeText(key, canonical(value));
    },
    async writeText(key, value) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      const tmp = p + '.' + randomUUID() + '.tmp';
      const f = await open(tmp, 'wx', 0o600);
      try {
        await f.writeFile(value);
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(tmp, p);
      const dir = await open(dirname(p), 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    },
    async append(key, line) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      const f = await open(p, 'a', 0o600);
      try {
        await f.writeFile(line + '\n');
        await f.sync();
      } finally {
        await f.close();
      }
    },
  };
}
export function memoryStore(): Store {
  const data = new Map<string, string>();
  return {
    async read<T>(p: string) {
      const s = data.get(p);
      return s ? (JSON.parse(s) as T) : undefined;
    },
    async write(p, v) {
      data.set(p, canonical(v));
    },
    async writeText(p, v) {
      data.set(p, v);
    },
    async append(p, l) {
      data.set(p, (data.get(p) ?? '') + l + '\n');
    },
    async text(p) {
      return data.get(p) ?? '';
    },
  };
}
