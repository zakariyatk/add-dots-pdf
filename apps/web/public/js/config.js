/* Where the app's services are. The Supabase publishable key is meant to be
   in the app (it identifies the project; what it may do is decided by the
   project's own rules), so it lives here, not in a secret.

   Empty: accounts are off and the account button does not show. A test can
   set window.ADDDOTS_CONFIG before this runs. */
window.ADDDOTS_CONFIG = window.ADDDOTS_CONFIG || {
  supabaseUrl: '',
  supabaseKey: ''
};
