import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reference, type Hour } from './reference.js';
import { replay, type MeasuredCurve } from './engine-replay.js';
import { policySchema } from '../policy.js';
const root = new URL('../../../../', import.meta.url);
const read = (p: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(p, root)), 'utf8'));
const history = read('data/research/market_history.json')
  .basis_series as Hour[];
console.log(
  JSON.stringify(
    {
      reference: reference(history),
      engineReplay: replay(
        history,
        read('data/research/hsk_probe.json').mainnet.quotes as MeasuredCurve,
        policySchema.parse(read('policy/default.json')),
      ),
    },
    null,
    2,
  ),
);
