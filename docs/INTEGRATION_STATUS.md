# Offline Delete integration status
Updated 2026-11-27

## Implemented (beta)
- Authenticated accounts and customer-owned profile records.
- Registered guides for TruePeopleSearch, FastPeopleSearch, USPhoneBook, FamilyTreeNow, That's Them, SearchPeopleFree, AdvancedBackgroundChecks, CyberBackgroundChecks, Nuwber, Whitepages.
- One indexed discovery query per configured site via the Tavily API, not direct source scraping.
- Each source returns an independent outcome: indexed_checked, unable_to_check or manual_required.
- Search results are **possible matches** until a customer confirms them.
- Customers can add a link manually from the ten supported domains.
- Confirmed listings open a site-specific five-step removal guide, with saved progress.
- Removal submission is a customer report, never proof of broker compliance.
- Verification checks support customer reports and indexed rechecks. A missing search-index result cannot mark a listing Verified Removed.
- A subscription-gated Supabase Cron worker checks eligible monitoring schedules daily, and is currently dormant until an authorized paid subscription is active. It uses the same search credit budget as manual scans.
- In-app monitoring alerts can be created for new possible matches or potential resurfacing.

## Cost and security safeguards
- 750 reserved Tavily search credits per calendar month site-wide (conservative free-tier allowance).
- New user-initiated scan at most once every 24 hours.
- Indexed verification check at most once every 24 hours per removal.
- Manual listing capture limited to 100 findings per customer.
- Personal records use account-restricted Supabase RLS. Authenticated customers cannot enroll themselves into paid monitoring.
- Cron worker checks a high-entropy job token and only operates on enabled schedules with active subscription entitlement.
- No paid APIs, SMTP services, or billing integration introduced.

## Pending before a public paid launch
- Confirm every current opt-out URL and site-specific form flow by manual acceptance tests.
- Obtain or verify permitted source-specific automated access before upgrading any connector beyond indexed discovery.
- Connect a billing provider and trusted subscription webhook to enable monitoring entitlements.
- Establish provider confirmation or permitted direct verification before labeling removals Verified Removed.
- Configure an authorized email sender if email notifications are desired; current notifications are in-app only.
- Run end-to-end browser tests with consenting test profiles, across desktop and mobile.
- Review password-security settings, privacy policy, storage encryption strategy and retention controls.

## Notes
- A completed indexed search is NOT a full search of a data broker's database.
- Search engine and index limitations should always be reflected in displayed status.
- No automated broker opt-out submissions are active; the hybrid removal workflow remains guided for these ten websites.
