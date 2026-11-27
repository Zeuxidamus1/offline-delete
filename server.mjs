import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { sources } from './public/sources.js';

const live = process.env.LIVE_MODE === '1';
const port = Number(process.env.PORT ?? 3000);
const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
const key = Buffer.from(process.env.DATA_KEY ?? '', 'base64');
if (live && (key.length !== 32 || !origin.startsWith('https://') ||
    !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_VERIFY_SERVICE_SID)) {
  throw new Error('Live mode requires an HTTPS APP_ORIGIN, a 32-byte DATA_KEY, and Twilio Verify credentials.');
}
if (live) await mkdir('data', { recursive:true, mode:0o700 });
const db = new DatabaseSync(live ? 'data/workspaces.sqlite' : ':memory:');
db.exec('PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, payload TEXT NOT NULL, expires INTEGER NOT NULL);');
const save = db.prepare('INSERT OR REPLACE INTO workspaces VALUES (?, ?, ?)');
const get = db.prepare('SELECT payload FROM workspaces WHERE id=? AND expires>?');
const remove = db.prepare('DELETE FROM workspaces WHERE id=?');
const purge = db.prepare('DELETE FROM workspaces WHERE expires<=?');
setInterval(() => purge.run(Date.now()), 60_000).unref();

const encryptionKey = live ? key : randomBytes(32);
const fingerprint = value => createHash('sha256').update(encryptionKey).update(value).digest('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
function seal(state, id) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(id));
  return Buffer.concat([iv, cipher.update(JSON.stringify(state)), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function unseal(payload, id) {
  const data = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, data.subarray(0,12));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(data.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(12,-16)),decipher.final()]));
}
const ttl = 24 * 3600_000;
const empty = () => ({ listings:[], verified:false });
const demoListings = () => sources.map((source, i) => ({
  id:randomUUID(), source:source.id, url:`https://example.invalid/demo/${source.id}`,
  status:'Needs Review', confidence:i ? 'Possible' : 'Likely',
  evidence:i ? ['Name','City'] : ['Name','Age','Phone ending in 0100']
}));
const publicState = state => ({
  demo:!live, verified:state.verified, pending:state.pending?.expires > Date.now(), listings:state.listings
});

class RequestError extends Error {
  constructor(message, status=400) { super(message); this.status=status; }
}
function requireInput(condition, message, status) {
  if (!condition) throw new RequestError(message,status);
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireInput(size <= 8192,'Request is too large.',413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)) ?? {}; }
  catch { throw new RequestError('Invalid request.'); }
}
const rateLimits = new Map();
setInterval(() => {
  for (const [id,entry] of rateLimits) if (entry.until <= Date.now()) rateLimits.delete(id);
},60_000).unref();
function rate(id, max, duration) {
  const now = Date.now();
  const previous = rateLimits.get(id);
  const entry = previous?.until > now ? previous : { count:0, until:now+duration };
  requireInput(entry.count < max,'Too many attempts. Please try again later.',429);
  if (!rateLimits.has(id) && rateLimits.size >= 10000) throw new RequestError('Please try again later.',429);
  entry.count++;
  rateLimits.set(id,entry);
}
async function verifySms(resource, params) {
  const { TWILIO_ACCOUNT_SID:account, TWILIO_AUTH_TOKEN:token, TWILIO_VERIFY_SERVICE_SID:service } = process.env;
  const result = await fetch(`https://verify.twilio.com/v2/Services/${service}/${resource}`, {
    method:'POST', signal:AbortSignal.timeout(8000),
    headers:{ Authorization:'Basic '+Buffer.from(account+':'+token).toString('base64') },
    body:new URLSearchParams(params)
  });
  if (resource === 'VerificationCheck' && [400,404].includes(result.status)) return false;
  requireInput(result.ok,'SMS verification is temporarily unavailable.',503);
  return resource === 'Verifications' || (await result.json()).status === 'approved';
}
function addListing(state, input) {
  requireInput(state.listings.length < 12,'This workspace already has 12 listings.');
  let url;
  try { url = new URL(input.url); } catch { throw new RequestError('Enter a valid listing URL.'); }
  const source = sources.find(source => ['www.'+source.domain,source.domain].includes(url.hostname));
  requireInput(source && url.protocol==='https:' && !url.username && !url.password && !url.port &&
    (source.id==='fast' ? /^\/(?:[^/]+\/){1,}[^/]+\/?$/.test(url.pathname) : /^\/records\/(?:people|person)\/.+/i.test(url.pathname)),'Enter a supported HTTPS profile link from a people search site.');
  url.search = '';
  url.hash = '';
  url.hostname = source.domain;
  requireInput(url.href.length <= 1000,'The listing URL is too long.');
  if (!state.listings.some(item => item.url === url.href)) state.listings.push({
    id:randomUUID(),source:source.id,url:url.href,status:'Needs Review',confidence:'Manual match',evidence:['Listing provided by you']
  });
}
async function mutate(state, action, input, client) {
  if (action==='demo') {
    requireInput(!live,'Demo is unavailable in live mode.',404);
    return { verified:true,listings:demoListings() };
  }
  if (action==='scan') {
    requireInput(!state.verified,'This workspace has already been verified.');
    requireInput(input.agree===true,'Confirm that these details belong to you.');
    const name = String(input.name ?? '').trim();
    const dob = String(input.dob ?? '');
    const date = new Date(dob+'T00:00:00Z');
    requireInput(name.length>=2 && name.length<=100 && /^\d{4}-\d{2}-\d{2}$/.test(dob) &&
      Number.isFinite(+date) && date.toISOString().slice(0,10)===dob && +date < Date.now(),'Enter your name and a valid date of birth.');
    const phone = String(input.phone ?? '').replace(/[\s().-]/g,'');
    requireInput(/^\+1[2-9]\d{9}$/.test(phone),'Enter a US phone number beginning with +1.');
    rate('sms-ip:'+client,5,3600_000);
    rate('sms-phone:'+fingerprint(phone),3,3600_000);
    if (live) await verifySms('Verifications',{ To:phone, Channel:'sms' });
    state.pending={ phone, expires:Date.now()+600_000 };
    return state;
  }
  if (action==='verify') {
    const code = String(input.code ?? '');
    requireInput(state.pending?.expires > Date.now() && /^\d{6}$/.test(code),'Enter a current six digit code.');
    rate('check:'+fingerprint(state.pending.phone),5,600_000);
    const approved = live ? await verifySms('VerificationCheck',{ To:state.pending.phone,Code:code }) : code==='123456';
    requireInput(approved,'The code could not be verified.');
    return { verified:true,listings:live ? [] : demoListings() };
  }
  requireInput(state.verified,'Verify your phone first.',403);
  if (action==='add') { addListing(state,input); return state; }
  if (action==='submit') {
    requireInput(input.agree===true && Array.isArray(input.ids) && input.ids.length>0 && input.ids.length<=12,'Select listings and authorize the request.');
    for (const id of new Set(input.ids)) {
      const item = state.listings.find(item => item.id===id);
      if (item?.status==='Ready to Submit') {
        item.status=live ? 'Action Needed' : 'Submitted';
        if (!live) {
          item.submittedAt=new Date().toISOString();
          item.reference='DEMO-'+item.id.slice(0,8).toUpperCase();
        }
      }
    }
    return state;
  }
  const item = state.listings.find(item => item.id===input.id);
  requireInput(item,'Listing not found.',404);
  if (action==='confirm' && item.status==='Needs Review') item.status='Ready to Submit';
  else if (action==='dismiss' && item.status==='Needs Review') state.listings=state.listings.filter(row=>row.id!==item.id);
  else if (action==='manual' && item.status==='Action Needed') {
    item.status='Submitted';
    item.submittedAt=new Date().toISOString();
    item.reported=true;
    item.reference=String(input.reference ?? '').trim().slice(0,120);
  } else if (action==='recheck' && (item.status==='Submitted' || item.status==='Still Listed')) {
    if (!live && item.reference?.startsWith('DEMO-')) {
      item.status='Removal Verified';
      item.checkedAt=new Date().toISOString();
    } else {
      requireInput(['listed','missing','unavailable'].includes(input.outcome),'Choose an observation.');
      item.status=input.outcome==='listed' ? 'Still Listed' : 'Submitted';
      item.observation=input.outcome;
      item.checkedAt=new Date().toISOString();
    }
  } else throw new RequestError('That action is unavailable for this listing.',409);
  return state;
}

