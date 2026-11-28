import { createClient } from '@supabase/supabase-js';
import { checkoutRecordId, candidateProfileLink, profileLink } from './whitepages-links.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: 'pkce',
    storageKey: 'offline-delete-auth',
    detectSessionInUrl: true,
    persistSession: true
  }
});

const { auth } = supabase;
const signIn = new URL('./', window.location.href);
const home = new URL('./home.html', signIn);
const page = document.body.dataset.page;
const signInButton = document.querySelector('#github-signin');
const passwordForm = document.querySelector('#password-auth');
const status = document.querySelector('#status');
const callback = new URL(window.location.href);
const confirmationFailed = callback.searchParams.has('error') ||
  new URLSearchParams(callback.hash.slice(1)).has('error');

function withTimeout(promise, milliseconds = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), milliseconds))
  ]);
}

function go(destination) {
  window.location.replace(destination.href);
}

if (passwordForm) {
  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = passwordForm.querySelector('button');
    const values = new FormData(passwordForm);
    const credentials = { email: values.get('email').trim(), password: values.get('password') };
    const signingUp = page === 'signup';
    submit.disabled = true;
    signInButton.disabled = true;
    status.textContent = signingUp ? 'Creating your account…' : 'Signing you in…';
    try {
      const { data, error } = await withTimeout(signingUp
        ? auth.signUp({ ...credentials, options: { emailRedirectTo: signIn.href } })
        : auth.signInWithPassword(credentials));
      if (error) {
        const messages = {
          email_not_confirmed: 'Confirm your email before signing in.',
          invalid_credentials: 'Check your email address and password.',
          weak_password: 'Choose a stronger password.',
          over_email_send_rate_limit: 'Too many attempts. Try again in a few minutes.',
          over_request_rate_limit: 'Too many attempts. Try again in a few minutes.',
          email_address_not_authorized: 'Email signup is temporarily unavailable. Use GitHub to continue.'
        };
        status.textContent = messages[error.code] ??
          (signingUp ? 'We couldn’t create your account. Try again.' : 'We couldn’t sign you in. Try again.');
      } else if (data.session) {
        go(home);
      } else if (signingUp) {
        status.textContent = 'Check your email to confirm your account.';
      } else {
        status.textContent = 'We couldn’t sign you in. Try again.';
      }
    } catch (error) {
      status.textContent = error.message === 'timeout' ? 'Sign-in is taking too long. Check your connection and try again.' : 'Authentication is temporarily unavailable. Try again.';
    } finally {
      submit.disabled = false;
      signInButton.disabled = false;
    }
  });
}

if (signInButton) {
  signInButton.addEventListener('click', async () => {
    signInButton.disabled = true;
    status.textContent = 'Connecting to GitHub…';
    try {
      const { error } = await withTimeout(auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: signIn.href }
      }));
      if (error) throw error;
    } catch {
      status.textContent = 'GitHub sign-in is temporarily unavailable. Try again.';
      signInButton.disabled = false;
    }
  });
}


async function initializeProfile(user) {
  const form = document.querySelector('#profile-form');
  const feedback = document.querySelector('#status');
  const save = document.querySelector('#save-profile');
  const remove = document.querySelector('#delete-profile');
  if (!form) return;
  const toast = document.querySelector('#profile-toast');
  const toastMessage = document.querySelector('#profile-toast-message');
  const toastClose = document.querySelector('#profile-toast-close');
  let toastTimer;
  function hideToast() {
    clearTimeout(toastTimer);
    toast.hidden = true;
    toast.classList.remove('is-visible');
  }
  function showToast(message, type = 'success') {
    clearTimeout(toastTimer);
    toastMessage.textContent = message;
    toast.classList.toggle('is-error', type === 'error');
    toast.querySelector('.profile-toast-icon').textContent = type === 'error' ? '!' : '✓';
    toast.hidden = false;
    toast.classList.remove('is-visible');
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    if (type === 'success') toastTimer = setTimeout(hideToast, 4500);
  }
  toastClose?.addEventListener('click', hideToast);
  const fields = ['first_name','middle_name','last_name','alternate_name','phone','street_address','city','state','postal_code'];
  function errorMessage(error) {
    if (error?.code === '42501') return 'You do not have permission to access this profile.';
    return 'Unable to save or load your profile. Please try again.';
  }
  async function loadProfile() {
    feedback.textContent = 'Loading profile…';
    form.querySelectorAll('input').forEach(input => input.disabled = true);
    try {
      const { data, error } = await withTimeout(supabase.from('customer_profiles')
        .select('first_name, middle_name, last_name, alternate_name, phone, street_address, city, state, postal_code, consent_to_search')
        .eq('user_id', user.id).maybeSingle());
      if (error) throw error;
      for (const name of fields) form.elements[name].value = data?.[name] ?? '';
      form.elements.consent_to_search.checked = data?.consent_to_search === true;
      remove.hidden = !data;
      feedback.textContent = data ? '' : 'No profile saved yet.';
    } catch (error) {
      feedback.textContent = error.message === 'timeout' ? 'Profile request timed out. Refresh and try again.' : errorMessage(error);
    } finally {
      form.querySelectorAll('input').forEach(input => input.disabled = false);
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const firstName = form.elements.first_name.value.trim();
    const lastName = form.elements.last_name.value.trim();
    if (!firstName || !lastName || firstName.length > 80 || lastName.length > 80) {
      feedback.textContent = 'Enter your first and last name.';
      return;
    }
    const payload = { user_id: user.id, first_name: firstName, last_name: lastName,
      consent_to_search: form.elements.consent_to_search.checked };
    for (const name of fields.filter(name => !['first_name','last_name'].includes(name))) {
      const value = form.elements[name].value.trim();
      payload[name] = value || null;
    }
    hideToast();
    save.disabled = true;
    remove.disabled = true;
    feedback.textContent = 'Saving profile…';
    save.textContent = 'Saving…';
    try {
      const { error } = await withTimeout(supabase.from('customer_profiles')
        .upsert(payload, { onConflict: 'user_id' }));
      if (error) throw error;
      remove.hidden = false;
      feedback.textContent = '';
      showToast('Profile saved successfully');
    } catch (error) {
      feedback.textContent = '';
      showToast(error.message === 'timeout' ? 'Save timed out. Check your connection.' : errorMessage(error), 'error');
    } finally {
      save.disabled = false;
      save.textContent = 'Save Profile';
      remove.disabled = false;
    }
  });
  remove.addEventListener('click', async () => {
    if (!window.confirm('Delete your saved profile details? This will not delete your login account.')) return;
    hideToast();
    remove.disabled = true;
    save.disabled = true;
    feedback.textContent = 'Deleting profile…';
    try {
      const { error } = await withTimeout(supabase.from('customer_profiles')
        .delete().eq('user_id', user.id));
      if (error) throw error;
      form.reset();
      remove.hidden = true;
      feedback.textContent = '';
      showToast('Profile deleted successfully');
    } catch (error) {
      feedback.textContent = '';
      showToast(error.message === 'timeout' ? 'Delete request timed out. Try again.' : errorMessage(error), 'error');
    } finally {
      remove.disabled = false;
      save.disabled = false;
    }
  });
  await loadProfile();
}


