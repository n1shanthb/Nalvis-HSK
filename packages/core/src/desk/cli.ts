#!/usr/bin/env node
import { DeskParser } from './parser.js';

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: nalvis desk "<query>"');
  process.exit(1);
}

const parser = new DeskParser();
const result = parser.parse(query);

console.log(`[${result.intent}] ${result.response}`);
if (result.diff) {
  console.log('Diff:', JSON.stringify(result.diff, null, 2));
}
if (result.calldataHash) {
  console.log('Calldata Hash:', result.calldataHash);
}
if (result.preparedAction) {
  console.log('Prepared Action:', JSON.stringify(result.preparedAction, null, 2));
}
