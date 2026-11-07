import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const config = JSON.parse(await fs.readFile(path.join(root, 'config/shared.json'), 'utf8'));
if (process.env.API_ORIGIN) config.apiOrigin = new URL(process.env.API_ORIGIN).origin;
if (config.backend !== 'shared') throw new Error('The static release requires the shared backend.');
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(root, 'public'), output, { recursive: true });
await fs.mkdir(path.join(output, 'vendor/bulma'), { recursive: true });
await fs.cp(path.join(root, 'node_modules/leaflet/dist'), path.join(output, 'vendor/leaflet'), { recursive: true });
await fs.copyFile(path.join(root, 'node_modules/bulma/css/bulma.min.css'), path.join(output, 'vendor/bulma/bulma.min.css'));
await fs.writeFile(path.join(output, 'runtime-config.json'), JSON.stringify(config, null, 2));
// A previously installed legacy worker must not keep serving old authentication.
await fs.writeFile(path.join(output, 'service-worker.js'), `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('walk-audit-')) await caches.delete(key);
  await self.registration.unregister();
  await self.clients.claim();
})()));\n`);
console.log('Built static shared-API frontend in dist.');
