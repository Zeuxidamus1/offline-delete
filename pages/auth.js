import { createClient } from '@supabase/supabase-js';

const { auth } = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: 'pkce',
    storageKey: 'offline-delete-auth',
    detectSessionInUrl: true,
    persistSession: true
  }
});

const signIn = new URL('./', window.location.href);
const home = new URL('./home.html', signIn);
const page = document.body.dataset.page;
const form = document.querySelector('#auth-form');
const status = document.querySelector('#status');
const callback = new URL(window.location.href);
const confirmationFailed = callback.searchParams.has('error') ||
  new URLSearchParams(callback.hash.slice(1)).has('error');

function go(destination) {
  window.location.replace(destination.href);
}

if (form) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    const email = new FormData(form).get('email').trim();
    button.disabled = true;
    status.textContent = '';
    try {
      const { error } = await auth.signInWithOtp({
        email,
        options: { shouldCreateUser: page === 'signup', emailRedirectTo: signIn.href }
      });
      if (!error) {
        status.textContent = 'Check your email for a confirmation link.';
      } else if (error.status === 429) {
        status.textContent = 'Too many requests. Try again in a few minutes.';
      } else {
        status.textContent = 'We couldn’t send a link. Check your email address and try again.';
      }
    } catch {
      status.textContent = 'Sign-in is temporarily unavailable. Try again.';
    } finally {
      button.disabled = false;
    }
  });
}

try {
  const { data: { user }, error } = await auth.getUser();
  if (page !== 'home') {
    if (user) {
      go(home);
    } else {
      if (callback.searchParams.has('code') || confirmationFailed) {
        window.history.replaceState(null, '', signIn.href);
        status.textContent = 'This link could not be verified. Request a new one.';
      }
      form.querySelector('button').disabled = false;
    }
  } else if (!user && (!error || error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403)) {
    go(signIn);
  } else if (!user) {
    status.textContent = 'We couldn’t verify your session. Refresh to try again.';
  } else {
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