const appPageNames = new Set(['dashboard','scan-results','removals','monitoring','managed','admin']);
function appText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}
function formatDate(value) {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'});
}
function displayItems(id, records, emptyText, makeRow) {
  const container = document.getElementById(id);
  if (!container) return;
  container.replaceChildren();
  if (!records.length) {
    container.className = 'app-empty';
    container.textContent = emptyText;
    return;
  }
  container.className = 'app-items';
  for (const record of records) container.append(makeRow(record));
}
function buildRow(title, detail, statusLabel, url) {
  const row = document.createElement('div');
  row.className = 'app-item';
  const column = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = title;
  const description = document.createElement('small');
  description.textContent = detail;
  column.append(name, description);
  const right = document.createElement('div');
  right.className = 'app-item-right';
  const tag = document.createElement('span');
  tag.className = 'app-pill';
  tag.textContent = statusLabel;
  right.append(tag);
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        const link = document.createElement('a');
        link.href = u.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'View Listing';
        right.append(link);
      }
    } catch { /* ignore invalid URLs */ }
  }
  row.append(column, right);
  return row;
}
function makeAction(label, style, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = style;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}
function listingUrl(value) {
  try {
    const url = new URL(value);
    const allowed = ['truepeoplesearch.com','fastpeoplesearch.com','usphonebook.com',
      'familytreenow.com','thatsthem.com','searchpeoplefree.com',
      'advancedbackgroundchecks.com','cyberbackgroundchecks.com',
      'nuwber.com','whitepages.com','fastbackgroundcheck.com',
      'smartbackgroundchecks.com','peoplesearchnow.com','anywho.com',
      '411.com','locatefamily.com','idcrawl.com','cocofinder.com',
      'clustrmaps.com','officialusa.com','veripages.com','usa-people-search.com'];
    const host=url.hostname.toLowerCase();
    if (url.protocol==='https:' && !url.username && !url.password &&
        allowed.some(domain=>host===domain||host==='www.'+domain)) return url.href;
  } catch {}
  return null;
}
function whitepagesProfileUrl(value) { return profileLink(value); }
function initializeFindingReview(user, findings, removals, sites) {
  const activeTab = document.getElementById('filter-active');
  const dismissedTab = document.getElementById('filter-dismissed');
  const container = document.getElementById('findings-list');
  if (!container) return;
  const guide = document.getElementById('removal-guide');
  const guideEmpty = document.getElementById('guide-empty');
  function closeGuide(){guide.hidden=true; if(guideEmpty) guideEmpty.hidden=false; selectedFinding=null;}
  const guideSteps = document.getElementById('guide-steps');
  const guideShowAll = document.getElementById('guide-show-all');
  const guideFinish = document.getElementById('guide-finish');
  const guideSubmitted = document.getElementById('guide-submitted');
  const guideFeedback = document.getElementById('guide-feedback');
  let showAll = false;
  let savingStep = false;
  const fallbackSteps = [
    {title:'Click View Listing',hint:'Open your Whitepages result.',action:'listing'},
    {title:'Select View Report',hint:'Choose View Report for the correct person.'},
    {title:'Copy the URL',hint:'Copy the address from the new Whitepages window.'},
    {title:'Click Opt-Out',hint:'Open the Whitepages opt-out form.',action:'optout'},
    {title:'Paste the URL and follow the directions',hint:'Finish the request and any required verification.'}
  ];
  let currentFilter = 'active';
  let selectedFinding = null;
  const requestMap = new Map(removals.map(x=>[x.finding_id,x]));
  const siteByName = new Map(sites.map(site=>[site.name,site]));

  function notify(message) { appText('app-status', message); }
  function currentRequest() {
    return selectedFinding ? requestMap.get(selectedFinding.id) : null;
  }
  function stepCount() {
    const n = Number(currentRequest()?.guide_steps_completed ?? 0);
    return Number.isInteger(n) ? Math.max(0,Math.min(5,n)) : 0;
  }
  function renderGuide() {
    if (!selectedFinding) return;
    const done = stepCount();
    appText('guide-progress-label',done+' of 5 steps completed');
    appText('guide-progress-number',done+'/5');
    document.getElementById('guide-progress-track')?.setAttribute('aria-valuenow',String(done));
    const fill=document.getElementById('guide-progress-fill');
    if (fill) fill.style.width=(done*20)+'%';
    guideShowAll.textContent=showAll?'Show fewer steps':'Show all steps';
    guideShowAll.setAttribute('aria-expanded',String(showAll));
    guideFinish.hidden=done!==5;
    guideSteps.replaceChildren();
    const site=siteByName.get(selectedFinding.source_name);
    const steps=Array.isArray(site?.guide_steps)&&site.guide_steps.length===5?site.guide_steps:fallbackSteps;
    steps.forEach((step,index)=>{
      if (!showAll && index>done) return;
      const complete=index<done;
      const available=index<=done;
      const line=document.createElement('div');
      line.className='guided-step '+(complete?'step-done':available?'step-current':'step-locked');
      const circle=document.createElement('button');
      circle.type='button';
      circle.className='guide-step-circle';
      circle.textContent=complete?'✓':String(index+1);
      circle.setAttribute('aria-label',(complete?'Undo':'Complete')+' step '+(index+1)+': '+step.title);
      circle.setAttribute('aria-pressed',String(complete));
      circle.disabled=savingStep || !available || currentRequest()?.status!=='needs_action';
      circle.addEventListener('click',()=>saveProgress(complete?index:index+1));
      const content=document.createElement('div');
      content.className='guide-step-body';
      const title=document.createElement('strong');
      title.textContent=step.title;
      const description=document.createElement('p');
      description.textContent=step.hint;
      content.append(title,description);
      const url=step.action==='listing'?listingUrl(selectedFinding.listing_url):
        step.action==='optout' && site?.optout_url && site.optout_url!==site.search_url
          ?listingUrl(site.optout_url):null;
      if (url) {
        const link=document.createElement('a');
        link.className='guide-step-link';
        link.href=url;
        link.target='_blank';
        link.rel='noopener noreferrer';
        link.textContent=step.action==='listing'?'View Listing ↗':'Open '+(site?.name||'Website')+' Opt-Out ↗';
        content.append(link);
      }
      line.append(circle,content);
      guideSteps.append(line);
    });
  }
  async function saveProgress(next) {
    const request=currentRequest();
    if (!request || savingStep || request.status!=='needs_action') return;
    const previous=stepCount();
    if (next<0 || next>5 || (next!==previous+1 && next>=previous)) return;
    savingStep=true;
    guideFeedback.textContent='Saving progress…';
    renderGuide();
    const {data,error}=await withTimeout(supabase.from('privacy_removals')
      .update({guide_steps_completed:next}).eq('id',request.id).eq('user_id',user.id)
      .select('guide_steps_completed').single()).catch(err=>({error:err}));
    if (error || !data) guideFeedback.textContent='Unable to save progress. Try again.';
    else {request.guide_steps_completed=data.guide_steps_completed;guideFeedback.textContent='';}
    savingStep=false;
    renderGuide();
  }

  function paint() {
    const visible = findings.filter(x=>currentFilter==='dismissed' ? x.match_status==='dismissed' : x.match_status!=='dismissed');
    appText('finding-count',String(visible.length));
    activeTab?.classList.toggle('selected',currentFilter==='active');
    dismissedTab?.classList.toggle('selected',currentFilter==='dismissed');
    activeTab?.setAttribute('aria-pressed',String(currentFilter==='active'));
    dismissedTab?.setAttribute('aria-pressed',String(currentFilter==='dismissed'));
    displayItems('findings-list',visible,currentFilter==='dismissed' ? 'No dismissed listings.' : 'No active listings.',finding=>{
      const row = document.createElement('div');
      row.className = 'app-item listing-result'+(finding.match_status==='confirmed'?' listing-confirmed':'');
      if (selectedFinding?.id===finding.id) row.classList.add('listing-selected');
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = finding.source_name;
      info.append(title);
      const date = document.createElement('small');
      date.textContent = formatDate(finding.detected_at);
      const request = requestMap.get(finding.id);
      const isFinalStatus = finding.match_status === 'confirmed' &&
        (request?.status === 'submitted' || request?.status === 'verified_removed');
      if (!isFinalStatus) {
        const sourceCaption = document.createElement('span');
        sourceCaption.className = 'listing-source-caption';
        sourceCaption.textContent = finding.match_status === 'confirmed' ? 'Your listing' :
          finding.match_status === 'dismissed' ? 'Dismissed listing' : 'Potential match';
        info.append(sourceCaption);
      }
      info.append(date);
      const controls = document.createElement('div');
      controls.className = 'app-item-right listing-actions';
      if (isFinalStatus) {
        const status = document.createElement('span');
        status.className = 'app-pill confirmed-pill';
        status.textContent = request.status === 'submitted' ? 'Submitted' : 'Verified Removed';
        controls.append(status);
      } else {
        const pill = document.createElement('span');
        pill.className = 'app-pill' + (finding.match_status === 'confirmed' ? ' confirmed-pill' : '');
        pill.textContent = finding.match_status === 'confirmed' ? 'Confirmed' :
          finding.match_status === 'dismissed' ? 'Not Me' : 'Possible';
        controls.append(pill);
        const url = listingUrl(finding.listing_url);
        if (url) {
          const link = document.createElement('a');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'View Listing';
          controls.append(link);
        }
        if (finding.match_status === 'dismissed') {
          controls.append(makeAction('Undo','listing-secondary',()=>classify(finding,'possible')));
        } else if (finding.match_status === 'possible') {
          controls.append(makeAction('This Is Me','listing-confirm',()=>classify(finding,'confirmed')));
          controls.append(makeAction('Not Me','listing-secondary',()=>classify(finding,'dismissed')));
        } else {
          controls.append(makeAction('Continue Removal','listing-continue',()=>continueRemoval(finding)));
          if (!request) controls.append(makeAction('Not Me','listing-secondary',()=>classify(finding,'dismissed')));
        }
      }
      row.append(info,controls);
      return row;
    });
  }
  async function classify(finding,next) {
    notify('');
    const old = finding.match_status;
    if (old===next) return;
    const {data,error}=await withTimeout(supabase.from('privacy_findings')
      .update({match_status:next}).eq('id',finding.id).eq('user_id',user.id)
      .select('match_status').single()).catch(e=>({error:e}));
    if (error || !data) {notify('Unable to update listing. Try again.'); return;}
    finding.match_status=next;
    if (next!=='confirmed' && selectedFinding?.id===finding.id) closeGuide();
    notify(next==='dismissed' ? 'Listing dismissed. Open Dismissed to undo.' : next==='confirmed' ? 'Listing confirmed.' : 'Listing restored.');
    paint();
  }
  async function continueRemoval(finding) {
    notify('');
    const url = listingUrl(finding.listing_url);
    if (!url) {notify('The listing URL could not be verified.');return;}
    if (!requestMap.has(finding.id)) {
      const {data,error}=await withTimeout(supabase.from('privacy_removals')
        .insert({user_id:user.id,finding_id:finding.id,status:'needs_action'})
        .select('id,finding_id,status,updated_at,guide_steps_completed').single()).catch(e=>({error:e}));
      if (error) {
        if (error.code!=='23505') {notify('Unable to start removal. Try again.');return;}
        const existing=await withTimeout(supabase.from('privacy_removals').select('id,finding_id,status,updated_at,guide_steps_completed')
          .eq('user_id',user.id).eq('finding_id',finding.id).single()).catch(problem=>({error:problem}));
        if (existing.error || !existing.data) {notify('Unable to resume removal. Refresh to try again.');return;}
        requestMap.set(finding.id,existing.data);
      } else {requestMap.set(finding.id,data);}
    }
    selectedFinding=finding;
    showAll=false;
    guideFeedback.textContent='';
    guide.hidden=false;
    if (guideEmpty) guideEmpty.hidden=true;
    renderGuide();
    guide.scrollIntoView({behavior:'smooth',block:'nearest'});
    paint();
  }
  document.getElementById('close-removal-guide')?.addEventListener('click',closeGuide);
  guideShowAll?.addEventListener('click',()=>{showAll=!showAll;renderGuide();});
  guideSubmitted?.addEventListener('click',async()=>{
    if (!selectedFinding) return;
    const request=requestMap.get(selectedFinding.id);
    if (!request) {guideFeedback.textContent='Could not find removal request. Refresh the page.';return;}
    if (stepCount()!==5 || request.status!=='needs_action') return;
    guideSubmitted.disabled=true;
    guideFeedback.textContent='Saving request status…';
    const {data,error}=await withTimeout(supabase.from('privacy_removals')
      .update({status:'submitted'})
      .eq('id',request.id).eq('user_id',user.id)
      .select('status').single()).catch(e=>({error:e}));
    guideSubmitted.disabled=false;
    if (error || !data) {guideFeedback.textContent='Unable to save request status. Try again.';return;}
    request.status='submitted';
    guideFeedback.textContent='Request marked submitted.';
    closeGuide();
    notify('Removal request marked submitted. Track it under Removals.');
    paint();
  });
  activeTab?.addEventListener('click',()=>{currentFilter='active';paint();});
  dismissedTab?.addEventListener('click',()=>{currentFilter='dismissed';closeGuide();paint();});
  paint();
}

