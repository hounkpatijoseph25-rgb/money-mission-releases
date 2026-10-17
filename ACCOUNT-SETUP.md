# SteadyPath accounts

The web app uses Supabase Auth and private, versioned budget snapshots. Existing budgeting code and backup format identifiers are preserved. User caches are partitioned by Supabase user ID. Guest data only imports when requested. Concurrent edits require an explicit choice; cloud data never silently overwrites pending local edits.

## Required dashboard configuration

In Supabase project `hoalgldxzrbaydeplcqp`:

1. Authentication → URL Configuration: set Site URL to `https://peterzossou-coder.github.io/money-mission-releases/app/` and add this exact URL to Redirect URLs. Confirmation and recovery emails need this allowed destination.
2. Authentication → Email: configure an SMTP provider before inviting other users. Supabase's built-in mail service restricts delivery and is not intended for production.
3. Authentication → Phone: configure an SMS provider and enable phone authentication, keeping phone confirmation enabled. The app reads the public settings and enables its phone option only when the provider is enabled. SMS credentials belong in the Supabase dashboard, never in this repository.

Only a publishable key is bundled. Database rules enforce `auth.uid() = user_id`. No email address grants administrative access. No bank connection, Plaid approval or payment processing is implemented by this change.

## Development

`npm ci && npm run build && npm test`

`tests/browser.e2e.mjs` also verifies sign-in, sign-out, account switching, guest isolation, conflict choices, backups and mobile layout with a fully mocked backend. Run it with Playwright installed (or set `PLAYWRIGHT_MODULE` to its module path); optionally set `CHROMIUM_PATH` to a browser executable. It never sends email/SMS or creates real users.

`source/` was recovered from the existing deployed source map. Existing compiled CSS is retained, because the original CSS source was not included in this release repository. `source/main.ts` loads the existing budgeting enhancements and the new account adapter; obsolete Laravel account/sync modules are no longer imported.

`database/schema.sql` is the applied database schema; `database/verify.sql` checks row isolation and conflict rejection in a transaction that rolls back all test fixtures.

The existing Android release APK and earlier Mac/iPhone bundles are separate versions and are not rebuilt by the web deployment. Users can use the web app on all of those devices. Export a backup from the old GitHub Pages origin before moving local data to the new origin; browser storage does not move with a repository transfer.
