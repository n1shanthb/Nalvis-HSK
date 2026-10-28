import { expect, test } from 'vitest';
import { scaffold } from '../src/index.js';
test('scaffold is available', () => expect(scaffold).toBe('dashboard'));