function initializeSourceCoverage(sites, sourceChecks, latestScan) {
  const container=document.getElementById('source-check-list');
  if(!container)return;
  container.replaceChildren();
  const checks=new Map(sourceChecks.filter(x=>x.scan_id===latestScan?.id).map(x=>[x.site_slug,x]));
  for(const site of sites){
    const row=document.createElement('div');
    row.className='source-check-row';
    const name=document.createElement('span');
    name.textContent=site.name;
    const status=document.createElement('span');
    const check=checks.get(site.slug);
    status.textContent=!check?'Not checked':check.status==='indexed_checked'?'Index searched':
      check.status==='manual_required'?'Manual check needed':'Unable to check';
    status.className='source-check-state'+(check?.status==='unable_to_check'?' state-unavailable':'');
    row.append(name,status);
    container.append(row);
  }
}

function initializeSiteDirectory(sites) {
  const links=document.getElementById('supported-source-links');
  const form=document.getElementById('manual-listing-form');
  if (!links || !form) return;
  const selector=document.getElementById('manual-source');
  const urlField=document.getElementById('manual-url');
  const status=document.getElementById('manual-status');
  const save=document.getElementById('manual-save');
  links.replaceChildren();
  selector.replaceChildren();
  for(const site of sites) {
    const option=document.createElement('option');
    option.value=site.slug;
    option.textContent=site.name;
    selector.append(option);
    const url=listingUrl(site.search_url);
    if (url) {
      const anchor=document.createElement('a');
      anchor.href=url;
      anchor.target='_blank';
      anchor.rel='noopener noreferrer';
      anchor.textContent=site.name+' ↗';
      links.append(anchor);
    }
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    status.textContent='';
    save.disabled=true;
    save.textContent='Saving…';
    try {
      const {data,error}=await supabase.functions.invoke('add-manual-listing',{
        method:'POST',body:{site_slug:selector.value,listing_url:urlField.value.trim()}
      });
      if(error) {
        let message='Unable to save listing.';
        try {const response=await error.context?.json();if(response?.error)message=response.error;} catch {}
        throw new Error(message);
      }
      if(!data?.finding_id) throw new Error('Unable to save listing.');
      status.textContent=data.already_saved?'This listing is already saved.':'Listing saved. Refreshing…';
      if(!data.already_saved) window.location.reload();
    }catch(error){status.textContent=error.message||'Unable to save listing.';}
    finally{save.disabled=false;save.textContent='Save Listing';}
  });
}

