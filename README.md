# Gestione Provvigioni Planet Windows

Published at https://provvigioni.planetwindows.it/ through the existing GitHub Pages site.

The original logo, favicon, layout and commission formula are retained. Each agent
uses a personal username/password and accesses only their own practices. Ufficio
can manage all practices, commission rules and agent accounts. Passwords are stored
by Supabase Auth and are never committed to this repository.

The app uses the existing Planet Windows Supabase project with separate
`provvigioni_accounts`, `provvigioni_practices` and `provvigioni_rules` tables. RLS
checks the live account, role and session. Resetting or deleting access invalidates
the old session for commission data. Agent accounts receive no PW Posa profile.

The old browser data keys remain intact. Ufficio can recover them using
**Recupera dati del dispositivo**. Backup import merges records by practice code
and keeps other online practices. Updates use a version check to avoid overwriting
another device's changes.

The database migration and `provvigioni-admin` Edge Function are included in
`supabase/`. The function requires JWT validation and checks the Ufficio account
again before creating, resetting or deleting an agent's access. Server credentials
come from the function environment. Only the project's publishable key is used
in the browser.

Verification scripts in `tests/` take a private credentials JSON outside the
repository. `verify_access.py` checks server permissions using temporary records.
`verify_ui.cjs` checks login, recovery, editing, backups and account management
with Playwright. Both remove their temporary practices and Auth users; any
remaining inactive test-account labels can be removed through an authorized
database maintenance operation. Do not commit credentials or test downloads.
