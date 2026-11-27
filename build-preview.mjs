import { cp, readFile, writeFile } from 'node:fs/promises';
await cp('public','dist',{recursive:true});
const app = await readFile('public/app.js','utf8');
await writeFile('dist/app.js',app.replace('const request = fetch;', "import { demoRequest as request } from './demo.js';"));
