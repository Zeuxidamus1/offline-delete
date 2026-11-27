import { createClient } from '@supabase/supabase-js';

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


const appPageNames = new Set(['dashboard','scan-results','removals','monitoring']);
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
    if (url.protocol === 'https:' && /(^|\\.)whitepages\\.com$/i.test(url.hostname)) return url.href;
  } catch {}
  return null;
}
function initializeFindingReview(user, findings, removals) {
  const activeTab = document.getElementById('filter-active');
  const dismissedTab = document.getElementById('filter-dismissed');
  const container = document.getElementById('findings-list');
  if (!container) return;
  const guide = document.getElementById('removal-guide');
  const guideListing = document.getElementById('guide-open-listing');
  const guideSubmitted = document.getElementById('guide-submitted');
  const guideFeedback = document.getElementById('guide-feedback');
  let currentFilter = 'active';
  let selectedFinding = null;
  const requestMap = new Map(removals.map(x=>[x.finding_id,x]));

  function notify(message) { appText('app-status', message); }
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
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = finding.source_name;
      const date = document.createElement('small');
      date.textContent = formatDate(finding.detected_at);
      info.append(title,date);
      const controls = document.createElement('div');
      controls.className = 'app-item-right listing-actions';
      const pill = document.createElement('span');
      pill.className = 'app-pill'+(finding.match_status==='confirmed'?' confirmed-pill':'');
      pill.textContent = finding.match_status==='confirmed' ? 'Confirmed' : finding.match_status==='dismissed'?'Not Me':'Possible';
      controls.append(pill);
      const url = listingUrl(finding.listing_url);
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target='_blank';
        link.rel='noopener noreferrer';
        link.textContent='View Listing';
        controls.append(link);
      }
      const request = requestMap.get(finding.id);
      if (finding.match_status==='dismissed') {
        controls.append(makeAction('Undo','listing-secondary',()=>classify(finding,'possible')));
      } else if (finding.match_status==='possible') {
        controls.append(makeAction('This Is Me','listing-confirm',()=>classify(finding,'confirmed')));
        controls.append(makeAction('Not Me','listing-secondary',()=>classify(finding,'dismissed')));
      } else {
        if (request?.status==='submitted' || request?.status==='verified_removed') {
          const state=document.createElement('span');
          state.className='app-pill';
          state.textContent=request.status==='submitted'?'Submitted':'Verified Removed';
          controls.append(state);
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
    if (next!=='confirmed' && selectedFinding?.id===finding.id) guide.hidden=true;
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
        .select('id,finding_id,status,updated_at').single()).catch(e=>({error:e}));
      if (error) {
        if (error.code!=='23505') {notify('Unable to start removal. Try again.');return;}
      } else {requestMap.set(finding.id,data);}
    }
    selectedFinding=finding;
    guideListing.href=url;
    guideFeedback.textContent='';
    guide.hidden=false;
    guide.scrollIntoView({behavior:'smooth',block:'nearest'});
    paint();
  }
  document.getElementById('close-removal-guide')?.addEventListener('click',()=>{guide.hidden=true;});
  guideSubmitted?.addEventListener('click',async()=>{
    if (!selectedFinding) return;
    const request=requestMap.get(selectedFinding.id);
    if (!request) {guideFeedback.textContent='Could not find removal request. Refresh the page.';return;}
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
    paint();
  });
  activeTab?.addEventListener('click',()=>{currentFilter='active';paint();});
  dismissedTab?.addEventListener('click',()=>{currentFilter='dismissed';guide.hidden=true;paint();});
  paint();
}

async function initializeCustomerApp(user) {
  const statusElement = document.getElementById('app-status');
  if (statusElement) statusElement.textContent = 'Loading your account…';
  const queries = await Promise.allSettled([
    withTimeout(supabase.from('customer_profiles').select('first_name,last_name,consent_to_search').eq('user_id',user.id).maybeSingle()),
    withTimeout(supabase.from('privacy_scans').select('id,status,started_at,completed_at').eq('user_id',user.id).order('started_at',{ascending:false}).limit(100)),
    withTimeout(supabase.from('privacy_findings').select('id,source_name,listing_url,match_status,detected_at').eq('user_id',user.id).order('detected_at',{ascending:false}).limit(200)),
    withTimeout(supabase.from('privacy_removals').select('id,finding_id,status,updated_at').eq('user_id',user.id).order('updated_at',{ascending:false}).limit(200))
  ]);
  const failed = queries.some(item=>item.status==='rejected'||item.value.error);
  if (failed) {
    if (statusElement) statusElement.textContent = 'Some account information could not be loaded. Refresh to try again.';
    return;
  }
  if (statusElement) statusElement.textContent = '';
  const [profile,scans,findings,removals] = queries.map(x=>x.value.data);
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
      appText('scan-action-note','Whitepages search integration is awaiting its free search API connection.');
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
          appText('scan-action-note','Searching indexed Whitepages pages…');
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
  displayItems('recent-activity',scans.slice(0,5),'No scan activity yet.',x=>buildRow('Privacy scan',formatDate(x.started_at),x.status));
  displayItems('monitor-history',scans,'No scans yet.',x=>buildRow('Privacy scan',formatDate(x.started_at),x.status));
  initializeFindingReview(user,findings,removals);
  displayItems('removals-list',removals,'No removal requests recorded yet.',x=>{
    const finding = findings.find(f=>f.id===x.finding_id);
    return buildRow(finding?.source_name||'Removal request',formatDate(x.updated_at),x.status);
  });
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
    status.textContent = 'We couldn’t verify your session. Refresh to try again.';
  } else {
    if (page === 'profile') await initializeProfile(user);
    if (appPageNames.has(page)) await initializeCustomerApp(user);
    const button = document.querySelector('#signout');
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        const { error: signOutError } = await auth.signOut({ scope: 'local' });
        if (signOutError) throw signOutError;
        go(signIn);
      } catch {
        status.textContent = 'We couldn’t sign you out. Try again.';
        button.disabled = false;
      }
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) window.location.reload();
    });
  }
} catch {
  status.textContent = 'Authentication is temporarily unavailable. Refresh to try again.';
}
