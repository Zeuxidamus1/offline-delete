import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) ||
    !SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  throw new Error('Configure SUPABASE_URL and a Supabase publishable key before building.');
}
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const output = new URL('./pages-dist/', import.meta.url);
await mkdir(output, { recursive: true });

const login = (await read('./public/login.html'))
  .replace('href="/style.css"', 'href="./style.css"')
  .replace('href="/"', 'href="./"')
  .replace('Use your ChatGPT account to open your privacy dashboard.',
    'Enter your email to receive a sign-in link.')
  .replace(/<a class="primary signin".*?<\/a>/,
    '<form id="email-login" hidden><label class="field" for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required><button class="primary signin" type="submit">Send Sign-in Link</button></form><p id="login-feedback" role="status"></p>');
const dashboard = (await read('./public/index.html'))
  .replace('href="/style.css"', 'href="./style.css"')
  .replace('href="/"', 'href="./"')
  .replace('<script type="module" src="/app.js"></script>', '')
  .replace('<body>', '<body><div id="signed-in" hidden>')
  .replace('<!-- sign-out -->', '<button id="signout" class="link-button" type="button">Sign out</button>')
  .replace('</body>', '</div></body>');
const attachAuth = html => html.replace('</head>', '<script type="module" src="./auth.js"></script></head>');

await Promise.all([
  writeFile(new URL('index.html', output), attachAuth(login)),
  writeFile(new URL('dashboard.html', output), attachAuth(dashboard)),
  writeFile(new URL('style.css', output), await read('./public/style.css')),
  writeFile(new URL('.nojekyll', output), ''),
  build({
    entryPoints: ['pages/auth.js'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: 'pages-dist/auth.js',
    define: {
      SUPABASE_URL: JSON.stringify(SUPABASE_URL),
      SUPABASE_PUBLISHABLE_KEY: JSON.stringify(SUPABASE_PUBLISHABLE_KEY)
    },
    plugins: [{
      name: 'demo-dashboard',
      setup(builder) {
        builder.onLoad({ filter: /[/\\]public[/\\]app\.js$/ }, async ({ path }) => {
          const source = await readFile(path, 'utf8');
          if (!source.includes('const request = fetch;')) throw new Error('Missing demo transport hook.');
          return {
            contents: source.replace('const request = fetch;', "import { demoRequest as request } from './demo.js';"),
            resolveDir: new URL('./public/', import.meta.url).pathname
          };
        });
      }
    }]
  })
]);
