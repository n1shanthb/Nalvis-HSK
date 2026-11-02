#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(root, '../..');
const captures = path.join(root, 'assets', 'captures');
mkdirSync(captures, {recursive: true});
const tx = '0x7a3020fb769d4181f235dc40483b74fe4c7408a02a311d5e30b3c16390d5722b';
const receipt = 'receipts/177/agent/receipts/0x7866962effe9baba1758c81832dc14d8dd9654a8ee73a23b48b63fbe97501200.json';
const output = execFileSync(process.execPath, [
  'packages/verifier/dist/verifier/src/cli.js', tx, '--receipt', receipt,
  '--rpc', 'https://mainnet.hsk.xyz', '--chain', '177', '--agent-root', 'receipts/177/agent',
], {cwd: repo, encoding: 'utf8', env: {...process.env, NODE_USE_ENV_PROXY: '1'}});
const passes = [...output.matchAll(/\sPASS(?:\s|$)/gm)].length;
if (!output.startsWith('PASS — execution RPC') || passes !== 18)
  throw new Error(`Expected a live 18-check PASS, received ${passes}:\n${output}`);
writeFileSync(path.join(root, 'assets', 'verifier-output.txt'), output);
const escaped = output.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
writeFileSync(path.join(root, 'assets', 'verifier-proof.html'), `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#050806;color:#eaf1eb;font-family:DejaVu Sans,sans-serif}.wrap{width:1920px;height:1080px;padding:72px 90px}.eyebrow{color:#b8ff3d;font:700 16px monospace;letter-spacing:.18em}h1{font-size:52px;margin:14px 0 30px}.terminal{background:#0b110d;border:1px solid #33463a;border-radius:18px;padding:30px 40px;box-shadow:0 28px 80px #0009}pre{margin:0;font:20px/1.42 DejaVu Sans Mono,monospace;white-space:pre-wrap}.pass{position:absolute;right:95px;top:82px;color:#b8ff3d;border:1px solid #739d42;border-radius:99px;padding:12px 20px;font-weight:800}</style>
<div class="wrap"><div class="eyebrow">INDEPENDENT VERIFIER / LIVE MAINNET RPC</div><h1>Receipt sequence 6 — verified</h1><div class="pass">18 / 18 PASS</div><div class="terminal"><pre>${escaped}</pre></div></div>`);

const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
const context = await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,colorScheme:'dark',ignoreHTTPSErrors:true});
const page = await context.newPage();
const shot = (id) => page.screenshot({path:path.join(captures,`${id}.png`)});
const settle = (ms=2500) => page.waitForTimeout(ms);
const center = async (locator) => { await locator.first().scrollIntoViewIfNeeded(); await locator.first().evaluate(n=>n.scrollIntoView({block:'center'})); await settle(700); };
const open = async (route, anchor) => {
  await page.goto('https://nalvis-hsk-delta.vercel.app/?demo=0#/agent',{waitUntil:'domcontentloaded',timeout:60000});
  const choose=page.getByRole('button',{name:/View Nishanth.s mainnet agent/i});
  if(await choose.isVisible().catch(()=>false)) await choose.click();
  if(route!=='agent') await page.locator(`a[href$="#/${route}"]`).first().click();
  await page.locator('main').waitFor({state:'visible'});
  if(anchor) await page.getByText(anchor,{exact:true}).first().waitFor({timeout:30000});
  await settle(route==='agent'?6000:3000);
};
await open('agent','Agent connected'); await center(page.getByText('Strategy & execution',{exact:true})); await shot('s01-agent');
await open('evidence'); await page.locator('main h1, main h2').first().waitFor(); await shot('s02-market');
await open('mandate'); await center(page.getByText('Trade & daily limits',{exact:true})); await shot('s03-mandate');
await open('operations'); await page.locator('main h1, main h2').first().waitFor(); await shot('s04-operations');
await open('activity'); const details=page.locator('main button, main summary').filter({hasText:/Decision details/}).first(); await center(details); if(await details.isVisible().catch(()=>false)) await details.click(); await settle(1200); await shot('s05-activity');
await open('desk'); await center(page.getByRole('heading',{name:'Review a WHSK buy',exact:true})); await shot('s06-copilot');
await page.goto(`https://hsk.blockscout.com/tx/${tx}`,{waitUntil:'domcontentloaded',timeout:60000}); await page.getByText('Success',{exact:true}).first().waitFor({timeout:45000}); await settle(3000); const logs=page.getByText('Logs',{exact:true}).first(); if(await logs.isVisible().catch(()=>false)) await logs.click(); await settle(2500); await shot('s07-swap-proof');
await page.setContent(readFileSync(path.join(root,'assets','verifier-proof.html'),'utf8')); await page.locator('pre').waitFor(); await shot('s08-verifier');
await page.setContent(readFileSync(path.join(root,'architecture.html'),'utf8')); await page.locator('.flow').waitFor(); await shot('s09-architecture');
await browser.close();
console.log(`Captured 9 read-only scenes; verifier: ${passes}/18 PASS`);
