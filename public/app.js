import { sources } from './sources.js';

const request = fetch;
const root = document.querySelector('#workspace');
const notice = document.querySelector('#notice');
const nav = [...document.querySelectorAll('[data-view]')];
const selected = new Set();
let state;
let view = 'scan';
let working = false;

function el(tag, value, attrs = {}) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  for (const [name, val] of Object.entries(attrs)) node.setAttribute(name,val);
  return node;
}
function button(label, run, primary = false) {
  const node=el('button',label,{ type:'button',class:primary?'primary':'secondary' });
  node.addEventListener('click',run);
  return node;
}
function external(url,label) {
  return el('a',label,{ href:url,target:'_blank',rel:'noopener noreferrer' });
}
function group(...items) {
  const node=el('div',undefined,{class:'actions'});
  node.append(...items);
  return node;
}
function field(label,name,type,attributes={}) {
  const wrapper=el('label',label,{class:'field'});
  wrapper.append(el('input',undefined,{name,type,...attributes}));
  return wrapper;
}
function check(label,name) {
  const wrapper=el('label',undefined,{class:'check'});
  wrapper.append(el('input',undefined,{type:'checkbox',name,required:''}),label);
  return wrapper;
}
function form(run,...children) {
  const node=el('form');
  node.append(...children);
  node.addEventListener('submit',event=>{
    event.preventDefault();
    run(new FormData(node));
  });
  return node;
}
function submit(label) {
  return el('button',label,{type:'submit',class:'primary'});
}
function go(next) {
  view=next;
  notice.textContent='';
  render();
}
async function call(payload, next) {
  if (working) return;
  working=true;
  root.setAttribute('aria-busy','true');
  notice.textContent='';
  const disabled=[...root.querySelectorAll('button:not(:disabled)')];
  disabled.forEach(node=>node.disabled=true);
  try {
    const response=await request('/api/workspace',payload ? {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    } : {});
    const data=await response.json();
    if (!response.ok) throw new Error(data.error);
    state=data;
    if (payload?.action==='delete') {
      selected.clear();
      await request('/api/workspace');
    }
    if (next) view=next;
    render();
    if (payload?.action==='delete') notice.textContent='Workspace data deleted.';
  } catch (error) {
    notice.textContent=error.message || 'Please try again.';
  } finally {
    working=false;
    root.setAttribute('aria-busy','false');
    disabled.forEach(node=>node.disabled=false);
  }
}
function scan() {
  root.append(el('h2','Start a privacy scan'));
  if (state.verified) {
    root.append(el('p',state.demo?'Your fictional scan is ready to review.':'Your phone is verified. Search the supported sources directly, then add the profile links you want to review.'));
    root.append(group(button('Review Matches',()=>go('review'),true)));
    if (!state.demo) {
      root.append(el('p','Use your city and state to narrow the search on each source.'));
      const links=group(...sources.map(source=>external('https://www.'+source.domain,'Search '+source.name)));
      root.append(links);
    }
    return;
  }
  if (state.hosted) {
    root.append(el('p','Try the full workflow with fictional listings. This preview sends no SMS or removal requests.'),
      group(button('Load Fictional Matches',()=>call({action:'demo'},'review'),true)));
    return;
  }
  if (state.pending) {
    root.append(el('p',state.demo?'Enter 123456 to simulate phone verification.':'Enter the six digit code sent to your phone.'));
    root.append(form(data=>call({action:'verify',code:data.get('code')},'review'),
      field('Verification code','code','text',{required:'',inputmode:'numeric',pattern:'[0-9]{6}',autocomplete:'one-time-code'}),
      group(submit('Verify Phone'))));
    return;
  }
  root.append(el('p',state.demo?'Use fictional details or load sample matches below.':'Enter your details to begin. Your name and date of birth are discarded after validation. Your phone is shared with the verification provider.'));
  const fields=el('div',undefined,{class:'fields'});
  fields.append(field('Full name','name','text',{required:'',maxlength:'100',autocomplete:state.demo?'off':'name'}),
    field('Date of birth','dob','date',{required:''}),
    field('Phone number','phone','tel',{required:'',placeholder:'+1 202 555 0100',autocomplete:state.demo?'off':'tel'}),
    field('City and state (optional)','city','text',{maxlength:'100',placeholder:'New Iberia, LA'}));
  root.append(form(data=>call({action:'scan',name:data.get('name'),dob:data.get('dob'),phone:data.get('phone'),
    city:data.get('city'),agree:data.has('self')}),fields,check('I confirm this information belongs to me.','self'),group(submit(state.demo?'Get Demo Code':'Send Verification Code'))));
  if (state.demo) root.append(group(button('Load Fictional Matches',()=>call({action:'demo'},'review'))));
}
function card(item) {
  const source=sources.find(source=>source.id===item.source);
  const node=el('article',undefined,{class:'card'});
  const header=el('div',undefined,{class:'card-header'});
  header.append(el('h3',source.name),el('span',item.status,{class:'badge'}));
  node.append(header,item.url.includes('example.invalid') ? el('p',item.url) : external(item.url,'Open exact listing'));
  node.append(el('p',item.confidence+' · '+item.evidence.join(', ')));
  return {node,source};
}
function review() {
  root.append(el('h2','Review matches'),el('p','Confirm each listing that belongs to you before requesting removal.'));
  if (!state.verified) {
    root.append(el('p','Start a scan to review listings.',{class:'empty'}),group(button('Start Scan',()=>go('scan'),true)));
    return;
  }
  const listings=state.listings.filter(item=>['Needs Review','Ready to Submit'].includes(item.status));
  const ready=listings.filter(item=>item.status==='Ready to Submit');
  if (!listings.length) root.append(el('p','There are no listings waiting for review.',{class:'empty'}));
  for (const item of listings) {
    const {node}=card(item);
    if (item.status==='Needs Review') node.append(group(
      button('Confirm Match',()=>call({action:'confirm',id:item.id}),true),
      button('Dismiss',()=>call({action:'dismiss',id:item.id}))));
    else {
      const label=el('label',undefined,{class:'check'});
      const box=el('input',undefined,{type:'checkbox'});
      box.checked=selected.has(item.id);
      box.addEventListener('change',()=>box.checked?selected.add(item.id):selected.delete(item.id));
      label.append(box,'Include this listing in my request');
      node.append(label);
    }
    root.append(node);
  }
  if (ready.length) root.append(form(data=>{
    const ids=ready.filter(item=>selected.has(item.id)).map(item=>item.id);
    call({action:'submit',ids,agree:data.has('authorize')},'track');
  },el('p',state.demo?'The demo simulates a submission. No information is sent.':'Offline Delete sends no information to either broker. The official forms may ask for your name, email, and identifying details for the listing.'),
  check('I authorize a removal request for the selected listings.','authorize'),group(submit('Submit Removal Requests'))));
  if (!state.demo) {
    const add=el('details',undefined,{class:'inline-form'});
    add.append(el('summary','Add a listing URL'),form(data=>call({action:'add',url:data.get('url')}),
      field('Exact profile URL','url','url',{required:'',maxlength:'1000'}),group(submit('Add Listing'))));
    root.append(add);
  }
}
function track() {
  root.append(el('h2','Track removals'),el('p','See which requests need action and check the exact listings again.'));
  const items=state.listings.filter(item=>!['Needs Review','Ready to Submit'].includes(item.status));
  if (!items.length) root.append(el('p','No removal requests yet.',{class:'empty'}),group(button('Review Matches',()=>go('review'),true)));
  for (const item of items) {
    const {node,source}=card(item);
    if (item.status==='Action Needed') {
      node.append(external(source.optout,'Open official opt-out'),el('p','Complete these steps on the broker’s website.'));
      const steps=el('ol');
      for (const step of source.steps) steps.append(el('li',step));
      node.append(steps,form(data=>call({action:'manual',id:item.id,reference:data.get('reference')}),
        field('Confirmation reference (optional)','reference','text',{maxlength:'120'}),
        group(submit('Mark Submitted'))));
    }
    if (item.submittedAt) node.append(el('p',(item.reported?'Submission reported ':'Submitted ')+new Date(item.submittedAt).toLocaleString()));
    if (item.reference) node.append(el('p','Reference '+item.reference));
    if (item.checkedAt) node.append(el('p','Last checked '+new Date(item.checkedAt).toLocaleString()));
    if (item.observation) node.append(el('p',({
      listed:'You reported that the listing is still public.',
      missing:'You reported that the listing was missing. Removal remains unverified.',
      unavailable:'You reported that the site was unavailable. Removal remains unverified.'
    })[item.observation]));
    if (['Submitted','Still Listed'].includes(item.status)) {
      if (state.demo) node.append(group(button('Run Demo Recheck',()=>call({action:'recheck',id:item.id}),true)));
      else {
        const select=el('select',undefined,{name:'outcome',required:''});
        for (const [key,label] of [['','Choose an observation'],['listed','Still visible'],['missing','Listing missing'],['unavailable','Site unavailable']]) {
          select.append(el('option',label,{value:key}));
        }
        const label=el('label','What did you see at the exact listing URL?',{class:'field'});
        label.append(select);
        node.append(form(data=>call({action:'recheck',id:item.id,outcome:data.get('outcome')}),label,group(submit('Save Observation'))));
      }
    }
    root.append(node);
  }
}
function render() {
  if (state.hosted) document.querySelector('.privacy p').textContent='Fictional progress clears when this page reloads.';
  document.querySelector('#mode').textContent=state.demo?'Demo mode':'Guided opt-outs';
  document.querySelector('#match-count').textContent=state.listings.filter(item=>item.status==='Needs Review').length || '';
  const list=document.querySelector('#source-list');
  list.replaceChildren();
  for (const source of sources) {
    const row=el('div',undefined,{class:'source'});
    row.append(el('h3',source.name),el('span',state.demo?(state.verified?'Simulated scan':'Demo available'):'Manual lookup',{class:'badge'}),external(source.optout,'Official opt-out'));
    list.append(row);
  }
  for (const node of nav) node.setAttribute('aria-current',String(node.dataset.view===view));
  root.replaceChildren();
  ({scan,review,track})[view]();
}
for (const node of nav) node.addEventListener('click',()=>{ if (state && !working) go(node.dataset.view); });
document.querySelector('#delete').addEventListener('click',()=>{
  if (state && confirm('Delete the listings and progress in this workspace?')) call({action:'delete'},'scan');
});
call();
