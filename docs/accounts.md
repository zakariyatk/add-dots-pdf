# Accounts (Stage I): Sign In / Sign Up with Supabase Auth

One Add Dots account on the web, Windows, Android and iOS. An account is
free, with every tool. **Saving asks for one**: everyone can open and edit
PDFs with every tool, and saving a file asks to sign in or create a free
account first, as Acrobat online does. Documents still stay on the device.

## When an account is asked for (`requireSignIn`)

`requireSignIn` in `apps/web/public/js/config.js` is one of:

- `'save'` (the default): nothing asks for an account until a file is saved,
  and no Sign in button shows on the home screen or the toolbar while signed
  out (signed in, the account button shows, for the account and Sign out).
  Save, and every other way a file comes out of the app (extracting pages,
  converting, compressing, exporting images or text), first opens a popup:
  "Your PDF is ready to save", what a free account gives (every tool, no
  payment, no card, no trial) beside Create your free account, with Sign in,
  Continue with Google and Continue with Apple. Signed in or signed up, the
  save goes ahead by itself; closed, nothing is saved and the document stays
  open as it was. A device already signed in saves straight away. With the
  account service out of reach (offline, never signed in on this device),
  the save goes ahead rather than hold the document back. Continue with
  Google or Apple leaves the page for the provider's: the document is kept
  first, and offered again (crash recovery) on the way back.
- `true`: the app opens behind a sign-in page, below.
- `false`: signing in is optional.

With `requireSignIn: true`:

- With no sign-in kept on this device, the app starts behind a full-screen
  sign-in page: Sign in, Create account, Forgot password and the privacy
  policy. It cannot be closed (no close button, Escape and clicks outside do
  nothing), and the app under it is inert. A shared review link waits behind
  it too.
- A device that has signed in before opens straight away, offline as well;
  Supabase renews the session when it can.
- Signing out, deleting the account, or the session ending elsewhere (a
  password changed on another device) brings the sign-in page back.
- On a phone's first run the welcome pages come first, then the sign-in page.

## Continue with Google and Continue with Apple

On the website, the sign-in page and Create account show **Continue with
Google** and **Continue with Apple** for each provider the Supabase project
has turned on. The app asks the project which are on
(`/auth/v1/settings`), so a provider appears the moment it is enabled, with
no new release. Signing in with one opens the provider's page and comes back
to the website signed in; a new person gets a free account the same way.

In the Windows and phone apps the buttons stay hidden for now: the
provider's page opens in a browser that cannot hand the session back to the
app without an app link (a custom URL scheme or universal link), which is
the next step (below). There people sign in with email.

### Turning on Google

1. Google Cloud Console > APIs & Services > Credentials > Create
   credentials > **OAuth client ID** > Web application.
2. Authorised redirect URI:
   `https://jrdbuifhcxwyjxgyaowz.supabase.co/auth/v1/callback`
3. OAuth consent screen: app name "Add Dots PDF", support email, the
   privacy policy link (`https://pdf.adddots.com/privacy.html`), and publish
   it.
4. Supabase dashboard > Authentication > Sign In / Providers > **Google**:
   turn on, paste the Client ID and Client Secret, save.
5. Supabase > Authentication > URL Configuration: Site URL
   `https://pdf.adddots.com/`, and add it and the test site,
   `https://staging.adddots.com/`, to the Redirect URLs (without the test
   site there, signing in on it comes back to the live site).

### Turning on Apple

1. Apple Developer (a paid membership) > Certificates, Identifiers &
   Profiles: an **App ID** with "Sign in with Apple", then a **Services ID**
   (e.g. `com.adddots.pdf.web`) with Sign in with Apple configured for the
   domain `jrdbuifhcxwyjxgyaowz.supabase.co` and the return URL
   `https://jrdbuifhcxwyjxgyaowz.supabase.co/auth/v1/callback`.
2. Keys > a new key with Sign in with Apple; download the `.p8` file and
   note the Key ID and your Team ID.
3. Supabase > Authentication > Sign In / Providers > **Apple**: turn on,
   the Services ID as Client ID, and the secret made from the `.p8` key
   (the Supabase page links the generator; it expires every 6 months).

