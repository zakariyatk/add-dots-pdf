/* Where the app's services are. The Supabase publishable key is meant to be
   in the app (it identifies the project; what it may do is decided by the
   project's own rules), so it lives here, not in a secret.

   Emptied, accounts are off and the account button does not show. A test
   can set window.ADDDOTS_CONFIG before this runs: what it sets wins, the
   rest comes from here. */
window.ADDDOTS_CONFIG = Object.assign({
  /* Sign in and Share are not in the app for now (they come back as a
     feature later, with js/account.js and js/share.js from git history), so
     nothing reads these settings yet. For accounts, the Supabase project is
     "add-dots-pdf" (organisation adddots, Mumbai):
       supabaseUrl: 'https://jrdbuifhcxwyjxgyaowz.supabase.co',
       supabaseKey: 'sb_publishable_LD1GNGGp9Q9aHwcws71gRQ_C76ri7J9', */
  supabaseUrl: '',
  supabaseKey: '',
  /* the privacy policy's contact address (privacy.html); empty until the
     support address exists */
  contactEmail: '',
  /* the website the Windows and phone apps share documents through: share
     links point here, and its API is at <shareServer>api. The browser app
     uses wherever it is served from instead. */
  shareServer: 'https://pdf.adddots.com/',
  /* when an account is asked for (it is free, with every tool):
     'save'  every tool works without one; saving a file (Save, extract,
             convert, export) asks to sign in or create a free account first,
             and no Sign in button shows until then
     true    the app opens to Sign in / Create account, and nothing else,
             until an account is signed in
     false   never; signing in is optional
     Continue with Google and Continue with Apple show on the website once
     the project has them turned on (docs/accounts.md). */
  requireSignIn: false
}, window.ADDDOTS_CONFIG || {});
