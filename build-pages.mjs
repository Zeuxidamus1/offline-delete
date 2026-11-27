import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) ||
    !SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  throw new Error('Configure SUPABASE_URL and a Supabase publishable key before building.');
}

function page(name, title, header, content) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<link rel="stylesheet" href="./style.css">
<script type="module" src="./auth.js"></script>
</head>
<body data-page="${name}">
<header><a class="brand" href="./">Offline Delete</a>${header}</header>
${content}
</body>
</html>
`;
}

function authPage(name, title, switchText, switchUrl) {
  return page(name, title + ' | Offline Delete', '', `<main>
<section class="auth" aria-labelledby="title">
<h1 id="title">${title}</h1>
<form id="auth-form" method="post">
<label for="email">Email address</label>
<input id="email" type="email" name="email" autocomplete="email" required>
<button type="submit" disabled>${title}</button>
</form>
<p id="status" role="status"></p>
<a class="switch" href="${switchUrl}">${switchText}</a>
</section>
</main>`);
}

const output = new URL('./pages-dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = {
  'index.html': authPage('signin', 'Sign in', 'Create account', './signup.html'),
  'signup.html': authPage('signup', 'Create account', 'Sign in', './'),
  'home.html': page('home', 'Offline Delete', '<button id="signout" type="button" hidden>Sign out</button>', '<main><p id="status" role="status"></p></main>'),
  'dashboard.html': '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./home.html"><title>Offline Delete</title><a href="./home.html">Offline Delete</a></html>',
  '.nojekyll': ''
};
await Promise.all([
  ...Object.entries(files).map(([file, content]) => writeFile(new URL(file, output), content)),
  copyFile(new URL('./pages/style.css', import.meta.url), new URL('style.css', output)),
  build({
    entryPoints: ['pages/auth.js'],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    outfile: 'pages-dist/auth.js',
    define: {
      SUPABASE_URL: JSON.stringify(SUPABASE_URL),
      SUPABASE_PUBLISHABLE_KEY: JSON.stringify(SUPABASE_PUBLISHABLE_KEY)
    }
  })
]);
