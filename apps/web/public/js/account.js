/* Accounts: one ADD DOTS account on the web, Windows, Android and iOS
   (Supabase Auth: email and password, and on the website Google and Apple).

   An account is free, with every tool. With requireSignIn: 'save'
   (js/config.js) the app is open to everyone, and saving a file asks for an
   account first, as Acrobat online does; with requireSignIn: true the app
   opens to Sign in / Create account and nothing else until one is signed in.
   A device that has signed in once stays signed in, offline as well.
   Documents never leave the device either way. What is here:
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
  /* the sign-in page the app waits behind (js/config.js requireSignIn) */
  var GATE = cfg.requireSignIn === true;
  var gated = false;
  /* requireSignIn: 'save': no Sign in button anywhere while signed out; the
     popup a save opens is the only way in. Signed in, the account shows. */
  var ON_SAVE = cfg.requireSignIn === 'save';
  /* saves waiting for an account (requireSignIn: 'save'): each resolves
     true once one is signed in, false if the popup is closed */
  var waiting = [];
  var started, startedP = new Promise(function (r) { started = r; });

  var TITLES = {
    signin: ['Sign in', 'Use your ADD DOTS account on every device.'],
    gate: ['Sign in to ADD DOTS PDF', 'Free. One account for the web, Windows, Android and iOS.'],
    signup: ['Create your account', 'One account for ADD DOTS PDF on the web, Windows, Android and iOS.'],
    /* the popup a save opens (requireSignIn: 'save') */
    saveSignin: ['Sign in to save', 'Welcome back. Your PDF saves as soon as you are signed in.'],
    saveSignup: ['Create your free account', 'Sign up free to save your PDF. It takes a minute.'],
    verify: ['Check your email', ''],
    forgot: ['Reset your password', 'We will email you a code to set a new password.'],
    reset: ['Set a new password', ''],
    newpw: ['Set a new password', ''],
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

  /* The emails carry a 6-digit code once the project has its own sender
     (docs/accounts.md); until then Supabase's own emails carry a link. The
     link opens the website (the project's Site URL) signed in: a sign-up is
     confirmed, and a password reset asks for the new password there. The
     Windows and phone apps are not the website: there the link confirms the
     account in the browser, and the app signs in with the password. */
  var IN_APP = !!window.__TAURI__ ||
    !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var link = (function () {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (IN_APP || !(h.get('access_token') || h.get('error_description'))) return null;
    return { type: h.get('type') || '', error: h.get('error_description') || '' };
  })();

  /* a sign-in kept on this device from before: the app opens straight away,
     offline too, and Supabase renews it when it can */
  function stored() {
    try { return !!localStorage.getItem('adpdf.auth'); } catch (e) { return false; }
  }

  function buttons() {
    var off = ON_SAVE && !user;
    $('grpAccount').hidden = off;
    $('hAccount').hidden = off;
    $('hAcctTop').hidden = off;
  }

  function start() {
    buttons();
    /* nothing kept: the sign-in page at once, before the library is in */
    if (GATE && !stored() && !link) gate();
    loadLib().then(function () {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          /* a link from one of the emails (above): the website only */
          detectSessionInUrl: !!link,
          storageKey: 'adpdf.auth'
        }
      });
      client.auth.onAuthStateChange(function (ev, session) {
        setUser(session ? session.user : null);
        /* signed out here or elsewhere (a password changed, the account
           deleted): back to the sign-in page */
        if (ev === 'SIGNED_OUT' && GATE) setTimeout(gate, 0);
        /* the reset link: signed in for this, the new password next */
        if (ev === 'PASSWORD_RECOVERY') { if (link) link.type = 'recovery'; setTimeout(function () { open('newpw'); }, 0); }
      });
      return client.auth.getSession();
    }).then(function (r) {
      setUser(r && r.data && r.data.session ? r.data.session.user : null);
      if (link) linkDone();
      if (GATE && !user) gate();
      providers();
      started();
    }).catch(function (e) {
      health('start', e);
      setUser(null);
      if (GATE) { gate(); msg('Cannot reach the account service. Check your connection, then reload.', 'bad'); }
      started();
    });
  }

  /* ---------- saving asks for an account (requireSignIn: 'save') ----------
     Resolves true when the save may go ahead: signed in already, or signed
     in (or signed up) in the popup it opens; false when the popup is
     closed. Read at the time of the save, so a test can turn it off. The
     account service out of reach (offline, never signed in here) never
     holds a document back: the save goes ahead. */
  function need() {
    if ((window.ADDDOTS_CONFIG || cfg).requireSignIn !== 'save' || user) return Promise.resolve(true);
    return startedP.then(function () {
      if (user || !client) return true;
      return new Promise(function (res) {
        waiting.push(res);
        if (waiting.length === 1) {
          dlg.classList.add('save');
          open('signup');
        }
      });
    });
  }
  function settle(ok) {
    var w = waiting;
    waiting = [];
    dlg.classList.remove('save');
    w.forEach(function (res) { res(ok); });
  }

  /* the app waits behind the sign-in page: it cannot be closed, only
     signed in through (or an account created) */
  function gate() {
    if (!GATE || user) return;
    gated = true;
    dlg.classList.add('gate');
    if (dlg.hidden) {
      lastFocus = document.activeElement;
      dlg.hidden = false;
    }
    if (app) app.inert = true;
    if (['signin', 'signup', 'verify', 'forgot', 'reset', 'privacy'].indexOf(view) < 0 || !dlg.dataset.shown) show('signin');
    dlg.dataset.shown = '1';
  }
  function ungate() {
    gated = false;
    dlg.classList.remove('gate');
    delete dlg.dataset.shown;
  }

  /* Google and Apple, on the website, once the project has them on: the
     project says which (/auth/v1/settings). The Windows and phone apps sign
     in with email: a provider's page cannot hand the session back to them. */
  function providers() {
    if (IN_APP || !window.fetch) return;
    fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/auth/v1/settings', { headers: { apikey: cfg.supabaseKey } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (st) {
        var ext = (st && st.external) || {};
        Array.prototype.forEach.call(dlg.querySelectorAll('[data-sso]'), function (box) {
          var any = false;
          Array.prototype.forEach.call(box.querySelectorAll('[data-provider]'), function (b) {
            b.hidden = !ext[b.getAttribute('data-provider')];
            any = any || !b.hidden;
          });
          box.hidden = !any;
        });
      })
      .catch(function () { /* offline: email only */ });
  }
  function withProvider(p) {
    if (!client || busy) return;
    busy = true;
    msg('Opening ' + (p === 'google' ? 'Google' : 'Apple') + '…', 'good');
    /* the provider's page replaces this one: a document waiting to be saved
       is kept first, and offered again on the way back (crash recovery) */
    var keep = waiting.length && api.recoverNow ? Promise.resolve(api.recoverNow()).catch(function () {}) : Promise.resolve();
    keep.then(function () {
      /* back to this page, where the session in the address signs in */
      return client.auth.signInWithOAuth({ provider: p, options: { redirectTo: location.origin + location.pathname } });
    })
      .then(function (r) {
        busy = false;
        if (r && r.error) { health('oauth ' + p, r.error); msg(friendly(r.error), 'bad'); }
      }, function (e) { busy = false; health('oauth ' + p, e); msg(friendly(e), 'bad'); });
  }

  /* what a link from an email did, said once */
  function linkDone() {
    if (link.error) {
      api.toast(/expired|invalid/i.test(link.error)
        ? 'That email link has expired or was already used. Sign in, or ask for a new email.'
        : 'That email link did not work: ' + api.esc(link.error));
    } else if (link.type !== 'recovery' && user) {
      api.toast((link.type === 'signup' || link.type === 'email' ? 'Email confirmed. ' : '') +
        'You are signed in as <b>' + api.esc(user.email) + '</b>');
    }
  }

  /* signed in with Google or Apple rather than an email and password */
  function viaProvider() {
    var p = user && user.app_metadata && user.app_metadata.provider;
    return !!p && p !== 'email';
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
    buttons();
    /* the home screen greets the account by name */
    if (api.refreshHello) api.refreshHello();
    if (!dlg.hidden && view === 'account') show('account');
    /* signed in some other way while a save waits (an email's link, in
       another tab): the save goes ahead */
    if (user && waiting.length) { settle(true); close(); }
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
    var saving = waiting.length > 0;
    var t = TITLES[gated && v === 'signin' ? 'gate'
      : saving && v === 'signin' ? 'saveSignin'
        : saving && v === 'signup' ? 'saveSignup' : v];
    $('authTitle').textContent = t[0];
    var sub = t[1];
    if (v === 'verify') sub = 'Enter the code we sent to ' + email + '.';
    if (v === 'reset') sub = 'Enter the code we sent to ' + email + ', then your new password.';
    if (v === 'newpw') sub = user ? 'For ' + user.email + '.' : '';
    if (v === 'account') sub = user ? 'Signed in as ' + user.email : 'Not signed in.';
    if (v === 'delete') {
      sub = user ? user.email : '';
      /* an account made with Google or Apple has no password: its email confirms */
      var byEmail = viaProvider();
      $('aDePw').type = byEmail ? 'email' : 'password';
      $('aDePw').autocomplete = byEmail ? 'off' : 'current-password';
      $('aDePw').value = '';
      dlg.querySelector('label[for="aDePw"]').textContent = byEmail ? 'Type your email to confirm' : 'Password';
    }
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
    /* the sign-in page stays until an account is signed in */
    if (gated && !user) return;
    if (gated) ungate();
    /* a save waiting for an account: closed without one, it does not happen */
    if (waiting.length) settle(!!user);
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
    if (!client) { msg('Connecting to the account service…', 'good'); return; }
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
    /* signed in: the sign-in page lets the app go, and a waiting save goes ahead */
    if (gated) ungate();
    if (waiting.length) settle(true);
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
      var who = user && user.email;
      var byEmail = viaProvider();
      if (!pw) { msg(byEmail ? 'Type your email to confirm.' : 'Enter your password to confirm.', 'bad'); return; }
      if (byEmail && pw.trim().toLowerCase() !== String(who).toLowerCase()) {
        msg('That is not this account\'s email.', 'bad');
        return;
      }
      run(f, 'Deleting…', function () {
        /* the password proves it is the account's owner at this device (an
           account from Google or Apple: its session and its email typed),
           then the account deletes itself (delete_my_account: docs/accounts.md) */
        var proof = byEmail
          ? Promise.resolve()
          : client.auth.signInWithPassword({ email: who, password: pw }).then(ok);
        return proof.then(function () {
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
          if (GATE) gate();
        });
      });
    },
    newpw: function (f) {
      var pw = f.elements.password.value;
      if (pw.length < 8) { msg('Choose a longer password: at least 8 characters.', 'bad'); return; }
      run(f, 'Saving…', function () {
        return client.auth.updateUser({ password: pw }).then(ok).then(function () {
          f.reset();
          signedIn('Password changed. You are signed in.');
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
          if (GATE) gate();
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
    var prov = e.target.closest('[data-provider]');
    if (prov) { e.preventDefault(); withProvider(prov.getAttribute('data-provider')); return; }
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
    user: function () { return user ? { email: user.email, id: user.id, provider: viaProvider() ? user.app_metadata.provider : 'email' } : null; },
    /* the app is waiting behind the sign-in page */
    gated: function () { return gated; },
    /* before a file is saved (js/core.js download) */
    need: need,
    open: open,
    ready: function () { return !!client; }
  };

  api.on('ready', start);
})();
