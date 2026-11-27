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
<link rel="stylesheet" href="./account-access.css">
<script type="module" src="./github-auth.js"></script>
</head>
<body data-page="${name}">
<header><a class="brand" href="./">Offline Delete</a>${header}</header>
${content}
</body>
</html>
`;
}

function accountPage(name, title, switchText, switchLink) {
  return page(name, title + ' | Offline Delete', '', `<main class="account-layout">
<section class="auth" aria-labelledby="title">
<div class="account-content">
<span class="account-mark" aria-hidden="true"><span></span></span>
<h1 id="title">${title}</h1>
<button id="github-signin" type="button" disabled>Continue with GitHub</button>
<p id="status" role="status"></p>
</div>
<div class="account-switch"><a href="${switchLink}">${switchText}</a></div>
</section>
</main>`);
}

const output = new URL('./pages-dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = {
  'index.html': accountPage('signin', 'Sign in', 'Create account', './signup.html'),
  'signup.html': accountPage('signup', 'Create account', 'Sign in', './'),
  'home.html': page('home', 'Offline Delete', '<button id="signout" type="button" hidden>Sign out</button>', '<main><p id="status" role="status"></p></main>'),
  'dashboard.html': '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./home.html"><title>Offline Delete</title><a href="./home.html">Offline Delete</a></html>',
  '.nojekyll': ''
};
await Promise.all([
  ...Object.entries(files).map(([file, content]) => writeFile(new URL(file, output), content)),
  copyFile(new URL('./pages/style.css', import.meta.url), new URL('account-access.css', output)),
  build({
    entryPoints: ['pages/auth.js'],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    outfile: 'pages-dist/github-auth.js',
    define: {
      SUPABASE_URL: JSON.stringify(SUPABASE_URL),
      SUPABASE_PUBLISHABLE_KEY: JSON.stringify(SUPABASE_PUBLISHABLE_KEY)
    }
  })
]);
