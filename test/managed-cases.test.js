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
 assert.ok(pages.managed.includes('Secure checkout is available only after the payment provider is configured.'));
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
 assert.ok(js.includes('Copy Prepared Request'));
 assert.ok(js.includes('navigator.clipboard.writeText'));
 assert.ok(js.includes('Submit using the verified provider channel'));
});

test('checkout stays disabled until signed webhook and explicit activation',()=>{
 const api=read('supabase/functions/case-checkout/index.ts');
 assert.ok(api.includes('STRIPE_SECRET_KEY'));
 assert.ok(api.includes('STRIPE_WEBHOOK_SECRET'));
 assert.ok(api.includes('STRIPE_CHECKOUT_ENABLED'));
 assert.ok(api.includes('auth.getUser(token)'));
 assert.ok(api.includes('caseRow.price_cents!==2500'));
 assert.ok(api.includes('caseRow.payment_status==="paid"'));
});
test('payment confirmation validates Stripe signature and checkout amount',()=>{
 const webhook=read('supabase/functions/case-payment-webhook/index.ts');
 assert.ok(webhook.includes('crypto.subtle.sign("HMAC"'));
 assert.ok(webhook.includes('stripe-signature'));
 assert.ok(webhook.includes('session.payment_status!=="paid"'));
 assert.ok(webhook.includes('session.amount_total!==2500'));
 assert.ok(webhook.includes('caseRow.payment_provider_id!==session.id'));
 assert.ok(webhook.includes('case_payment_events'));
});

test('admin API accepts manual submission receipts only for paid authorized cases',()=>{
 const api=read('supabase/functions/case-admin/index.ts');
 assert.ok(api.includes('record_manual_submission'));
 assert.ok(api.includes('caseRow.payment_status!=="paid"'));
 assert.ok(api.includes('Customer authorization is missing or revoked'));
 assert.ok(api.includes('delivery_reference:receipt'));
 assert.ok(api.includes('manual_submission_recorded'));
 assert.ok(api.includes('The provider submission channel is unverified'));
});
test('customers see correspondence progress without drafts or payment secrets',()=>{
 const js=read('pages/auth.js');
 assert.ok(js.includes(".from('case_removal_correspondence')"));
 assert.ok(js.includes(".select('case_id,site_slug,channel,delivery_status,submitted_at')"));
 assert.ok(js.includes("letterMap=new Map"));
 assert.ok(js.includes('Official Removal Form'));
});

test('automatic removal messages require paid campaigns, verified channels and explicit sender activation',()=>{
 const worker=read('supabase/functions/removal-dispatch/index.ts');
 assert.ok(worker.includes('REMOVAL_DISPATCH_ENABLED'));
 assert.ok(worker.includes('RESEND_API_KEY'));
 assert.ok(worker.includes('REMOVAL_SENDER_EMAIL'));
 assert.ok(worker.includes('verifyJobToken'));
 assert.ok(worker.includes('claim_approved_removal_emails'));
 assert.ok(worker.includes('Idempotency-Key'));
 assert.ok(worker.includes('status:"failed"'));
});
test('paid case preparation exposes manual form links and records submission evidence',()=>{
 const api=read('supabase/functions/case-admin/index.ts');
 const js=read('pages/auth.js');
 assert.ok(api.includes('record_manual_submission'));
 assert.ok(api.includes('delivery_reference:receipt'));
 assert.ok(api.includes('manual_submission_recorded'));
 assert.ok(api.includes('caseRow.payment_status!=="paid"'));
 assert.ok(api.includes('Submitted or completed work cannot be overwritten'));
 assert.ok(js.includes('Copy Prepared Request'));
 assert.ok(js.includes('Official Removal Form'));
 assert.ok(js.includes('Record Manual Submission'));
});
