import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('managed service pages exist and do not advertise working checkout',()=>{
 const src=read('build-pages.mjs');
 const match=src.match(/const appPages = (\{.*\});\n/);
 assert.ok(match);
 const pages=JSON.parse(match[1]);
 for(const id of ['managed-case-form','managed-signed-name','managed-consent','managed-cases-list','managed-covered-sites']){
  assert.ok(pages.managed.includes('id="'+id+'"'),id);
 }
 for(const id of ['admin-access-state','admin-dashboard','admin-cases-list','admin-tasks-list']){
  assert.ok(pages.admin.includes('id="'+id+'"'),id);
 }
 assert.ok(pages.managed.includes('Payment and automated sending are not enabled yet'));
 assert.ok(src.includes("'managed.html': page('managed'"));
 assert.ok(src.includes("'admin.html': page('admin'"));
});
test('managed case creation requires signed authorization and creates no fake payments',()=>{
 const js=read('pages/auth.js');
 assert.ok(js.includes("managedConsentStatement"));
 assert.ok(js.includes(".from('customer_authorizations')"));
 assert.ok(js.includes(".from('removal_cases')"));
 assert.ok(js.includes("payment_status==='paid'"));
 assert.ok(js.includes("Revoke authorization"));
 assert.ok(js.includes("No charge or requests have been sent."));
});
test('admin task updates require server-verified admin role',()=>{
 const api=read('supabase/functions/case-admin/index.ts');
 assert.ok(api.includes('auth.getUser(token)'));
 assert.ok(api.includes('from("case_administrators")'));
 assert.ok(api.includes('Administrator access required'));
 assert.ok(api.includes('allowed=["research_needed"'));
 assert.ok(!api.includes('SUPABASE_SERVICE_ROLE_KEY')||api.includes('auth.getUser(token)'));
});
test('admin request drafting is not an email submission',()=>{
 const js=read('pages/auth.js');
 assert.ok(js.includes('Copy Request Draft'));
 assert.ok(js.includes('navigator.clipboard.writeText'));
 assert.ok(js.includes('Confirm the official contact route before sending.'));
});