const assets = new Map(await Promise.all([
  ['/', 'index.html','text/html'], ['/style.css','style.css','text/css'],
  ['/app.js','app.js','text/javascript'], ['/sources.js','sources.js','text/javascript']
].map(async ([url,file,type]) => [url,{ body:await readFile(new URL('./public/'+file,import.meta.url)),type }])));
const busy = new Set();
const server = createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (live) res.setHeader('Strict-Transport-Security','max-age=31536000');
  const json = (status,value) => {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(value));
  };
  const url = req.url;
  if (req.method==='GET' && assets.has(url)) {
    const asset=assets.get(url);
    res.writeHead(200,{'Content-Type':asset.type+'; charset=utf-8'});
    res.end(asset.body);
    return;
  }
  if (url!=='/api/workspace') return json(404,{ error:'Page not found.' });
  const established = /(?:^|;\s*)offline_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
  const token = established ?? randomBytes(32).toString('hex');
  const id = digest(token);
  const cookie = (value,maxAge) => `offline_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${live?'; Secure':''}`;
  let locked = false;
  try {
    const row = get.get(id,Date.now());
    const state = row ? unseal(row.payload,id) : empty();
    if (req.method==='GET') {
      if (!established) res.setHeader('Set-Cookie',cookie(token,86400));
      return json(200,publicState(state));
    }
    requireInput(req.method==='POST' && req.headers.origin===origin &&
      req.headers['content-type']?.split(';')[0]==='application/json' && established,'Request rejected.',403);
    requireInput(!busy.has(id),'Another change is in progress. Try again.',409);
    busy.add(id);
    locked=true;
    const input = await readBody(req);
    if (input.action==='delete') {
      remove.run(id);
      res.setHeader('Set-Cookie',cookie('',0));
      return json(200,publicState(empty()));
    }
    const stateAfter = await mutate(state,input.action,input,req.socket.remoteAddress);
    save.run(id,seal(stateAfter,id),stateAfter.pending?.expires ?? Date.now()+ttl);
    res.setHeader('Set-Cookie',cookie(token,86400));
    return json(200,publicState(stateAfter));
  } catch (error) {
    return json(error.status ?? 503,{ error:error.status ? error.message : 'The service is temporarily unavailable.' });
  } finally {
    if (locked) busy.delete(id);
  }
});
server.listen(port,process.env.BIND_HOST ?? '127.0.0.1',()=>console.log('Offline Delete is listening on port '+port));