Apple's App Store rule 4.8: an iPhone app that offers Google sign-in must
also offer Sign in with Apple. The iPhone app shows neither for now (email
only), so it is within the rule; when the app links arrive, both come
together.

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
- **Links as well as codes.** Supabase lets a project edit its email
  templates only once it has its own email sender (custom SMTP, step 4
  below); until then its emails carry a link, not a code. The app works
  with both. On the website, the confirm link opens it signed in, and the
  reset link opens "Set a new password". In the Windows and phone apps, the
  link opens the website (the project's Site URL) and confirms the account
  there; the app then signs in with the password. The dialog says so under
  the code field.
- **Sign out**: this device only; other devices stay signed in.
- **Delete account** (Your account > Delete account…): the password again,
  then the account is deleted for good, with its sign-ins on every device;
  documents on the devices are not touched. The App Store and Google Play
  both require this in any app that lets people create an account.
- **Privacy policy**: `apps/web/public/privacy.html`, a page of its own (the
  address to give the App Store and Google Play), also shown inside the
  dialog from Create account and Your account, so reading it never leaves
  the open document. Its contact line uses `contactEmail` in `js/config.js`
  once a support address exists.
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

## Deleting an account: the database function

Supabase does not let an app delete its own users with the publishable key.
`supabase/migrations/20260928200000_delete_my_account.sql` adds
`public.delete_my_account()`: callable only by a signed-in user (not the
anonymous key), it deletes that user's own row in `auth.users`
(`auth.uid()`), and Supabase removes their sessions and identities with it.
It is applied to the project. Supabase's security advisor lists it as a
"security definer function signed-in users can call": that is its purpose,
and it can only ever reach the caller's own account.

## Setting up the Supabase project

1. **The project's address and publishable key** go in
   `apps/web/public/js/config.js`. The publishable key is meant to ship in the
   app; it identifies the project, and what it may do is decided by the
   project's own settings.
2. **Email codes instead of links** (needs step 4 first: without a custom
   SMTP sender Supabase shows the templates read-only). In the Supabase
   dashboard, Authentication > Emails > Templates:
   - **Confirm signup**: subject `Your Add Dots confirmation code`, body
     containing `{{ .Token }}`, for example:

     ```html
     <h2>Confirm your email</h2>
     <p>Enter this code in Add Dots PDF:</p>
     <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
     <p>If you did not create an Add Dots account, ignore this email.</p>
     ```

   - **Reset password**: subject `Your Add Dots password reset code`, same
     shape, with `{{ .Token }}`.
   - Leave out `{{ .ConfirmationURL }}`: the app uses the code only.
3. **Authentication > Sign In / Providers > Email**: Email enabled,
   "Confirm email" on, minimum password length 8. **Authentication > URL
   Configuration**: Site URL `https://pdf.adddots.com`, where the links in
   the emails lead; add `https://staging.adddots.com/**` to the Redirect
   URLs for the test site. Authentication > Settings: email OTP length 6,
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
new code, the privacy policy in the dialog (Back returns to the form as it
was), Delete account (a wrong password keeps the account; the right one
deletes it, signs out, and it cannot sign in again), and nothing at all when
no project is configured. And the sign-in page itself, as shipped
(`requireSignIn`): it opens with the app inert behind it, Escape and clicks
outside do not close it, Continue with Google shows when the project has
Google on (and Apple does not when it is off), signing in lets the app
through, signing out brings the page back, and Continue with Google goes to
the project's Google sign-in with this page as the way back. And sign-in when
saving (`requireSignIn: 'save'`): the app opens with no sign-in, Save opens
the free-account popup, closing it saves nothing, and signing in saves the
PDF. The other checks run with sign-in not required.

## Later

- Cloud features that use the account (sharing, syncing settings) will check
  the signed-in user through Supabase's row-level security.
- On phones the session can move from the app's storage to the system's
  secure storage (Keychain, Keystore) if needed.
- Google and Apple inside the Windows and phone apps: an app link
  (`com.adddots.pdf://auth`, or a universal link on `pdf.adddots.com`) that
  the provider's page returns to, with the Capacitor App plugin and Tauri's
  deep-link plugin handing the session to the app.
- Microsoft sign-in, the same way, if wanted.
