import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('all customer integration controls are present in generated-page source',()=>{
  const build=read('build-pages.mjs');
  const match=build.match(/const appPages = (\{.*\});\n/);
  assert.ok(match,'app page registry should be serialized');
  const pages=JSON.parse(match[1]);
  for(const id of ['manual-listing-form','source-check-list','guide-steps','guide-show-all','guide-submitted']){
    assert.ok(pages['scan-results'].includes('id="'+id+'"'),id);
  }
  assert.ok(pages.monitoring.includes('id="monitor-alerts"'));
  assert.ok(pages.removals.includes('id="verification-feedback"'));
});
test('authenticated client uses the registered sites and does not assume removal',()=>{
  const js=read('pages/auth.js');
  for(const key of ['supported_sites','scan_source_results','verification_checks',
    'monitoring_notifications','add-manual-listing','verify-listing']){
    assert.ok(js.includes(key),key);
  }
  assert.ok(js.includes("request.status === 'submitted'"));
});
test('indexed discovery has free-credit limits and explicit source outcomes',()=>{
  const src=read('supabase/functions/privacy-scan/index.ts');
  for(const key of ['reserveBudget','750','include_domains','unable_to_check','scan_source_results']){
    assert.ok(src.includes(key),key);
  }
});
test('monthly monitoring requires verified subscription entitlement',()=>{
  const src=read('supabase/functions/monitoring-run/index.ts');
  for(const key of ['verifyJobToken','subscription_active','enabled','monitoring_job_credentials']){
    assert.ok(src.includes(key),key);
  }
});

test('logout is available before customer data loads and works without a status element',()=>{
  const js=read('pages/auth.js');
  const start=js.indexOf('// Attach logout immediately');
  const bind=js.indexOf("button.addEventListener('click', async () => {",start);
  const load=js.indexOf('await initializeCustomerApp(user)',start);
  assert.ok(start>0 && bind>start && load>bind);
  assert.ok(js.includes("document.querySelector('#status') || document.querySelector('#app-status')"));
  assert.ok(js.includes("await withTimeout(auth.signOut({ scope: 'local' }))"));
  assert.ok(js.includes("if (authFeedback) authFeedback.textContent = ''"));
});
