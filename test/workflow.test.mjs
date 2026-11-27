import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('demo verification, request deduplication, removal check, and isolation', async t => {
  const origin = 'http://localhost:31247';
  const server = spawn(process.execPath,['server.mjs'],{env:{...process.env,LIVE_MODE:'0',PORT:'31247',APP_ORIGIN:origin}});
  t.after(()=>server.kill());
  await once(server.stdout,'data');
  const endpoint=origin+'/api/workspace';
  const initial=await fetch(endpoint);
  const cookie=initial.headers.get('set-cookie').split(';')[0];
  const post=(body, override={})=>fetch(endpoint,{method:'POST',headers:{
    cookie,origin,'Content-Type':'application/json',...override
  },body:JSON.stringify(body)});
  const action=async payload=>{
    const response=await post(payload);
    assert.equal(response.status,200);
    return response.json();
  };
  assert.equal((await post({action:'demo'},{origin:'https://elsewhere.example'})).status,403);
  await action({action:'scan',name:'Example Person',dob:'1990-01-01',phone:'+12025550100',agree:true});
  assert.equal((await post({action:'verify',code:'111111'})).status,400);
  const verified=await action({action:'verify',code:'123456'});
  assert.equal(verified.listings.length,2);
  assert.equal(verified.pending,false);
  const { id }=verified.listings[0];
  await action({action:'confirm',id});
  assert.equal((await post({action:'submit',ids:[id],agree:false})).status,400);
  const authorization={action:'submit',ids:[id,id],agree:true};
  const first=(await action(authorization)).listings[0];
  assert.equal(first.status,'Submitted');
  assert.deepEqual((await action(authorization)).listings[0],first);
  assert.equal((await action({action:'recheck',id})).listings[0].status,'Removal Verified');
  assert.deepEqual((await (await fetch(endpoint)).json()).listings,[]);
  await action({action:'delete'});
  assert.deepEqual((await (await fetch(endpoint,{headers:{cookie}})).json()).listings,[]);
});
