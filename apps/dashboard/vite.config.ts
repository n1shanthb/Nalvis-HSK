import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createDeskHandler } from './server/desk.js';
import { createAgentFeedHandler } from './server/agent-feed.js';
import { demoFeedUpstream } from './server/demo-feed.js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory()
      ? jsonFiles(resolve(dir, f.name))
      : f.name.endsWith('.json') && !f.name.endsWith('.simulation.json')
        ? [resolve(dir, f.name)]
        : [],
  );
}
// Serve only JSON under these two explicitly selected directories, in dev and built preview.
function receiptAssets(): Plugin {
  function assets() {
    const files = new Map<string, string>();
    for (const [prefix, dir] of [
      ['receipts', resolve(root, 'receipts')],
      ['deployments', resolve(root, 'contracts/deployments')],
    ]) {
      for (const path of jsonFiles(dir))
        files.set(
          `/${prefix}/${relative(dir, path).split('\\').join('/')}`,
          readFileSync(path, 'utf8'),
        );
    }
    files.set(
      '/receipts/index.json',
      JSON.stringify(
        [...files.keys()].filter((p) => p.startsWith('/receipts/')),
      ),
    );
    return files;
  }
  return {
    name: 'receipt-json',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const body = assets().get((req.url ?? '').split('?')[0]);
        if (body === undefined) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      });
    },
    generateBundle() {
      for (const [path, source] of assets())
        this.emitFile({ type: 'asset', fileName: path.slice(1), source });
    },
  };
}
export default defineConfig({
  plugins: [
    receiptAssets(),
    {
      name: 'desk-server',
      configureServer(server) {
        const feedEnvironment = {
          ...loadEnv(server.config.mode, root, ''),
          ...process.env,
        };
        const agentFeed = createAgentFeedHandler(
          feedEnvironment.AGENT_FEED_UPSTREAM ?? demoFeedUpstream,
          fetch,
          feedEnvironment.AGENT_FEED_PROXY_TOKEN,
        );
        server.middlewares.use('/api/agent', async (req, res) => {
          const response = await agentFeed(
            new Request(`http://localhost/api/agent${req.url ?? ''}`, {
              method: req.method,
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await response.text());
        });
        const handle = createDeskHandler({
          ...loadEnv(server.config.mode, root, ''),
          ...process.env,
        });
        server.middlewares.use('/api/desk', async (req, res) => {
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 4096) {
                res.statusCode = 413;
                res.end();
                return;
              }
              chunks.push(Buffer.from(chunk));
            }
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers))
              if (value)
                headers.set(
                  key,
                  Array.isArray(value) ? value.join(',') : value,
                );
            const response = await handle(
              new Request(`http://${req.headers.host}/api/desk`, {
                method: req.method,
                headers,
                ...(req.method === 'POST'
                  ? { body: Buffer.concat(chunks).toString('utf8') }
                  : {}),
              }),
              req.socket.remoteAddress,
            );
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(await response.text());
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Desk unavailable' }));
          }
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Share view markup and the fixture loader; the canvas library remains lazy.
          if (
            /components\/charts\/(PriceChart|BasisChart|VaultChart)\.tsx$/.test(
              id,
            ) ||
            id.endsWith('/lib/recorded-history.ts')
          )
            return 'chart-views';
          if (id.includes('@ledgerhq/device-management-kit'))
            return 'ledger-device';
          if (id.includes('@ledgerhq/device-signer-kit-ethereum'))
            return 'ledger-ethereum';
          if (id.includes('@ledgerhq/device-transport-kit'))
            return 'ledger-transport';
          if (id.includes('/rxjs/')) return 'ledger-streams';
        },
      },
    },
  },
  server: {
    proxy:
      process.env.ENABLE_CEX_PROXY === 'true'
        ? {
            '/cex/mexc': {
              target: 'https://api.mexc.com',
              changeOrigin: true,
              rewrite: (p) => p.replace(/^\/cex\/mexc/, ''),
            },
            '/cex/gate': {
              target: 'https://api.gateio.ws',
              changeOrigin: true,
              rewrite: (p) => p.replace(/^\/cex\/gate/, ''),
            },
          }
        : undefined,
  },
});
