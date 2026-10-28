import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true}).flatMap(f => f.isDirectory() ? jsonFiles(resolve(dir, f.name)) : f.name.endsWith('.json') ? [resolve(dir, f.name)] : []);
}
// Serve only JSON under these two explicitly selected directories, in dev and built preview.
function receiptAssets(): Plugin {
  function assets() {
    const files = new Map<string, string>();
    for (const [prefix, dir] of [['receipts', resolve(root, 'receipts')], ['deployments', resolve(root, 'contracts/deployments')]]) {
      for (const path of jsonFiles(dir)) files.set(`/${prefix}/${relative(dir, path).split('\\').join('/')}`, readFileSync(path, 'utf8'));
    }
    files.set('/receipts/index.json', JSON.stringify([...files.keys()].filter(p => p.startsWith('/receipts/'))));
    return files;
  }
  return {name: 'receipt-json', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const body = assets().get((req.url ?? '').split('?')[0]);
      if (body === undefined) return next();
      res.setHeader('Content-Type', 'application/json'); res.end(body);
    });
  }, generateBundle() { for (const [path, source] of assets()) this.emitFile({type: 'asset', fileName: path.slice(1), source}); }};
}
export default defineConfig({plugins: [receiptAssets()], server: {proxy: process.env.ENABLE_CEX_PROXY === 'true' ? {
  '/cex/mexc': {target: 'https://api.mexc.com', changeOrigin: true, rewrite: p => p.replace(/^\/cex\/mexc/, '')},
  '/cex/gate': {target: 'https://api.gateio.ws', changeOrigin: true, rewrite: p => p.replace(/^\/cex\/gate/, '')},
} : undefined}});
