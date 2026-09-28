/* Accounts: one ADD DOTS account on the web, Windows, Android and iOS
   (Supabase Auth, email and password).

   Signing in is optional: everything works signed out, and documents never
   leave the device either way. What is here:
   - create an account (email and password), confirmed with a 6-digit code
     sent by email: a code, not a link, so it works the same in a browser and
     in the Windows and phone apps
   - sign in; an account not yet confirmed is sent a fresh code
   - forgot password: a code by email, then a new password
   - sign out
   - staying signed in: Supabase keeps the session in this app's storage and
     renews it; the next start picks it up

   The Supabase library (js/vendor/supabase.js) loads after the app has
   started, so it costs the first page nothing. Without a project configured
   (js/config.js) none of this shows. */
(function () {
  'use strict';

  var api = window.ADDPDF;
  var cfg = window.ADDDOTS_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var dlg = $('authDlg');
  if (!api || !dlg || !cfg.supabaseUrl || !cfg.supabaseKey) return;

  var client = null, user = null, email = '', view = 'signin', back = 'signin', busy = false, lastFocus = null;
  var app = document.querySelector('.app');

  var TITLES = {
    signin: ['Sign in', 'Use your ADD DOTS account on every device.'],
    signup: ['Create your account', 'One account for ADD DOTS PDF on the web, Windows, Android and iOS.'],
    verify: ['Check your email', ''],
    forgot: ['Reset your password', 'We will email you a code to set a new password.'],
    reset: ['Set a new password', ''],
    account: ['Your account', ''],
    delete: ['Delete your account', ''],
    privacy: ['Privacy policy', 'What ADD DOTS PDF keeps about you, where, and how to delete it.']
  };

  function health(where, e) {
    if (window.ADDPDF_HEALTH) window.ADDPDF_HEALTH.log('account', where + ': ' + String((e && e.message) || e));
  }

  /* ---------- the library, after start ---------- */
  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'js/vendor/supabase.js';
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('the account library did not load')); };
      document.head.appendChild(s);
    });
  }

  function start() {
    $('grpAccount').hidden = false;
    $('hAccount').hidden = false;
    $('hAcctTop').hidden = false;
    loadLib().then(function () {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          /* codes, not links: nothing to read from the address */
          detectSessionInUrl: false,
          storageKey: 'adpdf.auth'
        }
      });
      client.auth.onAuthStateChange(function (ev, session) {
        setUser(session ? session.user : null);
      });
      return client.auth.getSession();
    }).then(function (r) {
      setUser(r && r.data && r.data.session ? r.data.session.user : null);
    }).catch(function (e) {
      health('start', e);
      setUser(null);
    });
  }

  /* ---------- who is signed in, everywhere it shows ---------- */
  function setUser(u) {
    user = u || null;
    var name = user ? user.email : '';
    $('acctLbl').textContent = user ? name.charAt(0).toUpperCase() : 'Sign in';
    $('btnAccount').classList.toggle('in', !!user);
    $('btnAccount').setAttribute('aria-label', user ? 'Account: ' + name : 'Sign in');
    $('btnAccount').title = user ? 'Signed in as ' + name : 'Sign in to your ADD DOTS account';
    $('hAcctName').textContent = user ? name : 'Sign in';
    $('hAcctSub').textContent = user ? 'Signed in' : 'One account on every device';
    $('hAcctTopLbl').textContent = user ? name : 'Sign in';
    if (!dlg.hidden && view === 'account') show('account');
  }

  /* ---------- the dialog ---------- */
  function msg(text, kind) {
    var m = $('authMsg');
    m.hidden = !text;
    m.textContent = text || '';
    m.className = 'authmsg' + (kind ? ' ' + kind : '');
  }

  function show(v) {
    if (v === 'privacy' && view !== 'privacy') { back = view; policy(); }
    view = v;
    Array.prototype.forEach.call(dlg.querySelectorAll('[data-view]'), function (f) {
      f.hidden = f.getAttribute('data-view') !== v;
    });
    var t = TITLES[v];
    $('authTitle').textContent = t[0];
    var sub = t[1];
    if (v === 'verify') sub = 'Enter the code we sent to ' + email + '.';
    if (v === 'reset') sub = 'Enter the code we sent to ' + email + ', then your new password.';
    if (v === 'account') sub = user ? 'Signed in as ' + user.email : 'Not signed in.';
    if (v === 'delete') sub = user ? user.email : '';
    $('authSub').textContent = sub;
    msg('');
    /* the email typed on one form follows to the next */
    Array.prototype.forEach.call(dlg.querySelectorAll('input[type=email]'), function (i) {
      if (!i.value && email) i.value = email;
    });
    /* focus: the first field still empty, else the form's button */
    var form = dlg.querySelector('[data-view="' + v + '"]');
    var empty = form && Array.prototype.find.call(form.querySelectorAll('input'), function (i) { return !i.value; });
    var target = empty || (form && form.querySelector('button[type=submit], [tabindex="0"]'));
    if (target) setTimeout(function () { target.focus(); }, 0);
  }

  /* the policy is privacy.html's article (the same page the stores link to),
     shown in the dialog so reading it never leaves the open document */
  var policyLoaded = null;
  function policy() {
    if (policyLoaded) return;
    policyLoaded = fetch('privacy.html').then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.text();
    }).then(function (html) {
      var art = new DOMParser().parseFromString(html, 'text/html').getElementById('policy');
      if (!art) throw new Error('no policy in privacy.html');
      if (cfg.contactEmail) {
        var c = art.querySelector('[data-contact]');
        if (c) c.innerHTML = 'write to <a href="mailto:' + api.esc(cfg.contactEmail) + '">' + api.esc(cfg.contactEmail) + '</a>';
      }
      $('authPolicy').innerHTML = art.innerHTML;
    }).catch(function (e) {
      policyLoaded = null;
      health('privacy', e);
      $('authPolicy').textContent = 'The privacy policy could not be loaded. Check your connection and try again.';
    });
  }

  function open(v) {
    if (!client) { api.toast('Accounts are still loading. Try again in a moment.'); return; }
    lastFocus = document.activeElement;
    dlg.hidden = false;
    if (app) app.inert = true;
    show(v || (user ? 'account' : 'signin'));
  }
  function close() {
    if (dlg.hidden) return;
    dlg.hidden = true;
    if (app) app.inert = false;
    msg('');
    if (lastFocus && lastFocus.focus && lastFocus.isConnected) lastFocus.focus();
  }

  /* what Supabase says, in plain words */
  function friendly(e) {
    var code = (e && (e.code || e.error_code)) || '';
    var text = String((e && e.message) || e || '');
    var status = e && e.status;
    if (e instanceof TypeError || /fetch|network/i.test(text) && !status) {
      return 'Cannot reach the account service. Check your connection and try again.';
    }
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(text)) return 'That email and password do not match.';
    if (code === 'user_already_exists' || /already registered/i.test(text)) {
      return 'An account with this email already exists. Sign in instead.';
    }
    if (code === 'weak_password' || /password should be/i.test(text)) return 'Choose a longer password: at least 8 characters.';
    if (code === 'otp_expired' || /token has expired|invalid.*(otp|token)/i.test(text)) {
      return 'That code is wrong or has expired. Check the latest email, or send a new code.';
    }
    if (status === 429 || /rate limit|too many/i.test(text)) return 'Too many tries just now. Wait a minute, then try again.';
    if (code === 'validation_failed' || /invalid.*email|unable to validate email/i.test(text)) return 'Check the email address.';
    return text || 'Something went wrong. Try again.';
  }

  /* one request at a time, the button saying what it is doing */
  function run(form, label, fn) {
    if (busy) return;
    busy = true;
    var btn = form.querySelector('button[type=submit]');
    var was = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    msg('');
    Promise.resolve().then(fn).catch(function (e) {
      health(view, e);
      msg(friendly(e), 'bad');
    }).then(function () {
      busy = false;
      btn.disabled = false; btn.textContent = was;
    });
  }
  function ok(r) { if (r && r.error) throw r.error; return r ? r.data : null; }
  function val(form, name) { return (form.elements[name].value || '').trim(); }
  function code(form) { return val(form, 'code').replace(/\D/g, ''); }

  function signedIn(text) {
    close();
    api.toast(text);
  }

  var resendAt = 0;
  function resend() {
    var wait = Math.ceil((resendAt - Date.now()) / 1000);
    if (wait > 0) { msg('You can ask for another code in ' + wait + ' s.'); return; }
    resendAt = Date.now() + 60000;
    var p = view === 'reset'
      ? client.auth.resetPasswordForEmail(email)
      : client.auth.resend({ type: 'signup', email: email });
    p.then(ok).then(function () { msg('A new code is on its way to ' + email + '.', 'good'); },
      function (e) { resendAt = 0; health('resend', e); msg(friendly(e), 'bad'); });
  }

  var handlers = {
    signin: function (f) {
      email = val(f, 'email');
      run(f, 'Signing in…', function () {
        return client.auth.signInWithPassword({ email: email, password: f.elements.password.value }).then(function (r) {
          if (r.error && (r.error.code === 'email_not_confirmed' || /not confirmed/i.test(r.error.message))) {
            /* never confirmed: a fresh code, and the code form */
            return client.auth.resend({ type: 'signup', email: email }).then(function () {
              resendAt = Date.now() + 60000;
              show('verify');
              msg('Your email is not confirmed yet. We sent you a new code.', 'good');
            });
          }
          ok(r);
          f.reset();
          signedIn('Signed in as <b>' + api.esc(email) + '</b>');
        });
      });
    },
    signup: function (f) {
      email = val(f, 'email');
      var pw = f.elements.password.value;
      if (pw.length < 8) { msg('Choose a longer password: at least 8 characters.', 'bad'); return; }
      run(f, 'Creating account…', function () {
        return client.auth.signUp({ email: email, password: pw }).then(ok).then(function (d) {
          f.reset();
          if (d && d.session) { signedIn('Account created. You are signed in.'); return; }
          /* Supabase answers an existing, confirmed email with a user that
             has no identities, and sends nothing */
          if (d && d.user && d.user.identities && d.user.identities.length === 0) {
            show('signin');
            msg('An account with this email already exists. Sign in instead.', 'bad');
            return;
          }
          resendAt = Date.now() + 60000;
          show('verify');
        });
      });
    },
    verify: function (f) {
      var c = code(f);
      if (c.length < 6) { msg('Enter the code from the email: 6 digits.', 'bad'); return; }
      run(f, 'Checking…', function () {
        return client.auth.verifyOtp({ email: email, token: c, type: 'email' }).then(ok).then(function () {
          f.reset();
          signedIn('Email confirmed. You are signed in as <b>' + api.esc(email) + '</b>');
        });
      });
    },
    forgot: function (f) {
      email = val(f, 'email');
      run(f, 'Sending…', function () {
        return client.auth.resetPasswordForEmail(email).then(ok).then(function () {
          resendAt = Date.now() + 60000;
          show('reset');
        });
      });
    },
    reset: function (f) {
      var c = code(f), pw = f.elements.password.value;
      if (c.length < 6) { msg('Enter the code from the email: 6 digits.', 'bad'); return; }
      if (pw.length < 8) { msg('Choose a longer password: at least 8 characters.', 'bad'); return; }
      run(f, 'Saving…', function () {
        return client.auth.verifyOtp({ email: email, token: c, type: 'recovery' }).then(ok).then(function () {
          return client.auth.updateUser({ password: pw });
        }).then(ok).then(function () {
          f.reset();
          signedIn('Password changed. You are signed in.');
        });
      });
    },
    delete: function (f) {
      var pw = f.elements.password.value;
      if (!pw) { msg('Enter your password to confirm.', 'bad'); return; }
      var who = user && user.email;
      run(f, 'Deleting…', function () {
        /* the password proves it is the account's owner at this device, then
           the account deletes itself (delete_my_account: docs/accounts.md) */
        return client.auth.signInWithPassword({ email: who, password: pw }).then(ok).then(function () {
          return client.rpc('delete_my_account');
        }).then(ok).then(function () {
          f.reset();
          /* the session is gone with the account: forget it here */
          return client.auth.signOut({ scope: 'local' }).catch(function () {});
        }).then(function () {
          try { localStorage.removeItem('adpdf.auth'); } catch (e) {}
          setUser(null);
          close();
          api.toast('Your account <b>' + api.esc(who) + '</b> is deleted');
        });
      });
    },
    account: function (f) {
      run(f, 'Signing out…', function () {
        /* local: this device only; other devices stay signed in */
        return client.auth.signOut({ scope: 'local' }).then(function (r) {
          if (r && r.error) health('sign out', r.error);
          setUser(null);
          close();
          api.toast('Signed out');
        });
      });
    }
  };

  Array.prototype.forEach.call(dlg.querySelectorAll('form[data-view]'), function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      handlers[f.getAttribute('data-view')](f);
    });
  });
  dlg.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); show(go.getAttribute('data-go')); return; }
    if (e.target.closest('[data-resend]')) { e.preventDefault(); resend(); return; }
    if (e.target.closest('[data-back]')) { e.preventDefault(); show(back); return; }
    if (e.target === dlg) close();
  });
  $('authClose').addEventListener('click', close);
  dlg.addEventListener('keydown', function (e) {
    /* the dialog owns Escape; the app under it must not also act on it */
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  $('btnAccount').addEventListener('click', function () { open(); });
  $('hAcctBtn').addEventListener('click', function () { open(); });
  $('hAcctTop').addEventListener('click', function () { open(); });

  /* for the tests, and for the features that will need to know */
  api.account = {
    user: function () { return user ? { email: user.email, id: user.id } : null; },
    open: open,
    ready: function () { return !!client; }
  };

  api.on('ready', start);
})();
