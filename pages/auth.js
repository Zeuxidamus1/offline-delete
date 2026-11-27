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
const signInButton = document.querySelector('#github-signin');
const passwordForm = document.querySelector('#password-auth');
const status = document.querySelector('#status');
const callback = new URL(window.location.href);
const confirmationFailed = callback.searchParams.has('error') ||
  new URLSearchParams(callback.hash.slice(1)).has('error');

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
    status.textContent = '';
    try {
      const { data, error } = signingUp
        ? await auth.signUp({ ...credentials, options: { emailRedirectTo: signIn.href } })
        : await auth.signInWithPassword(credentials);
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
    } catch {
      status.textContent = 'Authentication is temporarily unavailable. Try again.';
    } finally {
      submit.disabled = false;
      signInButton.disabled = false;
    }
  });
}

if (signInButton) {
  signInButton.addEventListener('click', async () => {
    signInButton.disabled = true;
    status.textContent = '';
    try {
      const { error } = await auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: signIn.href }
      });
      if (error) throw error;
    } catch {
      status.textContent = 'GitHub sign-in is temporarily unavailable. Try again.';
      signInButton.disabled = false;
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
        status.textContent = 'We couldn’t verify this sign-in. Try again.';
      }
      signInButton.disabled = false;
      passwordForm.querySelector('button').disabled = false;
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
