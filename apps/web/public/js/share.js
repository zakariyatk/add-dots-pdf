/* ADD DOTS PDF — Share & review
   -----------------------------
   Puts a document on the server, hands out links, and syncs review comments
   between everyone holding one.

   Two kinds of link, and no accounts at all:

     owner link   ?d=<id>#k=<owner token>   full control, manages the shares
     share link   ?s=<share token>          view, comment or edit

   The token lives in the URL fragment for the owner link, so it is never sent
   to the server in a Referer header or written into an access log. A reviewer's
   remarks are stored as comments with their own geometry, never merged into the
   owner's document, so two people commenting at once cannot overwrite anything. */
(function () {
  'use strict';

  const X = window.ADDPDF;
  if (!X) { console.error('[share] core bridge missing'); return; }

  /* Where the app's website is: the address share links point to, with the
     API under it. In a browser, wherever the app is served from. The Windows
     and phone apps are not served from the web, so they use the address in
     js/config.js (shareServer), which is read when first needed: config.js
     loads after this file. */
  const IN_APP = !!window.__TAURI__ ||
    !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function site() {
    const cfg = window.ADDDOTS_CONFIG || {};
    if (IN_APP && cfg.shareServer) return cfg.shareServer.replace(/\/?$/, '/');
    return location.origin + location.pathname.replace(/[^/]*$/, '');
  }
  function apiBase() {
    return IN_APP ? site() + 'api' : location.pathname.replace(/[^/]*$/, '') + 'api';
  }

  X.on('ready', function () {
    const S = X.S, $ = X.$;

    /* ---------------- session ---------------- */

    const session = {
      id: null,            // document public id
      token: null,         // whichever token we hold
      role: null,          // owner | edit | comment | view
      version: 0,
      canDownload: true,
      password: null,      // for a password-protected share
      comments: new Map(), // id -> comment
      since: null,
      poll: null,
      dirty: false
    };

    /* A per-browser key so a guest can edit and delete their own remarks
       without an account. It identifies a browser, not a person. */
    function authorKey() {
      let k = null;
      try { k = localStorage.getItem('adddots.authorKey'); } catch (e) {}
      if (!k) {
        k = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        try { localStorage.setItem('adddots.authorKey', k); } catch (e) {}
      }
      return k;
    }

    function authorName(fallback) {
      let n = null;
      try { n = localStorage.getItem('adddots.authorName'); } catch (e) {}
      return n || fallback || 'Guest';
    }
    function setAuthorName(n) {
      try { localStorage.setItem('adddots.authorName', n); } catch (e) {}
    }

    /* ---------------- talking to the API ---------------- */

    async function api(path, opts) {
      opts = opts || {};
      const headers = Object.assign({ 'X-Author-Key': authorKey() }, opts.headers || {});
      if (session.token) headers.Authorization = 'Bearer ' + session.token;
      if (session.password) headers['X-Share-Password'] = session.password;
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.json);
      }
      /* Some shared hosts drop PATCH and DELETE, so tunnel them. */
      let method = opts.method || 'GET';
      if (method === 'PATCH' || method === 'DELETE' || method === 'PUT') {
        headers['X-HTTP-Method-Override'] = method;
        method = 'POST';
      }

      let res;
      try {
        res = await fetch(apiBase() + '/' + path, {
          method: method, headers: headers, body: opts.body, cache: 'no-store'
        });
      } catch (e) {
        throw new Error('The server could not be reached. Check your connection.');
      }
      if (res.status === 204) return null;

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) {
        /* A PHP fatal or an HTML error page — say so rather than "unexpected token". */
        throw new Error('The server returned something unexpected. Check api/setup.php has been run.');
      }
      if (!res.ok) {
        const err = new Error((data && data.message) || 'That did not work.');
        err.code = data && data.error;
        err.status = res.status;
        throw err;
      }
      return data;
    }

    /* ---------------- ribbon button ---------------- */

    const grpSave = $('grpSave');
    const btnShare = document.createElement('button');
    btnShare.className = 'btn'; btnShare.id = 'btnShare';
    btnShare.title = 'Share this document for review';
    btnShare.dataset.label = 'Share';
    btnShare.innerHTML =
      '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
      '<circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/>' +
      '<line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg><span class="lbl">Share</span>';
    /* Share sits in a group of its own so that on a phone it can ride into the
       more-sheet: the top bar there only has room for what is used every time,
       and Save is that; Share is not. */
    const grpShare = document.createElement('div');
    grpShare.className = 'grp'; grpShare.id = 'grpShare';
    grpShare.appendChild(btnShare);
    $('bar').insertBefore(grpShare, grpSave);
    if (X.mobileSheet) X.mobileSheet(grpShare);
    btnShare.addEventListener('click', openShare);

    /* a small badge in the top bar once a document is live on the server */
    const live = document.createElement('span');
    live.className = 'livebadge'; live.id = 'liveBadge'; live.hidden = true;
    $('bar').insertBefore(live, grpSave);

    function setLive(text, tone) {
      live.hidden = !text;
      live.textContent = text || '';
      live.dataset.tone = tone || '';
    }

    /* ---------------- share dialog ---------------- */

    const dlg = document.createElement('div');
    dlg.className = 'sharemodal'; dlg.id = 'shareModal'; dlg.hidden = true;
    dlg.innerHTML =
      '<div class="sharebox" role="dialog" aria-modal="true" aria-label="Share">' +
      '<header><b id="shTitle">Share for review</b><span class="grow"></span>' +
      '<button class="x" id="shClose" aria-label="Close">&times;</button></header>' +
      '<div class="sharebody" id="shBody"></div>' +
      '</div>';
    document.body.appendChild(dlg);
    $('shClose').addEventListener('click', closeShare);
    dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) closeShare(); });

    function closeShare() { dlg.hidden = true; }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dlg.hidden) { e.preventDefault(); closeShare(); }
    });

    function openShare() {
      if (!S.items.length) { X.toast('Open a PDF first'); return; }
      if (!dlg.hidden) { closeShare(); return; }    /* the button toggles */
      dlg.hidden = false;
      if (!session.id) paintUpload();
      else paintManage();
    }

    function paintUpload() {
      $('shTitle').textContent = 'Share for review';
      $('shBody').innerHTML =
        '<p class="shnote">The PDF and your marks are copied to your own server. ' +
        'You get a private owner link and as many review links as you need.</p>' +
        '<label class="drow"><span>Title</span><input id="shName" maxlength="200"></label>' +
        '<p class="shnote small" id="shSize"></p>' +
        '<div class="shacts"><button class="btn" id="shCancel">Cancel</button>' +
        '<button class="btn primary" id="shGo">Put on the server</button></div>' +
        '<p class="shwarn" id="shErr" hidden></p>';
      $('shName').value = S.baseName || 'Untitled document';
      $('shCancel').addEventListener('click', closeShare);
      $('shGo').addEventListener('click', doUpload);
      sizeHint();
    }

    async function sizeHint() {
      try {
        const h = await fetch(apiBase() + '/health', { cache: 'no-store' });
        const j = await h.json();
        const mb = Math.round((j.max_upload || 0) / 1048576);
        $('shSize').textContent = mb
          ? 'Up to ' + mb + ' MB per document.'
          : '';
      } catch (e) {
        $('shSize').innerHTML = IN_APP
          ? '<span class="bad">The share server did not answer. Check your connection and try again.</span>'
          : '<span class="bad">The API did not answer. Upload <b>api/</b> to your host and open ' +
            '<b>api/setup.php</b> once.</span>';
      }
    }

    /* Everything the owner has done, in one object the server just stores. */
    function collectState() {
      return {
        v: 1,
        baseName: S.baseName,
        pages: S.items.map(function (it) {
          return {
            num: it.num, rot: it.rot, added: it.added,
            crop: it.crop || null,
            shapes: it.shapes.map(function (s) { return s; })
          };
        })
      };
    }

    async function doUpload() {
      const go = $('shGo'), err = $('shErr');
      err.hidden = true;
      go.disabled = true; go.textContent = 'Building…';
      try {
        /* Send the document as the reader sees it now — marks baked in — so a
           reviewer opens exactly what the owner is looking at. */
        const bytes = await X.buildPdf(S.items, null, {});
        go.textContent = 'Uploading…';

        const fd = new FormData();
        fd.append('file', new Blob([bytes], { type: 'application/pdf' }),
                  (S.baseName || 'document') + '.pdf');
        fd.append('title', $('shName').value.trim() || 'Untitled document');
        fd.append('page_count', String(S.items.length));
        fd.append('state', JSON.stringify(collectState()));

        session.token = null;                       // creating needs no token
        const res = await api('documents', { method: 'POST', body: fd });

        session.id = res.id;
        session.token = res.owner_token;
        session.role = 'owner';
        session.version = res.version;
        session.canDownload = true;

        rememberOwned(res);
        history.replaceState(null, '', ownerUrl(res.id, res.owner_token));
        setLive('Shared', 'ok');
        startPolling();
        paintManage();
        X.toast('This document is on your server');
      } catch (e) {
        err.hidden = false;
        err.innerHTML = X.esc(e && e.name === 'EncryptedSourceError'
          ? X.saveError(e, 'This document could not be shared')
          : (e.message || 'The upload failed.'));
      } finally {
        go.disabled = false; go.textContent = 'Put on the server';
      }
    }

    function ownerUrl(id, token) {
      /* The owner token goes in the fragment: the browser never sends it to
         the server, so it stays out of logs and Referer headers. */
      return location.pathname + '?d=' + encodeURIComponent(id) + '#k=' + encodeURIComponent(token);
    }
    function shareUrl(token) {
      return site() + '?s=' + encodeURIComponent(token);
    }

    /** Keep a local note of documents this browser owns, so links are recoverable. */
    function rememberOwned(res) {
      let list = [];
      try { list = JSON.parse(localStorage.getItem('adddots.owned') || '[]'); } catch (e) {}
      list = list.filter(function (r) { return r.id !== res.id; });
      list.unshift({ id: res.id, token: res.owner_token, title: res.title, at: Date.now() });
      try { localStorage.setItem('adddots.owned', JSON.stringify(list.slice(0, 40))); } catch (e) {}
    }

    /* ---------------- manage links ---------------- */

    async function paintManage() {
      $('shTitle').textContent = 'Share for review';
      $('shBody').innerHTML =
        '<div class="shrow"><span class="shlab">Owner link</span>' +
        '<input id="shOwner" readonly><button class="btn" id="shCopyOwner">Copy</button></div>' +
        '<p class="shnote small">Keep this. It is the only way back to this document ' +
        'and it cannot be recovered from the server.</p>' +
        '<hr>' +
        '<h4>New review link</h4>' +
        '<div class="shgrid">' +
        '<label class="drow"><span>They can</span><select id="shRole">' +
        '<option value="comment" selected>View and comment</option>' +
        '<option value="view">View only</option>' +
        '<option value="edit">View, comment and edit</option>' +
        '</select></label>' +
        '<label class="drow"><span>Label</span><input id="shLabel" placeholder="Sent to the architect" maxlength="120"></label>' +
        '<label class="drow"><span>Expires</span><select id="shExp">' +
        '<option value="0">Never</option><option value="7" selected>In 7 days</option>' +
        '<option value="30">In 30 days</option><option value="90">In 90 days</option>' +
        '</select></label>' +
        '<label class="drow"><span>Password</span><input id="shPw" type="text" placeholder="optional" maxlength="200"></label>' +
        '<label class="drow"><span>Download</span><input type="checkbox" id="shDl">' +
        '<span class="shnote small">let them save a copy of the PDF</span></label>' +
        '</div>' +
        '<div class="shacts"><button class="btn primary" id="shMake">Create link</button></div>' +
        '<p class="shwarn" id="shErr" hidden></p>' +
        '<div id="shFresh"></div>' +
        '<hr><h4>Existing links <span class="shcount" id="shCount"></span></h4>' +
        '<div id="shList" class="shlist">Loading…</div>' +
        '<hr><div class="shacts spread">' +
        '<button class="btn del" id="shDelete">Delete from server</button>' +
        '<button class="btn" id="shDone">Done</button></div>';

      /* the owner's link opens on the website, from the apps too */
      $('shOwner').value = site() + ownerUrl(session.id, session.token).replace(/^[^?]*/, '');
      $('shCopyOwner').addEventListener('click', function () {
        copy($('shOwner').value, $('shCopyOwner'));
      });
      $('shMake').addEventListener('click', makeShare);
      $('shDone').addEventListener('click', closeShare);
      $('shDelete').addEventListener('click', deleteDoc);
      loadShares();
    }

    async function loadShares() {
      try {
        const res = await api('documents/' + session.id + '/shares');
        const list = res.shares || [];
        $('shCount').textContent = list.length ? '(' + list.length + ')' : '';
        if (!list.length) {
          $('shList').innerHTML = '<p class="shnote small">No review links yet.</p>';
          return;
        }
        $('shList').innerHTML = list.map(function (s) {
          const bits = [s.role === 'view' ? 'View only' : s.role === 'edit' ? 'Can edit' : 'Can comment'];
          if (s.has_password) bits.push('password');
          if (s.allow_download) bits.push('download');
          if (s.expires_at) bits.push('expires ' + s.expires_at.slice(0, 10));
          return '<div class="shitem' + (s.revoked ? ' off' : '') + '">' +
            '<div class="shmeta"><b>' + X.esc(s.label || 'Untitled link') + '</b>' +
            '<span>' + X.esc(bits.join(' · ')) + '</span>' +
            '<span class="shviews">' + s.view_count + ' view' + (s.view_count === 1 ? '' : 's') +
            (s.last_view_at ? ' · last ' + s.last_view_at.slice(0, 16).replace('T', ' ') : '') + '</span></div>' +
            '<button class="btn" data-act="' + (s.revoked ? 'restore' : 'revoke') + '" data-id="' + s.id + '">' +
            (s.revoked ? 'Turn back on' : 'Turn off') + '</button>' +
            '<button class="btn del" data-act="delete" data-id="' + s.id + '">Delete</button>' +
            '</div>';
        }).join('');
        Array.prototype.forEach.call($('shList').querySelectorAll('button[data-act]'), function (b) {
          b.addEventListener('click', function () { shareAction(b.dataset.act, b.dataset.id); });
        });
      } catch (e) {
        $('shList').innerHTML = '<p class="shwarn">' + X.esc(e.message) + '</p>';
      }
    }

    async function shareAction(act, id) {
      try {
        if (act === 'delete') {
          await api('documents/' + session.id + '/shares/' + id, { method: 'DELETE' });
          X.toast('Link deleted');
        } else {
          await api('documents/' + session.id + '/shares/' + id, {
            method: 'PATCH', json: { revoked: act === 'revoke' }
          });
          X.toast(act === 'revoke' ? 'Link turned off' : 'Link turned back on');
        }
        loadShares();
      } catch (e) {
        X.toast(X.esc(e.message));
      }
    }

    async function makeShare() {
      const b = $('shMake'), err = $('shErr');
      err.hidden = true;
      b.disabled = true;
      try {
        const res = await api('documents/' + session.id + '/shares', {
          method: 'POST',
          json: {
            role: $('shRole').value,
            label: $('shLabel').value.trim(),
            expires_days: parseInt($('shExp').value, 10) || 0,
            password: $('shPw').value || null,
            allow_download: $('shDl').checked
          }
        });
        const url = shareUrl(res.token);
        $('shFresh').innerHTML =
          '<div class="shfresh"><span class="shlab">New link</span>' +
          '<input id="shNew" readonly><button class="btn primary" id="shCopyNew">Copy</button>' +
          '<p class="shnote small">Copy it now — the server keeps only a hash, so it ' +
          'cannot show you this link again.</p></div>';
        $('shNew').value = url;
        $('shNew').select();
        $('shCopyNew').addEventListener('click', function () { copy(url, $('shCopyNew')); });
        $('shLabel').value = ''; $('shPw').value = '';
        loadShares();
      } catch (e) {
        err.hidden = false;
        err.innerHTML = X.esc(e.message);
      } finally {
        b.disabled = false;
      }
    }

    async function deleteDoc() {
      if (!window.confirm(
        'Delete this document from the server?\n\n' +
        'Every review link stops working and all comments go with it. ' +
        'The copy on this device is not touched.')) return;
      try {
        await api('documents/' + session.id, { method: 'DELETE' });
        stopPolling();
        session.id = null; session.token = null; session.role = null;
        session.comments.clear();
        setLive('');
        closeShare();
        history.replaceState(null, '', location.pathname);
        X.toast('Removed from the server');
        renderRemote();
      } catch (e) {
        X.toast(X.esc(e.message));
      }
    }

    function copy(text, btn) {
      const done = function () {
        const was = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = was; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); });
      } else { fallback(); }
      function fallback() {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    }

    /* ---------------- opening a link ---------------- */

    async function openFromLink() {
      const q = new URLSearchParams(location.search);
      const shareToken = q.get('s');
      const docId = q.get('d');
      const frag = new URLSearchParams(location.hash.replace(/^#/, ''));
      const ownerToken = frag.get('k');

      if (!shareToken && !(docId && ownerToken)) return false;

      session.token = shareToken || ownerToken;
      session.id = docId;

      showLoading('Opening the shared document…');
      try {
        await loadRemote(shareToken ? null : docId);
        return true;
      } catch (e) {
        if (e.code === 'password_required') {
          const pw = window.prompt('This link needs a password:');
          if (pw) {
            session.password = pw;
            try { await loadRemote(shareToken ? null : docId); return true; }
            catch (e2) { showFatal(e2.message); return true; }
          }
          showFatal('This link needs a password.');
          return true;
        }
        showFatal(e.message);
        return true;
      }
    }

    /**
     * A share token identifies its document on its own, but the metadata call
     * needs the id in the path. Fetch it by asking the server what this token
     * opens — the id comes back in the reply.
     */
    async function loadRemote(knownId) {
      /* With only a share token we do not yet know the id; the server accepts
         the token and tells us, so probe with a placeholder it will correct. */
      let meta;
      if (knownId) {
        meta = await api('documents/' + knownId);
      } else {
        meta = await api('documents/' + (await resolveId()));
      }

      session.id = meta.id;
      session.role = meta.role;
      session.version = meta.version;
      session.canDownload = meta.can_download;

      showLoading('Downloading ' + (meta.title || 'the document') + '…');

      const url = apiBase() + '/documents/' + meta.id + '/file?token=' + encodeURIComponent(session.token) +
        (session.password ? '&pw=' + encodeURIComponent(session.password) : '');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('The PDF could not be downloaded.');
      const blob = await res.blob();
      const file = new File([blob], meta.filename || 'document.pdf', { type: 'application/pdf' });

      hideLoading();
      /* Hand it to the normal open path so the whole viewer behaves as usual. */
      const dt = new DataTransfer();
      dt.items.add(file);
      const inp = $('fileIn');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));

      applyRole();
      setLive(roleLabel(), session.role === 'owner' ? 'ok' : 'review');
      startPolling();
    }

    /* A share URL carries no document id, so ask the server what this token
       opens before calling anything that needs one. */
    async function resolveId() {
      const r = await api('resolve');
      return r.id;
    }

    function roleLabel() {
      return session.role === 'owner' ? 'Shared'
        : session.role === 'edit' ? 'Review · can edit'
        : session.role === 'comment' ? 'Review · can comment'
        : 'Review · view only';
    }

    /** Hide what this link is not allowed to do. */
    function applyRole() {
      const r = session.role;
      document.body.dataset.role = r || '';
      const readOnly = (r === 'view' || r === 'comment');
      if (readOnly) {
        /* Editing tools would produce changes this link cannot save, which is
           worse than not offering them. */
        ['ribEdit', 'ribPage', 'ribForm', 'ribDoc'].forEach(function (id) {
          const el = $(id); if (el) el.hidden = true;
        });
        /* converting is a way of downloading */
        const conv = $('ribConvert'); if (conv && !session.canDownload) conv.hidden = true;
        const save = $('btnSave'); if (save) save.hidden = !session.canDownload;
        btnShare.hidden = true;
        if (r === 'view') {
          ['tabComments'].forEach(function (id) {
            const el = $(id); if (el) el.hidden = false;   /* they may still read */
          });
        }
      }
    }

    /* ---------------- loading / fatal screens ---------------- */

    const splash = document.createElement('div');
    splash.className = 'shsplash'; splash.id = 'shSplash'; splash.hidden = true;
    document.body.appendChild(splash);

    function showLoading(msg) {
      splash.hidden = false;
      splash.innerHTML = '<div class="shspin"></div><p>' + X.esc(msg) + '</p>';
    }
    function hideLoading() { splash.hidden = true; }
    function showFatal(msg) {
      splash.hidden = false;
      splash.innerHTML =
        '<div class="shfatal"><h2>This link did not open</h2><p>' + X.esc(msg) + '</p>' +
        '<button class="btn primary" id="shHome">Open a file instead</button></div>';
      $('shHome').addEventListener('click', function () {
        location.href = location.pathname;
      });
    }

    /* ---------------- comment sync ---------------- */

    function startPolling() {
      stopPolling();
      /* Reveal the Review tab straight away. It used to appear only when a poll
         reported a change, so a document with no comments yet hid the one place
         a reviewer can leave the first one. */
      renderRemoteList();
      pullComments();
      /* Shared hosting has no websockets, so this polls. Ten seconds is often
         enough to feel live without being rude to a shared server. */
      session.poll = setInterval(pullComments, 10000);
      document.addEventListener('visibilitychange', onVisible);
    }
    function stopPolling() {
      if (session.poll) clearInterval(session.poll);
      session.poll = null;
      document.removeEventListener('visibilitychange', onVisible);
    }
    function onVisible() {
      if (!document.hidden) pullComments();
    }

    async function pullComments() {
      if (!session.id || !session.token) return;
      try {
        const q = session.since ? '?since=' + encodeURIComponent(session.since) : '';
        const res = await api('documents/' + session.id + '/comments' + q);
        session.since = res.server_time;
        let changed = false;
        (res.comments || []).forEach(function (c) {
          if (c.deleted) {
            if (session.comments.delete(c.id)) changed = true;
          } else {
            const had = session.comments.get(c.id);
            if (!had || had.updated_at !== c.updated_at) changed = true;
            session.comments.set(c.id, c);
          }
        });
        if (changed) renderRemote();
      } catch (e) {
        /* A poll failing is not worth interrupting anyone over. */
      }
    }

    async function postComment(payload) {
      const res = await api('documents/' + session.id + '/comments', {
        method: 'POST',
        json: Object.assign({ author_name: authorName(session.role === 'owner' ? 'Owner' : 'Guest') }, payload)
      });
      if (res && res.comment) {
        session.comments.set(res.comment.id, res.comment);
        renderRemote();
      }
      return res && res.comment;
    }

    /* ---------------- remote comments on the page ---------------- */

    /* Rendered from the comment list rather than from it.shapes, so a
       reviewer's marks never enter the owner's document. */
    X.shapeRenderers.remote = function (it, s, vp) {
      const g = document.createElementNS(X.SVGNS, 'g');
      g.setAttribute('class', 'remote-mk' + (s.resolved ? ' done' : ''));
      const a = s.anchor || {};
      (a.quads || []).forEach(function (q) {
        const p1 = vp.convertToViewportPoint(q[0], q[1]);
        const p2 = vp.convertToViewportPoint(q[2], q[3]);
        const r = document.createElementNS(X.SVGNS, 'rect');
        r.setAttribute('x', Math.min(p1[0], p2[0]));
        r.setAttribute('y', Math.min(p1[1], p2[1]));
        r.setAttribute('width', Math.abs(p2[0] - p1[0]));
        r.setAttribute('height', Math.abs(p2[1] - p1[1]));
        r.style.fill = s.colour || '#F2C14E';
        r.style.fillOpacity = s.resolved ? 0.16 : 0.34;
        r.style.pointerEvents = 'all';
        r.style.cursor = 'pointer';
        r.addEventListener('click', function (e) { e.stopPropagation(); focusComment(s.id); });
        g.appendChild(r);
      });
      if (a.point) {
        const p = vp.convertToViewportPoint(a.point[0], a.point[1]);
        const c = document.createElementNS(X.SVGNS, 'circle');
        c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', 9);
        c.style.fill = s.colour || '#F2C14E';
        c.style.stroke = 'rgba(0,0,0,.5)';
        c.style.pointerEvents = 'all';
        c.style.cursor = 'pointer';
        c.addEventListener('click', function (e) { e.stopPropagation(); focusComment(s.id); });
        g.appendChild(c);
      }
      return g;
    };
    /* A remote mark belongs to the server, so it is never written to the PDF
       from here (E.saveHooks paints it as nothing) — the owner resolves it,
       and then it stops existing. */

    function renderRemote() {
      /* Drop the previous overlay and rebuild it from the server's list. */
      S.items.forEach(function (it) {
        it.shapes = it.shapes.filter(function (s) { return s.t !== 'remote'; });
      });
      session.comments.forEach(function (c) {
        if (c.kind === 'reply' || !c.anchor) return;
        const it = S.items[c.page_index];
        if (!it) return;
        it.shapes.push({
          t: 'remote', id: c.id, anchor: c.anchor,
          colour: c.colour, resolved: c.resolved
        });
      });
      S.items.forEach(function (it) { X.drawShapes(it); });
      renderRemoteList();
    }

    function focusComment(id) {
      const c = session.comments.get(id);
      if (!c) return;
      X.goTo(c.page_index + 1);
      showRail();
      setTimeout(function () {
        const el = document.querySelector('.rcitem[data-id="' + id + '"]');
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash');
          setTimeout(function () { el.classList.remove('flash'); }, 1200); }
      }, 300);
    }

    /* ---------------- the review rail ---------------- */

    const railTabs = document.querySelector('.rail-tabs');
    const tabBtn = document.createElement('button');
    tabBtn.className = 'btn'; tabBtn.id = 'tabReview'; tabBtn.textContent = 'Review';
    tabBtn.title = 'Comments from people you shared the link with';
    tabBtn.hidden = true;
    railTabs.insertBefore(tabBtn, $('railClose'));

    const panel = document.createElement('div');
    panel.className = 'rail-body'; panel.id = 'railReview'; panel.hidden = true;
    $('railPins').parentNode.insertBefore(panel, $('railPins').nextSibling);

    tabBtn.addEventListener('click', showRail);
    function showRail() {
      ['tabPages', 'tabFind', 'tabPins', 'tabComments', 'tabReview'].forEach(function (id) {
        const b = $(id); if (b) b.classList.toggle('on', id === 'tabReview');
      });
      ['railPages', 'railFind', 'railPins', 'railComments', 'railReview'].forEach(function (id) {
        const p = $(id); if (p) p.hidden = id !== 'railReview';
      });
      const rail = $('rail');
      if (rail.hidden) { const b = $('btnRail'); if (b) b.click(); }
      renderRemoteList();
    }

    function renderRemoteList() {
      if (!session.id) { tabBtn.hidden = true; return; }
      tabBtn.hidden = false;

      const roots = [];
      const replies = {};
      session.comments.forEach(function (c) {
        if (c.parent_id) { (replies[c.parent_id] = replies[c.parent_id] || []).push(c); }
        else roots.push(c);
      });
      roots.sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });

      const canComment = session.role !== 'view';
      const open = roots.filter(function (c) { return !c.resolved; }).length;

      panel.innerHTML =
        '<div class="rcbar">' +
        '<span><b>' + roots.length + '</b> comment' + (roots.length === 1 ? '' : 's') +
        ' · <b>' + open + '</b> open</span>' +
        '<span class="grow"></span>' +
        (canComment
          ? '<input id="rcName" class="rcname" placeholder="Your name" maxlength="80">'
          : '<span class="rcview">View only</span>') +
        '</div>' +
        (canComment
          ? '<div class="rcnew"><textarea id="rcText" rows="2" placeholder="Add a comment on page ' +
            S.current + '…"></textarea><button class="btn primary" id="rcAdd">Post</button></div>'
          : '') +
        '<div class="rclist">' +
        (roots.length ? roots.map(function (c) {
          const rs = (replies[c.id] || []).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
          return '<article class="rcitem' + (c.resolved ? ' done' : '') + '" data-id="' + c.id + '">' +
            '<header><i class="dot" style="background:' + X.esc(c.colour || '#F2C14E') + '"></i>' +
            '<b>' + X.esc(c.author_name) + '</b><span class="pg">p.' + (c.page_index + 1) + '</span></header>' +
            (c.quote ? '<blockquote>' + X.esc(c.quote) + '</blockquote>' : '') +
            '<p>' + X.esc(c.body || '') + '</p>' +
            rs.map(function (r) {
              return '<div class="rcrep"><b>' + X.esc(r.author_name) + '</b> ' + X.esc(r.body) + '</div>';
            }).join('') +
            '<footer>' +
            (canComment ? '<button class="lnk" data-reply="' + c.id + '">Reply</button>' : '') +
            (session.role === 'owner' || session.role === 'edit'
              ? '<button class="lnk" data-resolve="' + c.id + '">' + (c.resolved ? 'Reopen' : 'Resolve') + '</button>'
              : '') +
            '<span class="when">' + X.esc((c.created_at || '').slice(0, 16).replace('T', ' ')) + '</span>' +
            '</footer></article>';
        }).join('') : '<p class="cempty">No comments yet.</p>') +
        '</div>';

      if (canComment) {
        $('rcName').value = authorName('');
        $('rcName').addEventListener('change', function () { setAuthorName(this.value.trim()); });
        $('rcAdd').addEventListener('click', addComment);
      }
      Array.prototype.forEach.call(panel.querySelectorAll('[data-reply]'), function (b) {
        b.addEventListener('click', function () { replyTo(b.dataset.reply); });
      });
      Array.prototype.forEach.call(panel.querySelectorAll('[data-resolve]'), function (b) {
        b.addEventListener('click', function () { toggleResolve(b.dataset.resolve); });
      });
      Array.prototype.forEach.call(panel.querySelectorAll('.rcitem'), function (el) {
        el.addEventListener('click', function (e) {
          if (e.target.closest('button')) return;
          const c = session.comments.get(el.dataset.id);
          if (c) X.goTo(c.page_index + 1);
        });
      });
    }

    async function addComment() {
      const text = $('rcText').value.trim();
      if (!text) return;
      const name = $('rcName').value.trim();
      if (name) setAuthorName(name);
      $('rcAdd').disabled = true;
      try {
        await postComment({
          kind: 'note',
          page_index: Math.max(0, S.current - 1),
          body: text,
          anchor: null
        });
        $('rcText').value = '';
      } catch (e) {
        X.toast(X.esc(e.message));
      } finally {
        $('rcAdd').disabled = false;
      }
    }

    async function replyTo(id) {
      const text = window.prompt('Reply:');
      if (!text || !text.trim()) return;
      try {
        await postComment({ kind: 'reply', parent_id: id, body: text.trim() });
      } catch (e) { X.toast(X.esc(e.message)); }
    }

    async function toggleResolve(id) {
      const c = session.comments.get(id);
      if (!c) return;
      try {
        const res = await api('documents/' + session.id + '/comments/' + id, {
          method: 'PATCH', json: { resolved: !c.resolved }
        });
        if (res && res.comment) session.comments.set(res.comment.id, res.comment);
        renderRemote();
      } catch (e) { X.toast(X.esc(e.message)); }
    }

    /* A reviewer highlighting text posts it as a comment rather than a mark. */
    X.postRemoteMarkup = function (pageIndex, quads, quote, colour) {
      if (!session.id || session.role === 'view') return false;
      postComment({
        kind: 'markup',
        page_index: pageIndex,
        quote: quote || '',
        colour: colour || '#F2C14E',
        body: '',
        anchor: { quads: quads }
      }).catch(function (e) { X.toast(X.esc(e.message)); });
      return true;
    };

    /* ---------------- boot ---------------- */

    X.share = {
      session: session,
      open: openShare,
      post: postComment,
      pull: pullComments,
      api: api,
      collectState: collectState
    };

    openFromLink().then(function (opened) {
      if (!opened) setLive('');
    });

    window.addEventListener('beforeunload', stopPolling);
  });
})();
