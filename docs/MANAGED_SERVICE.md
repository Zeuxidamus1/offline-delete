# Offline Delete 2.0 — Managed Removal Operations

## Current state (beta)

The application now supports a managed service campaign with **22 fixed people-search source targets**. Every customer starts with a separate, RLS-isolated case and 22 independent tasks. Existing scanner and self-service removals remain intact.

### Customer flow

1. Sign in and complete My Profile, including search authorization.
2. Open **My Cases**.
3. Type the first and last name as stored in My Profile and affirm the specific agent authorization.
4. Save the authorization and create a **draft** case. Database triggers generate exactly 22 site tasks.
5. The customer sees site-level statuses and can revoke authorization. Revoking cancels uncharged drafts and prevents further administrative updates to cases signed under that authorization.
6. Hosted Stripe payment is available only if all merchant credentials are configured and the explicit activation flag is enabled.
7. The customer can track their case status and task progress.

### Admin flow

- Administrator roles are assigned server-side in `case_administrators`; a customer cannot self-promote.
- The Admin page lists cases and the 22-site manual work queue.
- Authorized admins can mark tasks as researching, awaiting manual action, ready for submission, awaiting customer action, not found, or unable to verify.
- Admins can copy an individually drafted privacy request for a specific customer and broker.
- This **does not send emails**. A verified accepted submission channel and paid campaign are prerequisites for actual delivery.
- Updates are recorded in `case_events`.
- The admin API rejects task changes after authorization revocation.

### Payment readiness (not active by default)

- `case-checkout` requires a signed-in customer and a draft belonging to them.
- Price and currency are set on the server ($25.00 USD one-time) and cannot be supplied by the browser.
- Checkout uses a Stripe-hosted session; existing open sessions are reused to reduce duplicate charges.
- `case-payment-webhook` validates the Stripe signature against the exact raw payload and the event timestamp.
- Only a session with the expected session ID, case ID, owner, currency, amount, and paid payment status can change a case to paid.
- Payment events are recorded in `case_payment_events` to support idempotent reconciliation.
- No payment is marked paid merely because the customer returns to the success page.
- **Checkout is OFF** until all three Supabase Edge Function environment variables are configured:
  - `STRIPE_SECRET_KEY` (Stripe secret key; start in test mode)
  - `STRIPE_WEBHOOK_SECRET` (secret for the corresponding webhook endpoint)
  - `STRIPE_CHECKOUT_ENABLED=true` (last, only after validated end-to-end test)
- Register the webhook endpoint in Stripe:
  `https://plapeurvvjezzdeoyxmu.supabase.co/functions/v1/case-payment-webhook`
- Subscribe the endpoint to `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
- Before allowing live charges, test successful payment, cancellation, failed payment, expired session, duplicate webhook, revoked authorization, and cross-customer access.
- Implement and test refunds, chargebacks, and customer-service dispute policy before public launch.

### Backend tables

- `case_administrators`: explicit administrator allowlist.
- `customer_authorizations`: signed authorizations and revocations.
- `removal_cases`: one case per campaign, payment and fulfillment status.
- `managed_service_sites`: fixed source coverage snapshot of the 22 sites.
- `case_site_tasks`: individual source-level work queue and status.
- `case_events`: audit history.
- `case_payment_events`: Stripe webhook receipt records.

### Remaining work before any paying launch

- Connect a Stripe merchant account, configure secrets, run Stripe test-mode and signed webhook integration tests.
- Complete manual verification of the removal channel for each of the 22 sites. Some customer-service emails explicitly refuse privacy requests.
- Implement a dedicated outbound mailer from a domain-owned service mailbox, an idempotent correspondence outbox, inbox reply matching, and authorized submission adapters.
- Build a verification and escalation system with evidence, retry windows and manual QA. Never equate submission with verified removal.
- Define duration and legal terms for the $25 campaign; have counsel review the service authorization and privacy policy.
- Test multi-customer isolation and full signed-in browser workflows, including accessibility and mobile.
- Add secret rotation, payment reconciliation, support tools and abuse/rate limits.

**No broker requests are automatically sent by this new managed-service implementation. No checkout can accept payments until explicitly enabled.**

## Automated removal preparation and outbound delivery (November 28, 2026)

**Implemented and active for paid cases:**
- A database trigger prepares 22 personalized, individually keyed removal requests immediately when a Stripe webhook changes a case from unpaid to paid. It is idempotent.
- `case_removal_correspondence` stores the prepared request, delivery state and receipt. Customers have RLS-restricted access only to progress fields, not to full internal correspondence.
- `removal_channel_registry` is a controlled, server-side per-provider register. Only TruePeopleSearch, FastPeopleSearch and FamilyTreeNow have confirmed official form routes; their requests are queued for manual opt-out and customer verification. The other nineteen require channel research.
- The administrator dashboard displays stored per-customer request drafts, verified official form links, and a **Record Manual Submission** action. This requires a paid case, active authorization and actual submission reference. It does not itself send a request.
- `case_followup_reminders` schedules a review 14 days after an actual recorded submission. The admin can mark due follow-ups reviewed. No follow-up is falsely described as having been sent.
- Outbound worker `removal-dispatch` executes from private server-side Cron every six hours. It verifies the preexisting private job token and checks approval and configuration before sending anything.
- `claim_approved_removal_emails` atomically locks and creates unique dispatch claims only for a paid campaign, unrevoked customer authorization, search consent and a reviewed email contact with `automated_delivery_approved=true`. Duplicates are blocked by a unique database constraint and an email-provider idempotency key.
- Delivery attempts and provider message IDs are stored in `case_email_dispatches`. Uncertain network failures go to manual review rather than triggering automatic duplicate transmissions.

**Outbound email is currently disabled.** A dedicated sender from a verified domain is not configured and no provider email channel has been approved. To enable it in the future, set valid server-side Edge Function secrets `RESEND_API_KEY`, `REMOVAL_SENDER_EMAIL` (a verified sending domain) and, only after tests and broker channel validation, `REMOVAL_DISPATCH_ENABLED=true`. The worker uses the Resend transactional email API; no personal Gmail account is used.

Only a verified accepted privacy request channel may be approved in the registry. Do not substitute general support mailboxes for websites that require designated opt-out forms. No automation bypasses CAPTCHA, payment gates, consent verification or access controls.

**QA performed:** verified 22 correspondence rows generated from the existing paid case, three official-form tasks, nineteen held for research, and owner-versus-other-user RLS (22 vs 0 rows). The outbound worker returned HTTP 200 with `enabled:false`, `attempted:0`, `sent:0` when invoked with its private server token. Checked the claim RPC with no approved email destinations; it returned zero eligible messages. Live browser end-to-end and Resend deliverability remain untested.
