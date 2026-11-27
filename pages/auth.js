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

try {
  const { data: { user }, error } = await withTimeout(auth.getUser());
  if (page !== 'home' && page !== 'profile') {
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
