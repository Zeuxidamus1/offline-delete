import { assets } from './assets.js';

const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function html(path, replacements = {}) {
  let page = assets[path].body;
  for (const [marker, content] of Object.entries(replacements)) page = page.replace(marker, content);
  return new Response(page, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
  fetch(request) {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers });
    const path = new URL(request.url).pathname;
    const signedIn = request.headers.has('oai-authenticated-user-id') &&
      request.headers.has('oai-authenticated-user-email');

    if (path === '/') {
      return signedIn
        ? new Response(null, { status: 302, headers: { ...headers, Location: '/dashboard' } })
        : html('/login.html');
    }
    if (path === '/dashboard') {
      return signedIn
        ? html('/dashboard', { '<!-- sign-out -->': '<a class="signout" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out</a>' })
        : new Response(null, { status: 302, headers: { ...headers, Location: '/' } });
    }
    const asset = assets[path];
    if (!asset || asset.type === 'text/html') return new Response('Not found', { status: 404, headers });
    return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.type + '; charset=utf-8' } });
  }
};
