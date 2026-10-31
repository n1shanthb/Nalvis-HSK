import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
test('built dashboard contains no env files or key markers', () => {
  const root = resolve(import.meta.dirname, '../dist');
  // Acceptance workflow builds before tests. Fail clearly if that order is missed.
  expect(
    existsSync(root),
    'Run pnpm -r build before the production-asset scan',
  ).toBe(true);
  // Match key prefixes at token boundaries: CSS desk-* and React mask-type are not keys.
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      expect(entry.name.startsWith('.env')).toBe(false);
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(js|json|html|css|map)$/.test(entry.name))
        expect(
          readFileSync(path, 'utf8').match(
            /PRIVATE_KEY|(?<![A-Za-z0-9_])(?:sk-|gsk_)/g,
          ),
          path,
        ).toBeNull();
    }
  };
  scan(root);
});
