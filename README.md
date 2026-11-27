# Offline Delete

Offline Delete helps users review and track requests to remove their own listings from FastPeopleSearch and FamilyTreeNow.

## Run the demo

Use Node.js 24 or later. Run `npm start` and open http://localhost:3000. Choose **Load Fictional Matches**, or enter fictional details with a US phone number and use code `123456`. Confirm a match, select it, authorize the simulated request, then run a demo recheck. The demo stores data in memory and sends no SMS or removal requests. Run `npm test` to exercise the HTTP workflow.

## Run guided opt-outs

Set these environment variables before running `npm start`:

- `LIVE_MODE=1`
- `APP_ORIGIN=https://your-domain.example` with no trailing slash
- `DATA_KEY` to a base64 encoded 32 byte secret generated with `openssl rand -base64 32`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` from your Twilio Verify account

Place the app behind an HTTPS reverse proxy. It binds to loopback by default. Set `PORT` as needed. Keep the service in a single process with a private persistent volume for `data/`. Keep the key outside the repository and configure the proxy to omit request bodies, cookies, and referrers from logs. Trial accounts may require verified recipients.

After phone verification, users search the brokers directly, add the exact profile links, confirm their own records, and complete the linked official opt-out forms. Authorization opens the reporting checklist. A user can record a confirmation reference and check the exact listing later. Manual observations and reported submissions are labeled as such. Broker lookups, form submissions, email, and removal verification are simulated only in the demo. Live automation needs a source-specific permitted integration and is currently disabled for both sources.

- FastPeopleSearch uses its removal form and a follow-up email. [Removal form](https://www.fastpeoplesearch.com/removal) and [Louisiana Judicial College walkthrough](https://lajudicialcollege.org/Judicial%20Security.pdf).
- FamilyTreeNow uses a privacy request with CAPTCHA and email verification. [Opt-out page](https://www.familytreenow.com/optout) and [documented walkthrough](https://support.norton.com/sp/tr/tr/home/current/solutions/v2023040613553951).

## Data handling

The name and date of birth are validated and discarded. City and state are guidance for manual matching. The pending SMS session stores the phone temporarily and expires after ten minutes. Verification sends the phone and code to Twilio. The application encrypts SQLite payloads with AES-256-GCM and uses a random HttpOnly browser session cookie. Workspaces and listings expire after 24 hours without an update. Users can delete their workspace earlier. A session is tied to the original browser and does not support sign-in recovery or cross-device access.
