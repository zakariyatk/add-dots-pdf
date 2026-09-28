/* Where the app's services are. The Supabase publishable key is meant to be
   in the app (it identifies the project; what it may do is decided by the
   project's own rules), so it lives here, not in a secret.

   Emptied, accounts are off and the account button does not show. A test
   can set window.ADDDOTS_CONFIG before this runs. */
window.ADDDOTS_CONFIG = window.ADDDOTS_CONFIG || {
  /* Supabase project "add-dots-pdf" (organisation adddots, Mumbai) */
  supabaseUrl: 'https://jrdbuifhcxwyjxgyaowz.supabase.co',
  supabaseKey: 'sb_publishable_LD1GNGGp9Q9aHwcws71gRQ_C76ri7J9',
  /* the privacy policy's contact address (privacy.html); empty until the
     support address exists */
  contactEmail: '',
  /* the website the Windows and phone apps share documents through: share
     links point here, and its API is at <shareServer>api. The browser app
     uses wherever it is served from instead. */
  shareServer: 'https://app.adddots.com/'
};
