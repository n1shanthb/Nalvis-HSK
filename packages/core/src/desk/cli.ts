#!/usr/bin/env node
import { desk } from './index.js';
if (process.argv[2] !== 'desk') { console.error('Usage: nalvis desk "<text>"'); process.exitCode = 1; }
else console.log(JSON.stringify(desk(process.argv.slice(3).join(' ')), null, 2));