function initializeRemovalVerification(user,removals,findings,checks) {
  const container=document.getElementById('removals-list');
  if(!container)return;
  const feedback=document.getElementById('verification-feedback');
  const findingMap=new Map(findings.map(f=>[f.id,f]));
  const latest=new Map();
  for(const check of checks) if(!latest.has(check.removal_id))latest.set(check.removal_id,check);
  displayItems('removals-list',removals,'No removal requests recorded yet.',removal=>{
    const finding=findingMap.get(removal.finding_id);
    const row=document.createElement('div');
    row.className='removal-tracking-item';
    const heading=document.createElement('div');
    heading.className='removal-tracking-heading';
    const title=document.createElement('strong');
    title.textContent=finding?.source_name||'Removal request';
    const badge=document.createElement('span');
    badge.className='app-pill';
    badge.textContent=removal.status==='needs_action'?'Action Required':
      removal.status==='verified_removed'?'Verified Removed':
      removal.status==='submitted'?'Submitted':'Pending';
    heading.append(title,badge);
    const date=document.createElement('small');
    date.textContent='Updated '+formatDate(removal.updated_at);
    row.append(heading,date);
    const recent=latest.get(removal.id);
    if(recent){
      const detail=document.createElement('p');
      const labels={still_visible:'Still visible',unable_to_verify:'Unable to verify',
        user_reported_absent:'Customer reported absent',provider_confirmed_removed:'Provider-confirmed removal',
        index_reference_found:'Indexed listing found',index_reference_missing:'Not found in search index'};
      detail.textContent='Last check: '+(labels[recent.outcome]||recent.outcome)+' · '+formatDate(recent.checked_at);
      row.append(detail);
    }
    if(removal.status==='submitted' || removal.status==='pending'){
      const tool=document.createElement('div');
      tool.className='verification-actions';
      const valid=listingUrl(finding?.listing_url);
      if(valid){
        const link=document.createElement('a');
        link.href=valid;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View Listing ↗';
        tool.append(link);
      }
      const select=document.createElement('select');
      select.setAttribute('aria-label','Result of checking '+(finding?.source_name||'listing'));
      for(const [value,label] of [
        ['still_visible','Still visible'],
        ['user_reported_absent','I cannot find the listing'],
        ['unable_to_verify','Unable to verify']]){
        const opt=document.createElement('option');opt.value=value;opt.textContent=label;select.append(opt);
      }
      const button=document.createElement('button');
      button.type='button';button.textContent='Record Check';
      button.addEventListener('click',async()=>{
        button.disabled=true;
        feedback.textContent='Saving check…';
        const outcome=select.value;
        const {error}=await withTimeout(supabase.from('verification_checks')
          .insert({user_id:user.id,removal_id:removal.id,method:'customer_report',outcome}))
          .catch(problem=>({error:problem}));
        button.disabled=false;
        if(error){feedback.textContent='Unable to save check. Try again.';return;}
        feedback.textContent='Check saved. This does not confirm removal.';
        window.location.reload();
      });
      tool.append(select,button);
      const recheck=document.createElement('button');
      recheck.type='button';recheck.textContent='Check Search Index';
      recheck.addEventListener('click',async()=>{
        recheck.disabled=true;
        feedback.textContent='Checking indexed listing…';
        try {
          const {data,error}=await supabase.functions.invoke('verify-listing',{method:'POST',body:{removal_id:removal.id}});
          if(error){
            let message='Could not check listing.';
            try{const response=await error.context?.json();if(response?.error)message=response.error;}catch{}
            throw new Error(message);
          }
          if(!data?.outcome)throw new Error('Could not check listing.');
          feedback.textContent='Index check recorded. This does not verify removal.';
          window.location.reload();
        }catch(error){feedback.textContent=error.message||'Could not check listing.';}
        finally{recheck.disabled=false;}
      });
      tool.append(recheck);
      row.append(tool);
    }
    return row;
  });
}

