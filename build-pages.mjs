import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) ||
    !SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
  throw new Error('Configure SUPABASE_URL and a Supabase publishable key before building.');
}

const assetVersion = (process.env.GITHUB_SHA || 'profile-fields-v2').slice(0,12);

function page(name, title, header, content) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<link rel="stylesheet" href="./account-password.css?v=${assetVersion}">
<script type="module" src="./account-password.js?v=${assetVersion}"></script>
</head>
<body data-page="${name}">
<header><a class="brand" href="${(name === 'home' || name === 'profile' || ['dashboard','scan-results','removals','monitoring'].includes(name)) ? '/offline-delete/home.html' : './'}">Offline Delete</a>${header}</header>
${content}
</body>
</html>
`;
}

function accountPage(name, title, switchText, switchLink) {
  const signingUp = name === 'signup';
  const length = signingUp ? ' minlength="8"' : '';
  return page(name, title + ' | Offline Delete', '', `<main class="account-layout">
<section class="auth" aria-labelledby="title">
<div class="account-content">
<span class="account-mark" aria-hidden="true"><span></span></span>
<h1 id="title">${title}</h1>
<form id="password-auth" method="post">
<label for="email">Email address</label>
<input id="email" name="email" type="email" autocomplete="email" required>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="${signingUp ? 'new-password' : 'current-password'}"${length} required>
<button type="submit">${title}</button>
</form>
<div class="auth-divider" aria-hidden="true">or</div>
<button id="github-signin" type="button">Continue with GitHub</button>
<p id="status" role="status"></p>
</div>
<div class="account-switch"><a href="${switchLink}">${switchText}</a></div>
</section>
</main>`);
}

const homeMarkup = "<main class=\"landing\" id=\"top\">\n  <div class=\"ambient ambient-left\" aria-hidden=\"true\"></div><div class=\"ambient ambient-right\" aria-hidden=\"true\"></div>\n  <div class=\"landing-container\">\n    <section class=\"hero\" aria-labelledby=\"hero-title\">\n      <div class=\"hero-copy\">\n        <span class=\"eyebrow\">♙ &nbsp; Privacy &amp; Data Removal Service</span>\n        <h1 id=\"hero-title\">Take Your Personal<br>Information <em>Offline</em></h1>\n        <p>Find exposed personal information on people-search websites, manage opt-out requests, and regain control of your privacy.</p>\n        <div class=\"hero-buttons\">\n          <a class=\"cta primary-cta\" href=\"./dashboard.html\">Start My Removal <span aria-hidden=\"true\">→</span></a>\n          <a class=\"cta secondary-cta\" href=\"#how-it-works\"><span aria-hidden=\"true\">▷</span> See How It Works</a>\n        </div>\n        <div class=\"trust-notes\"><span>♢ &nbsp; Privacy focused</span><span>ϟ &nbsp; Guided opt-outs</span><span>♙ &nbsp; Your information, your control</span></div>\n      </div>\n      <div class=\"dashboard-demo\" aria-label=\"Illustrative dashboard preview with sample data\">\n        <div class=\"demo-rail\">\n          <div class=\"demo-brand\"><span class=\"brand-shield\">♢</span> Offline Delete</div>\n          <div class=\"demo-tab selected\">⌂ <span>Dashboard</span></div>\n          <div class=\"demo-tab\">⌕ <span>Scan Results</span></div>\n          <div class=\"demo-tab\">▱ <span>Removals</span></div>\n          <div class=\"demo-tab\">♧ <span>Monitoring</span></div>\n          <a href=\"/offline-delete/profile.html\" class=\"demo-tab\">♙ <span>Account</span></a>\n        </div>\n        <div class=\"demo-body\">\n          <div class=\"demo-head\"><div><div class=\"sample-label\">ILLUSTRATIVE PREVIEW</div><h2>Your Privacy Dashboard</h2><p>Review and track personal information exposure.</p></div><span class=\"demo-avatar\" aria-hidden=\"true\">●</span></div>\n          <div class=\"demo-columns\">\n            <div class=\"demo-primary\">\n              <div class=\"demo-progress\"><span class=\"demo-lock\" aria-hidden=\"true\">♢</span><div><strong>Removal progress</strong><small>Example tracking overview</small><div class=\"demo-meter\"><span></span></div></div><strong class=\"progress-value\">72%</strong></div>\n              <div class=\"demo-sites\"><div class=\"demo-sites-head\"><strong>People-Search Sites</strong><span>Example results</span></div>\n                <div class=\"site-row\"><span class=\"site-monogram\">W</span><span>Whitepages</span><span class=\"site-state pending\">Pending</span></div>\n                <div class=\"site-row\"><span class=\"site-monogram\">S</span><span>Spokeo</span><span class=\"site-state pending\">Pending</span></div>\n                <div class=\"site-row\"><span class=\"site-monogram\">B</span><span>BeenVerified</span><span class=\"site-state complete\">✓ Reviewed</span></div>\n                <div class=\"site-row\"><span class=\"site-monogram\">F</span><span>FamilyTreeNow</span><span class=\"site-state complete\">✓ Reviewed</span></div>\n              </div>\n            </div>\n            <div class=\"demo-scan\"><h3>Scan Results</h3><small>Illustrative categories</small><div>♙ <span>Name</span> <b>✓</b></div><div>♧ <span>Phone number</span> <b>✓</b></div><div>⌖ <span>Address</span> <b>✓</b></div><div>✉ <span>Email</span> <b>✓</b></div></div>\n          </div>\n        </div>\n      </div>\n    </section>\n    <section class=\"steps\" id=\"how-it-works\" aria-labelledby=\"steps-title\">\n      <h2 id=\"steps-title\">How It Works</h2>\n      \n      <div class=\"steps-grid\">\n        <article class=\"step\"><span class=\"step-number\">1</span><div><h3>Scan &amp; Discover</h3><p>Find where your personal information may appear online.</p></div></article>\n        <span class=\"step-arrow\" aria-hidden=\"true\">→</span>\n        <article class=\"step\"><span class=\"step-number\">2</span><div><h3>Remove for You</h3><p>Use guided official opt-out requests to seek removal from supported sites.</p></div></article>\n        <span class=\"step-arrow\" aria-hidden=\"true\">→</span>\n        <article class=\"step\"><span class=\"step-number\">3</span><div><h3>Stay Protected</h3><p>Track your requests and revisit listings to check whether they remain visible.</p></div></article>\n      </div>\n      \n    </section>\n    <div class=\"landing-spacer\" aria-hidden=\"true\"></div>\n    <footer class=\"landing-footer\"><div class=\"footer-left\"><span class=\"footer-logo\">♢ &nbsp; Offline Delete</span><span class=\"footer-divider\"></span><span>Take your personal information offline.</span></div><nav aria-label=\"Footer\"><a href=\"#how-it-works\">How It Works</a><a href=\"#pricing\">Pricing</a><a href=\"#faq\">FAQ</a><a href=\"mailto:privacy@example.invalid\" class=\"placeholder-link\" hidden>Contact</a></nav></footer>\n    <div class=\"info-anchors\"><section id=\"pricing\"><h2>Pricing</h2><p>Pricing has not been announced.</p></section><section id=\"faq\"><h2>FAQ</h2><p>This early version provides guided opt-out information. Automated removals and ongoing monitoring are not yet available.</p></section></div>\n  </div>\n</main>";
const homeNavigation = "<nav class=\"landing-nav\" aria-label=\"Main navigation\"><a href=\"./home.html#how-it-works\">How It Works</a><a href=\"./home.html#pricing\">Pricing</a><a href=\"./home.html#faq\">FAQ</a><a href=\"./dashboard.html\">Dashboard</a><a href=\"./profile.html\">My Profile</a><button id=\"signout\" class=\"nav-outline\" type=\"button\" hidden>Log Out</button></nav>";

const profileMarkup = "<main class=\"profile-page\">\n  <section class=\"profile-card\">\n    <div class=\"profile-top\"><a href=\"./home.html\" class=\"back-link\">← Back to Home</a><span class=\"profile-lock\">♢ Private Profile</span></div>\n    <h1>My Profile</h1>\n    <form id=\"profile-form\" autocomplete=\"on\">\n      <div class=\"profile-grid\">\n        <label class=\"profile-field\">First Name <input name=\"first_name\" maxlength=\"80\" required autocomplete=\"given-name\"></label>\n        <label class=\"profile-field\">Middle Name (optional) <input name=\"middle_name\" maxlength=\"80\" autocomplete=\"additional-name\"></label>\n        <label class=\"profile-field\">Last Name <input name=\"last_name\" maxlength=\"80\" required autocomplete=\"family-name\"></label>\n        <label class=\"profile-field\">Other name (optional) <input name=\"alternate_name\" maxlength=\"120\" autocomplete=\"off\" placeholder=\"Maiden or previous name\"></label>\n        <label class=\"profile-field\">Phone number (optional) <input name=\"phone\" type=\"tel\" maxlength=\"25\" autocomplete=\"tel\"></label>\n        <label class=\"profile-field\">Street address (optional) <input name=\"street_address\" maxlength=\"160\" autocomplete=\"street-address\"></label>\n        <label class=\"profile-field\">City (optional) <input name=\"city\" maxlength=\"100\" autocomplete=\"address-level2\"></label>\n        <label class=\"profile-field\">State (optional) <input name=\"state\" maxlength=\"80\" autocomplete=\"address-level1\"></label>\n        <label class=\"profile-field\">ZIP code (optional) <input name=\"postal_code\" maxlength=\"15\" autocomplete=\"postal-code\"></label>\n      </div>\n      <label class=\"profile-consent\"><input name=\"consent_to_search\" type=\"checkbox\"> <span>I authorize Offline Delete to use these details for future searches and opt-out requests I initiate.</span></label>\n      <div class=\"profile-actions\"><button type=\"submit\" id=\"save-profile\">Save Profile</button><button type=\"button\" id=\"delete-profile\" class=\"danger-outline\" hidden>Delete Profile</button></div>\n    </form>\n    <p id=\"status\" class=\"profile-status\" role=\"status\" aria-live=\"polite\">Loading profile…</p>\n    <div id=\"profile-toast\" class=\"profile-toast\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\" hidden><span class=\"profile-toast-icon\" aria-hidden=\"true\">✓</span><span id=\"profile-toast-message\"></span><button type=\"button\" id=\"profile-toast-close\" class=\"profile-toast-close\" aria-label=\"Dismiss notification\">×</button></div>\n  </section>\n</main>";

const appNavigation = "<nav class=\"app-nav\" aria-label=\"Customer navigation\">\n<a href=\"./home.html\">Home</a><a href=\"./dashboard.html\">Dashboard</a><a href=\"./scan-results.html\">Scan Results</a><a href=\"./removals.html\">Removals</a><a href=\"./monitoring.html\">Monitoring</a><a href=\"./profile.html\">My Profile</a><button id=\"signout\" type=\"button\" hidden>Log Out</button>\n</nav>";
const appPages = {"dashboard":"<main class=\"app-main\"><div id=\"app-status\" role=\"status\" aria-live=\"polite\"></div><div class=\"app-title-row\"><div><h1>My Privacy Dashboard</h1><p id=\"profile-greeting\"></p></div><a class=\"app-link-button\" href=\"./profile.html\">Edit Profile</a></div>\n<div class=\"app-stats\"><article><span>Exposures</span><strong id=\"count-exposures\">—</strong></article><article><span>Pending Requests</span><strong id=\"count-pending\">—</strong></article><article><span>Verified Removed</span><strong id=\"count-removed\">—</strong></article></div>\n<div class=\"app-two-column\"><section class=\"app-panel\"><div class=\"app-panel-heading\"><h2>Privacy Scan</h2><span id=\"scan-state\" class=\"app-pill\">Checking</span></div><p id=\"scan-summary\">Loading scan history…</p><button class=\"app-main-button\" id=\"start-scan\" type=\"button\" disabled>Start Privacy Scan</button><p class=\"app-hint\" id=\"scan-action-note\">Scanning will be enabled when supported sources are connected.</p></section><section class=\"app-panel\"><h2>My Profile</h2><p id=\"profile-state\">Checking saved profile…</p><a class=\"app-text-link\" href=\"./profile.html\">Manage profile →</a></section></div>\n<section class=\"app-panel\"><div class=\"app-panel-heading\"><h2>Recent Activity</h2><a href=\"./scan-results.html\" class=\"app-text-link\">View Results →</a></div><div id=\"recent-activity\" class=\"app-empty\">No scan activity yet.</div></section></main>","scan-results":"<main class=\"app-main\"><div id=\"app-status\" role=\"status\" aria-live=\"polite\"></div><div class=\"app-title-row\"><h1>Scan Results</h1><a class=\"app-link-button\" href=\"./dashboard.html\">Dashboard</a></div><section class=\"app-panel\"><div class=\"app-panel-heading\"><h2>Detected Listings</h2><span id=\"finding-count\" class=\"app-pill\">—</span></div><div id=\"findings-list\" class=\"app-empty\">Loading findings…</div></section></main>","removals":"<main class=\"app-main\"><div id=\"app-status\" role=\"status\" aria-live=\"polite\"></div><div class=\"app-title-row\"><h1>Removals</h1><a class=\"app-link-button\" href=\"./scan-results.html\">Scan Results</a></div><section class=\"app-panel\"><div class=\"app-panel-heading\"><h2>Removal Requests</h2><span id=\"removal-count\" class=\"app-pill\">—</span></div><div id=\"removals-list\" class=\"app-empty\">Loading requests…</div></section></main>","monitoring":"<main class=\"app-main\"><div id=\"app-status\" role=\"status\" aria-live=\"polite\"></div><div class=\"app-title-row\"><h1>Monitoring</h1><a class=\"app-link-button\" href=\"./dashboard.html\">Dashboard</a></div><div class=\"app-two-column\"><section class=\"app-panel\"><h2>Latest Scan</h2><p id=\"monitor-last\">Loading…</p></section><section class=\"app-panel\"><h2>Monthly Rescans</h2><span class=\"app-pill\">Not enabled</span><p>Automatic monthly monitoring will be available when scanning and subscriptions are connected.</p></section></div><section class=\"app-panel\"><h2>Scan History</h2><div id=\"monitor-history\" class=\"app-empty\">No scans yet.</div></section></main>"};

const output = new URL('./pages-dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = {
  'index.html': accountPage('signin', 'Sign in', 'Create account', './signup.html'),
  'signup.html': accountPage('signup', 'Create account', 'Sign in', './'),
  'home.html': page('home', 'Offline Delete', homeNavigation, homeMarkup + '<p id="status" role="status" class="auth-status"></p>'),
  'profile.html': page('profile', 'My Profile | Offline Delete', '<nav class="profile-nav"><a href="./home.html">Home</a><button id="signout" type="button" hidden>Log Out</button></nav>', profileMarkup),
  'dashboard.html': page('dashboard', 'Dashboard | Offline Delete', appNavigation, appPages.dashboard),
  'scan-results.html': page('scan-results', 'Scan Results | Offline Delete', appNavigation, appPages['scan-results']),
  'removals.html': page('removals', 'Removals | Offline Delete', appNavigation, appPages.removals),
  'monitoring.html': page('monitoring', 'Monitoring | Offline Delete', appNavigation, appPages.monitoring),
  '.nojekyll': ''
};
await Promise.all([
  ...Object.entries(files).map(([file, content]) => writeFile(new URL(file, output), content)),
  copyFile(new URL('./pages/style.css', import.meta.url), new URL('account-password.css', output)),
  build({
    entryPoints: ['pages/auth.js'],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    outfile: 'pages-dist/account-password.js',
    define: {
      SUPABASE_URL: JSON.stringify(SUPABASE_URL),
      SUPABASE_PUBLISHABLE_KEY: JSON.stringify(SUPABASE_PUBLISHABLE_KEY)
    }
  })
]);
