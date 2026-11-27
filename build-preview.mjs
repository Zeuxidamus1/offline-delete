import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const files = {
  '/login.html': ['login.html', 'text/html'],
  '/dashboard': ['index.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
  '/demo.js': ['demo.js', 'text/javascript'],
  '/sources.js': ['sources.js', 'text/javascript']
};
const assets = {};
for (const [path, [file, type]] of Object.entries(files)) {
  let body = await readFile(new URL('./public/' + file, import.meta.url), 'utf8');
  if (file === 'app.js') {
    const source = 'const request = fetch;';
    if (!body.includes(source)) throw new Error('Demo transport insertion point is missing.');
    body = body.replace(source, "import { demoRequest as request } from './demo.js';");
  }
  assets[path] = { body, type };
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await copyFile('worker/index.js', 'dist/server/index.js');
await writeFile('dist/server/assets.js', 'export const assets = ' + JSON.stringify(assets) + ';\n');
