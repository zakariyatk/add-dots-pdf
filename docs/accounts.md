# Accounts (Stage I): Sign In / Sign Up with Supabase Auth

One ADD DOTS account on the web, Windows, Android and iOS. Signing in is
optional: everything works signed out, and documents stay on the device
either way.

## What the app does

`apps/web/public/js/account.js`, with the dialog in `index.html` and its
styles at the end of `css/app.css`:

- **Create an account**: email and password (at least 8 characters). Supabase
  emails a **6-digit code**; the app asks for it and the account is confirmed
  and signed in. A code, not a link, so it works the same in a browser and in
  the Windows and phone apps, with no links back into an app to set up.
- **Sign in**: email and password. An account not yet confirmed is sent a new
  code, and the app asks for it.
- **Forgot password**: a code by email, then a new password; the account is
  signed in.
- **Sign out**: this device only; other devices stay signed in.
- **Staying signed in**: Supabase keeps the session in the app's own storage
  (`adpdf.auth`) and renews it, in the browser and in the Windows and phone
  apps alike; the next start picks it up.
- **Same account everywhere**: every platform runs this same code against the
  same Supabase project.

Where it shows: "Sign in" on the home screen's side menu and in the toolbar;
signed in, the toolbar shows the account's initial. The Supabase library
(`js/vendor/supabase.js`) loads after the app has started, so the first page
costs nothing more. With no project configured (`js/config.js` empty) none of
it shows and the library is not loaded.

## The project

Supabase project **add-dots-pdf** (`jrdbuifhcxwyjxgyaowz`), organisation
adddots, region Mumbai (ap-south-1), free plan. Its address and publishable
key are in `apps/web/public/js/config.js`. Steps 2 to 4 below are still to be
done in the Supabase dashboard; until step 2 is done, sign-up emails carry a
link instead of the code the app asks for.

## Setting up the Supabase project

1. **The project's address and publishable key** go in
   `apps/web/public/js/config.js`. The publishable key is meant to ship in the
   app; it identifies the project, and what it may do is decided by the
   project's own settings.
2. **Email codes instead of links.** In the Supabase dashboard, Authentication
   > Emails > Templates:
   - **Confirm signup**: subject `Your ADD DOTS confirmation code`, body
     containing `{{ .Token }}`, for example:

     ```html
     <h2>Confirm your email</h2>
     <p>Enter this code in ADD DOTS PDF:</p>
     <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
     <p>If you did not create an ADD DOTS account, ignore this email.</p>
     ```

   - **Reset password**: subject `Your ADD DOTS password reset code`, same
     shape, with `{{ .Token }}`.
   - Leave out `{{ .ConfirmationURL }}`: the app uses the code only.
3. **Authentication > Providers > Email**: Email enabled, "Confirm email" on,
   minimum password length 8. Authentication > Settings: email OTP length 6,
   expiry 3600 s (the defaults).
4. **Sending email for real users.** Supabase's own mailer is for trying
   things out: it sends only a few emails an hour, and only to the project's
   team members. Before real people sign up, set a custom SMTP sender
   (Authentication > Emails > SMTP settings), for example from Resend,
   Postmark or Amazon SES, with an address on your domain
   (`no-reply@adddots.com`), and raise the email rate limit to match.

## Testing

The smoke test (`apps/web/bench/smoke.mjs`) runs the whole flow in Chrome
against a fake Supabase Auth served by the test itself: sign up with the
code (a wrong code refused), still signed in after a restart, sign out (still
out after a restart), a wrong password refused and the right one accepted,
forgot password with a code and a new password, an unconfirmed account sent a
new code, and nothing at all when no project is configured.

## Later

- Cloud features that use the account (sharing, syncing settings) will check
  the signed-in user through Supabase's row-level security.
- On phones the session can move from the app's storage to the system's
  secure storage (Keychain, Keystore) if needed.
- Sign in with Google, Microsoft or Apple can be added as Supabase providers.