async function initializeCustomerApp(user) {
  const statusElement = document.getElementById('app-status');
  if (statusElement) statusElement.textContent = 'Loading your account…';
  const queries = await Promise.allSettled([
    withTimeout(supabase.from('customer_profiles').select('first_name,last_name,city,state,consent_to_search').eq('user_id',user.id).maybeSingle()),
    withTimeout(supabase.from('privacy_scans').select('id,status,started_at,completed_at').eq('user_id',user.id).order('started_at',{ascending:false}).limit(100)),
    withTimeout(supabase.from('privacy_findings').select('id,source_name,listing_url,match_status,detected_at').eq('user_id',user.id).order('detected_at',{ascending:false}).limit(200)),
    withTimeout(supabase.from('privacy_removals').select('id,finding_id,status,updated_at,guide_steps_completed').eq('user_id',user.id).order('updated_at',{ascending:false}).limit(200)),
    withTimeout(supabase.from('supported_sites').select('slug,name,domain,search_url,optout_url,search_mode,guide_steps,integration_status').order('name')),
    withTimeout(supabase.from('scan_source_results').select('scan_id,site_slug,status,findings_count,checked_at').eq('user_id',user.id).order('checked_at',{ascending:false}).limit(200)),
    withTimeout(supabase.from('verification_checks').select('id,removal_id,outcome,method,checked_at').eq('user_id',user.id).order('checked_at',{ascending:false}).limit(200)),
    withTimeout(supabase.from('monitoring_schedules').select('enabled,subscription_active,next_check_at').eq('user_id',user.id).maybeSingle()),
    withTimeout(supabase.from('monitoring_notifications').select('id,event,message,created_at,read_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100))
  ]);
  const failed = queries.some(item=>item.status==='rejected'||item.value.error);
  if (failed) {
    if (statusElement) statusElement.textContent = 'Some account information could not be loaded. Refresh to try again.';
    return;
  }
  if (statusElement) statusElement.textContent = '';
  const [profile,scans,findings,removals,sites,sourceChecks,verificationChecks,monitoringSchedule,monitoringNotifications] = queries.map(x=>x.value.data);
  const latest = scans[0];
  const pending = removals.filter(x=>x.status!=='verified_removed').length;
  const removed = removals.filter(x=>x.status==='verified_removed').length;
  const activeFindings = findings.filter(x=>x.match_status!=='dismissed');
  appText('count-exposures',String(activeFindings.length));
  appText('count-pending',String(pending));
  appText('count-removed',String(removed));
  appText('profile-greeting',profile?.first_name ? 'Welcome, '+profile.first_name : 'Your privacy overview');
  appText('profile-state',!profile ? 'Complete your profile to prepare for scans.' :
    profile.consent_to_search ? 'Profile saved and search authorization enabled.' : 'Profile saved. Search authorization is not enabled.');
  const scanButton = document.getElementById('start-scan');
  if (scanButton) {
    scanButton.disabled = true;
    appText('scan-action-note','Checking search availability…');
    const {data:availability,error:availabilityError} = await supabase.functions.invoke('privacy-scan',{method:'GET'});
    if (availabilityError || !availability?.ready) {
      appText('scan-action-note','Search service is not connected.');
    } else if (!profile) {
      appText('scan-action-note','Save your profile before searching.');
    } else if (!profile.consent_to_search) {
      appText('scan-action-note','Authorize searches in My Profile first.');
    } else {
      const lastRun = latest?.started_at ? new Date(latest.started_at).getTime() : 0;
      if (lastRun && Date.now()-lastRun < 86400000) {
        appText('scan-action-note','You can run another search 24 hours after your previous attempt.');
      } else {
        scanButton.disabled = false;
        appText('scan-action-note','');
        scanButton.addEventListener('click',async()=>{
          scanButton.disabled = true;
          scanButton.textContent = 'Scanning…';
          appText('scan-action-note','Searching supported sites through the search index…');
          try {
            const {data,error}=await supabase.functions.invoke('privacy-scan',{method:'POST'});
            if (error) {
              let message = 'Search could not be completed. Try again later.';
              try { const payload = await error.context?.json(); if (payload?.error) message=payload.error; } catch {}
              throw new Error(message);
            }
            if (data?.status !== 'completed') throw new Error('Search did not finish successfully.');
            appText('scan-action-note','Scan completed. Refreshing results…');
            window.location.assign('./scan-results.html');
          } catch(error) {
            scanButton.textContent = 'Start Privacy Scan';
            appText('scan-action-note',error.message || 'Unable to run scan.');
            scanButton.disabled = false;
          }
        });
      }
    }
  }
  appText('scan-state',latest ? latest.status : 'Not started');
  appText('scan-summary',latest ? 'Latest scan: '+formatDate(latest.started_at)+' · '+latest.status : '');
  appText('finding-count',String(findings.length));
  appText('removal-count',String(removals.length));
  appText('monitor-last',latest ? formatDate(latest.started_at)+' · '+latest.status : 'No scan completed yet.');
  const checksForLastScan = latest ? sourceChecks.filter(x=>x.scan_id===latest.id) : [];
  const checked = checksForLastScan.filter(x=>x.status==='indexed_checked').length;
  const missed = checksForLastScan.filter(x=>x.status==='unable_to_check').length;
  appText('scan-coverage', checksForLastScan.length
    ? checked+' of '+sites.length+' sources searched via index'+(missed ? ' · '+missed+' unavailable' : '')
    : '');
  appText('monitor-pill', monitoringSchedule?.enabled ? 'Enabled' : 'Not enabled');
  appText('monitor-schedule-state', monitoringSchedule?.enabled && monitoringSchedule?.next_check_at
    ? 'Next scan: '+formatDate(monitoringSchedule.next_check_at) : '');
  appText('monitor-alert-count',String(monitoringNotifications.length));
  displayItems('monitor-alerts',monitoringNotifications,'No alerts.',item=>
    buildRow(item.message,formatDate(item.created_at),item.event==='possible_exposure'?'Potential Match':'Notice'));

  displayItems('recent-activity',scans.slice(0,5),'No scan activity yet.',x=>buildRow('Privacy scan',formatDate(x.started_at),x.status));
  displayItems('monitor-history',scans,'No scans yet.',x=>buildRow('Privacy scan',formatDate(x.started_at),x.status));
  initializeFindingReview(user,findings,removals,sites);
  initializeSiteDirectory(sites);
  initializeSourceCoverage(sites,sourceChecks,latest);
  initializeRemovalVerification(user,removals,findings,verificationChecks);

}

const managedConsentStatement = 'I authorize Offline Delete to act as my agent for the purpose of locating records about me and preparing and submitting privacy or opt-out requests to supported data brokers. I understand that some sites require my own verification and that removal is not guaranteed. I can request revocation of this authorization.';

async function initializeManagedCases(user) {
  const [profiles,casesResponse,authorizationsResponse,sitesResponse]=await Promise.all([
    withTimeout(supabase.from('customer_profiles').select('first_name,last_name,consent_to_search').eq('user_id',user.id).maybeSingle()),
    withTimeout(supabase.from('removal_cases').select('id,status,payment_status,price_cents,authorization_id,created_at').eq('user_id',user.id).order('created_at',{ascending:false})),
    withTimeout(supabase.from('customer_authorizations').select('id,signed_name,signed_at,revoked_at').eq('user_id',user.id).order('signed_at',{ascending:false})),
    withTimeout(supabase.from('supported_sites').select('name,slug,search_url').order('name'))
  ]);
  const feedback=document.getElementById('managed-case-feedback');
  if(profiles.error||casesResponse.error||authorizationsResponse.error||sitesResponse.error) {
    if(feedback) feedback.textContent='Unable to load case information. Refresh to try again.';
    return;
  }
  const profile=profiles.data;
  const cases=casesResponse.data||[];
  const authorizations=authorizationsResponse.data||[];
  const sites=sitesResponse.data||[];
  const tasksResponse=await withTimeout(supabase.from('case_site_tasks').select('case_id,site_slug,status').eq('user_id',user.id));
  if(tasksResponse.error){if(feedback)feedback.textContent='Unable to load case progress.';return;}
  const allTasks=tasksResponse.data||[];
  let checkoutReady=false;
  try{
    const {data,error}=await withTimeout(supabase.functions.invoke('case-checkout',{method:'GET'}));
    checkoutReady=!error && Boolean(data?.ready);
  }catch{}
  const checkoutMessage=new URL(window.location.href).searchParams.get('checkout');
  if(feedback && checkoutMessage==='success'){
    feedback.textContent=cases.some(c=>c.payment_status==='paid')
      ? 'Payment confirmed. Your case is awaiting processing.'
      : 'Checkout returned. Payment is pending verification by the payment provider.';
  } else if(feedback && checkoutMessage==='cancelled'){
    feedback.textContent='Checkout cancelled. No new payment was confirmed.';
  }
  const list=document.getElementById('managed-cases-list');
  if(list){
    list.replaceChildren();
    for(const item of cases){
      const tasks=allTasks.filter(t=>t.case_id===item.id);
      const authRow=authorizations.find(a=>a.id===item.authorization_id);
      const card=document.createElement('details');card.className='managed-case-card';
      const head=document.createElement('summary');
      head.textContent='Case '+item.id.slice(0,8).toUpperCase()+' · '+formatDate(item.created_at)+' · '+
        (item.payment_status==='paid'?'Paid':item.payment_status==='pending'?'Payment pending':'Not paid');
      const note=document.createElement('p');
      note.textContent='Status: '+item.status+' · '+tasks.length+' websites · '+tasks.filter(t=>t.status==='verified_removed').length+' verified removed';
      card.append(head,note);
      if(checkoutReady && item.payment_status!=='paid' && authRow && !authRow.revoked_at){
        const pay=makeAction('Pay $25 Securely','listing-confirm',async()=>{
          pay.disabled=true;pay.textContent='Opening secure checkout…';
          if(feedback)feedback.textContent='';
          try{
            const {data,error}=await supabase.functions.invoke('case-checkout',{
              method:'POST',body:{case_id:item.id}
            });
            if(error || !data?.checkout_url){
              let reason='Secure checkout is not currently available.';
              try{const payload=await error?.context?.json();if(payload?.error)reason=payload.error;}catch{}
              throw new Error(reason);
            }
            const url=new URL(data.checkout_url);
            if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')
              throw new Error('Unexpected checkout destination.');
            window.location.assign(url.href);
          }catch(error){
            if(feedback)feedback.textContent=error.message||'Unable to open checkout.';
            pay.disabled=false;pay.textContent='Pay $25 Securely';
          }
        });
        card.append(pay);
      } else if(item.payment_status!=='paid' && !checkoutReady) {
        const coming=document.createElement('small');
        coming.textContent='Secure checkout is not configured yet.';
        card.append(coming);
      }
      if(authRow && !authRow.revoked_at){
        const revoke=makeAction('Revoke authorization','listing-secondary',async()=>{
          if(!window.confirm('Revoke this authorization? Future managed requests under this authorization must stop.'))return;
          revoke.disabled=true;
          const {error}=await withTimeout(supabase.from('customer_authorizations')
            .update({revoked_at:new Date().toISOString()}).eq('id',authRow.id).eq('user_id',user.id));
          if(error){if(feedback)feedback.textContent='Could not revoke authorization.';revoke.disabled=false;}
          else window.location.reload();
        });
        card.append(revoke);
      } else if(authRow?.revoked_at) {
        const rev=document.createElement('small');rev.textContent='Authorization revoked';card.append(rev);
      }
      const ul=document.createElement('div');ul.className='managed-case-sites';
      for(const siteTask of tasks){
        const line=document.createElement('div');line.className='managed-case-site';
        const name=document.createElement('span');name.textContent=sites.find(x=>x.slug===siteTask.site_slug)?.name||siteTask.site_slug;
        const badge=document.createElement('span');badge.className='app-pill';badge.textContent=siteTask.status.replaceAll('_',' ');
        line.append(name,badge);ul.append(line);
      }
      card.append(ul);list.append(card);
    }
    if(!cases.length)list.textContent='No managed cases yet.';
  }
  appText('managed-case-count',String(cases.length));
  const covered=document.getElementById('managed-covered-sites');
  if(covered){
    covered.replaceChildren();
    for(const site of sites){
      const span=document.createElement('span');span.textContent=site.name;covered.append(span);
    }
  }
  const form=document.getElementById('managed-case-form');
  if(!form)return;
  const nameField=document.getElementById('managed-signed-name');
  if(profile?.first_name && profile?.last_name){
    nameField.placeholder='Type '+profile.first_name+' '+profile.last_name;
  }
  const currentOpen=cases.find(c=>c.status==='draft'||c.status==='awaiting_payment');
  if(currentOpen){
    form.hidden=true;
    if(feedback && checkoutMessage!=='success' && checkoutMessage!=='cancelled'){
      feedback.textContent=currentOpen.status==='awaiting_payment'
        ?'Payment is pending. Open your case to view checkout status.'
        :checkoutReady?'Draft ready. Open your case to pay securely.'
        :'Draft created. Checkout has not been connected yet.';
    }
    return;
  }
  if(!profile?.first_name||!profile?.last_name||!profile.consent_to_search){
    const button=document.getElementById('managed-create-case');button.disabled=true;
    if(feedback)feedback.textContent='Complete your profile and enable search authorization before starting a case.';
    return;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const signed=nameField.value.trim().replace(/\s+/g,' ');
    const expected=(profile.first_name+' '+profile.last_name).trim().replace(/\s+/g,' ');
    if(signed.toLocaleLowerCase()!==expected.toLocaleLowerCase()){
      feedback.textContent='Enter your legal name exactly as shown on your profile.';return;
    }
    if(!document.getElementById('managed-consent').checked)return;
    const button=document.getElementById('managed-create-case');
    button.disabled=true;feedback.textContent='Saving authorization…';
    try{
      const {data:authorization,error:authError}=await withTimeout(supabase.from('customer_authorizations')
        .insert({user_id:user.id,signed_name:signed,consent_text:managedConsentStatement})
        .select('id').single());
      if(authError||!authorization)throw new Error('Unable to save your authorization.');
      const {data:caseRow,error:caseError}=await withTimeout(supabase.from('removal_cases')
        .insert({user_id:user.id,authorization_id:authorization.id})
        .select('id,status').single());
      if(caseError||!caseRow)throw new Error('Authorization saved, but the case could not be created. Please retry.');
      feedback.textContent='Your draft case is ready. No charge or requests have been sent.';
      window.location.reload();
    }catch(err){feedback.textContent=err.message||'Unable to save case.';button.disabled=false;}
  });
}

async function initializeAdminOperations(user) {
  const access=document.getElementById('admin-access-state');
  const {data:role,error:roleError}=await withTimeout(supabase.from('case_administrators').select('user_id').eq('user_id',user.id).maybeSingle());
  const nav=document.getElementById('admin-nav');
  if(role&&!roleError&&nav)nav.hidden=false;
  if(roleError||!role){if(access)access.textContent='Administrator access required.';return;}
  const load=async()=>{
    const {data,error}=await supabase.functions.invoke('case-admin',{method:'POST',body:{action:'list'}});
    if(error||!data){if(access)access.textContent='Could not load administrator queue.';return;}
    if(access)access.hidden=true;
    const root=document.getElementById('admin-dashboard');
    if(root)root.hidden=false;
    const cases=data.cases||[],tasks=data.tasks||[],people=new Map((data.customers||[]).map(x=>[x.user_id,x])),sourceMap=new Map((data.sites||[]).map(x=>[x.slug,x])),authorizationMap=new Map((data.authorizations||[]).map(x=>[x.id,x]));
    appText('admin-drafts',String(cases.filter(x=>x.status==='draft').length));
    appText('admin-actives',String(cases.filter(x=>x.status==='active').length));
    appText('admin-queue-count',String(tasks.filter(x=>['research_needed','manual_action','customer_action'].includes(x.status)).length));
    appText('admin-task-total',String(tasks.length));
    displayItems('admin-cases-list',cases,'No customer cases yet.',c=>{
      const person=people.get(c.user_id);
      return buildRow(person?[person.first_name,person.last_name].filter(Boolean).join(' '):'Customer',
        formatDate(c.created_at)+' · '+tasks.filter(t=>t.case_id===c.id).length+' sites · '+c.payment_status+
          (authorizationMap.get(c.authorization_id)?.revoked_at?' · authorization revoked':''),
        c.status);
    });
    const container=document.getElementById('admin-tasks-list');
    if(!container)return;
    container.replaceChildren();
    for(const task of tasks){
      const caseRow=cases.find(c=>c.id===task.case_id);
      const person=people.get(task.user_id);
      const item=document.createElement('div');item.className='admin-task-entry';
      const title=document.createElement('strong');
      const source=sourceMap.get(task.site_slug);
      const customerName=person?[person.first_name,person.last_name].filter(Boolean).join(' '):'Customer';
      title.textContent=customerName+' · '+(source?.name||task.site_slug);
      const revoked=Boolean(caseRow && authorizationMap.get(caseRow.authorization_id)?.revoked_at);
      const meta=document.createElement('small');meta.textContent=(caseRow?.payment_status||'not_configured')+' · '+task.status+(revoked?' · authorization revoked':'');
      const row=document.createElement('div');row.className='admin-task-controls';
      const select=document.createElement('select');
      for(const v of ['research_needed','manual_action','ready_to_send','customer_action','unable_to_verify','not_found']){
        const option=document.createElement('option');option.value=v;option.textContent=v.replaceAll('_',' ');option.selected=v===task.status;select.append(option);
      }
      const note=document.createElement('input');note.placeholder='Internal task note';note.maxLength=1500;note.value=task.internal_note||'';
      const save=makeAction('Save','listing-confirm',async()=>{
        save.disabled=true;
        const {data:updated,error}=await supabase.functions.invoke('case-admin',{
          method:'POST',body:{action:'update_task',task_id:task.id,status:select.value,note:note.value}
        });
        save.disabled=false;
        if(error||!updated?.task){meta.textContent='Unable to save task.';return;}
        meta.textContent=(caseRow?.payment_status||'not_configured')+' · '+updated.task.status;
      });
      const draft=makeAction('Copy Request Draft','listing-secondary',async()=>{
        const subject='Authorized personal information removal request for '+customerName;
        const body=['To the Privacy Team at '+(source?.name||task.site_slug)+',',
          '',
          'I am assisting '+customerName+' with an authorized personal information removal request.',
          'Please identify and suppress or remove any publicly searchable personal information and associated people-search listings about this individual, where your policies and applicable law allow.',
          'Please advise which record URLs, identifying details, or consumer verification steps you require, and confirm when any approved removal has been completed.',
          'I understand that you may require additional information or verification through your official privacy request process.',
          '',
          'Sincerely,',
          'Offline Delete Privacy Operations'].join('\n');
        try{
          await navigator.clipboard.writeText('Subject: '+subject+'\n\n'+body);
          meta.textContent='Request draft copied. Confirm the official contact route before sending.';
        }catch{meta.textContent='Clipboard unavailable. Use a supported browser.';}
      });
      if(revoked){save.disabled=true;draft.disabled=true;}
      row.append(select,note,save,draft);item.append(title,meta,row);container.append(item);
    }
    if(!tasks.length)container.textContent='No tasks in queue.';
  };
  await load();
}

try {
  const { data: { user }, error } = await withTimeout(auth.getUser());
  if (page !== 'home' && page !== 'profile' && !appPageNames.has(page)) {
    if (user) {
      go(home);
    } else {
      if (callback.searchParams.has('code') || confirmationFailed) {
        window.history.replaceState(null, '', signIn.href);
        status.textContent = 'We couldn’t verify this sign-in. Try again.';
      }
      // Sign-in controls are enabled in the HTML from the start.
    }
  } else if (!user && (!error || error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403)) {
    go(signIn);
  } else if (!user) {
    const authFeedback = status || document.querySelector('#app-status');
    if (authFeedback) authFeedback.textContent = 'We couldn’t verify your session. Refresh to try again.';
  } else {
    // Attach logout immediately, even if the page's account data takes time to load.
    const button = document.querySelector('#signout');
    const authFeedback = document.querySelector('#status') || document.querySelector('#app-status');
    if (button) {
      button.hidden = false;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = 'Signing out…';
        if (authFeedback) authFeedback.textContent = '';
        try {
          const { error: signOutError } = await withTimeout(auth.signOut({ scope: 'local' }));
          if (signOutError) throw signOutError;
          go(signIn);
        } catch {
          if (authFeedback) authFeedback.textContent = 'We couldn’t sign you out. Try again.';
          button.disabled = false;
          button.textContent = 'Log Out';
        }
      });
    }
    if (page === 'profile') await initializeProfile(user);
    if (page === 'managed') await initializeManagedCases(user);
    else if (page === 'admin') await initializeAdminOperations(user);
    else if (appPageNames.has(page)) await initializeCustomerApp(user);
    if(page !== 'admin'){
      const nav=document.getElementById('admin-nav');
      if(nav) {
        supabase.from('case_administrators').select('user_id').eq('user_id',user.id).maybeSingle()
          .then(({data})=>{if(data)nav.hidden=false;}).catch(()=>{});
      }
    }
    window.addEventListener('pageshow', event => {
      if (event.persisted) window.location.reload();
    });
  }
} catch {
  const authFeedback = status || document.querySelector('#app-status');
  if (authFeedback) authFeedback.textContent = 'Authentication is temporarily unavailable. Refresh to try again.';
}
