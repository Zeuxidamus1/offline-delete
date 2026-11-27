import { createClient } from '@supabase/supabase-js';

const auth = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: 'pkce',
    storageKey: 'offline-delete-auth',
    detectSessionInUrl: true
  }
}).auth;

const loginUrl = new URL('./', location.href);
const dashboardUrl = new URL('./dashboard.html', loginUrl);
const loginForm = document.querySelector('#email-login');
const feedback = document.querySelector('#login-feedback');

try {
  const { data: { user } } = await auth.getUser();
  if (loginForm && user) {
    location.replace(dashboardUrl.href);
  } else if (loginForm) {
    loginForm.hidden = false;
    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = loginForm.querySelector('button');
      submit.disabled = true;
      feedback.textContent = '';
      try {
        const email = new FormData(loginForm).get('email');
        const { error } = await auth.signInWithOtp({
          email,
          options: { emailRedirectTo: loginUrl.href }
        });
        feedback.textContent = error
          ? 'Could not send a sign-in link. Try again in a moment.'
          : 'Check your inbox for the sign-in link and open it in this browser.';
      } catch {
        feedback.textContent = 'Sign-in is unavailable. Try again in a moment.';
      } finally {
        submit.disabled = false;
      }
    });
  } else if (!user) {
    location.replace(loginUrl.href);
  } else {
    document.querySelector('#signed-in').hidden = false;
    const signout = document.querySelector('#signout');
    signout.addEventListener('click', async () => {
      const { error } = await auth.signOut({ scope: 'local' });
      if (!error) location.replace(loginUrl.href);
      else document.querySelector('#notice').textContent = 'Could not sign out. Try again.';
    });
    await import('./dashboard-entry.js');
  }
} catch {
  if (feedback) feedback.textContent = 'Sign-in is unavailable. Try again in a moment.';
  else location.replace(loginUrl.href);
}
