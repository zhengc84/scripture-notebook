(() => {
  'use strict';

  // The page is laid out at a fixed logical width and scaled to fit, so ink always lines up with the text.
  const PAGE_W = 1100;
  const MIN_PAGE_H = 1300;
  const DEFAULT_EXTRA = 520;

  const PEN_COLORS = ['#1f1d1a', '#1f4e9c', '#c0392b', '#2b7a3d', '#6f42c1'];
  const HL_COLORS = ['#ffe066', '#b2f2bb', '#a5d8ff', '#fcc2d7', '#ffc078'];
  const SIZES = { pen: [2, 3.6, 6.5], hl: [14, 22, 30], eraser: [8, 16, 34], text: [22, 28, 36] };

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const viewport = $('#viewport'), wrap = $('#pageWrap'), page = $('#page'), textEl = $('#text');
  const hlSvg = $('#hlLayer'), penSvg = $('#penLayer'), notesEl = $('#notesLayer');
  const margins = $$('#patternLeft, #patternRight, #ruleLeft, #ruleRight'), patB = $('#patternBottom');
  const selBox = $('#selBox'), selMenu = $('#selMenu'), eraserCursor = $('#eraserCursor');
  const tray = $('#tray');

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const r1 = n => Math.round(n * 10) / 10;
  const r2 = n => Math.round(n * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isEditing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // ---------- Settings ----------
  const DEFAULTS = {
    translation: 'esv', apiKey: '', book: 42, chapter: 1, paper: 'lined', layout: 'verses',
    penOnly: false, penDetected: false, zoom: 1, tool: 'pen', prevTool: 'eraser',
    pen: { color: PEN_COLORS[0], size: 1 },
    hl: { color: HL_COLORS[0], size: 1, straight: true },
    eraser: { size: 1, mode: 'partial' },
    text: { color: PEN_COLORS[1], size: 1 },
  };
  const settings = (() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('sn:settings')) || {}; } catch {}
    const s = { ...DEFAULTS, ...saved };
    for (const k of ['pen', 'hl', 'eraser', 'text']) s[k] = { ...DEFAULTS[k], ...(saved[k] || {}) };
    return s;
  })();
  let settingsTimer = 0;
  function saveSettings() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      try { localStorage.setItem('sn:settings', JSON.stringify(settings)); } catch {}
    }, 150);
  }

  // ---------- Page state ----------
  let cur = { key: null, strokes: [], notes: [], extra: DEFAULT_EXTRA };
  let anchors = [], textBottom = 600, pageH = MIN_PAGE_H, scale = 1;
  let undoStack = [], redoStack = [];
  const strokeEls = new Map();
  let sel = null;          // { strokes: [], notes: [] }
  let active = null;       // current pointer interaction
  let pinch = null, pinchingUntil = 0, tempHand = false;
  let loadToken = 0;

  const book = () => BOOKS[settings.book];
  const tool = () => (tempHand ? 'hand' : settings.tool);

  // ---------- Scaling ----------
  function fitScale() {
    const gutter = viewport.clientWidth < 600 ? 16 : 40;
    return Math.min(1.15, (viewport.clientWidth - gutter * 2) / PAGE_W);
  }
  function applyScale() {
    scale = fitScale() * settings.zoom;
    page.style.transform = `scale(${scale})`;
    wrap.style.width = PAGE_W * scale + 'px';
    wrap.style.height = pageH * scale + 'px';
    $('#btnZoomReset').textContent = Math.round(settings.zoom * 100) + '%';
    if (sel) positionSelMenu();
  }
  function zoomAt(z, cx, cy) {
    const r = page.getBoundingClientRect();
    const ax = (cx - r.left) / scale, ay = (cy - r.top) / scale;
    settings.zoom = clamp(z, 0.5, 4);
    applyScale();
    const r2_ = page.getBoundingClientRect();
    viewport.scrollLeft += r2_.left + ax * scale - cx;
    viewport.scrollTop += r2_.top + ay * scale - cy;
    saveSettings();
  }
  function zoomCenter(z) {
    const vr = viewport.getBoundingClientRect();
    zoomAt(z, vr.left + vr.width / 2, vr.top + vr.height / 2);
  }

  // ---------- Layout & anchoring ----------
  // Each stroke remembers the verse it was written next to. If the text reflows (e.g. a
  // fallback font), strokes shift vertically with their verse instead of drifting.
  function measure() {
    const pr = page.getBoundingClientRect();
    anchors = [{ v: 'top', top: 0 }];
    textEl.querySelectorAll('[data-v]').forEach(el => {
      anchors.push({ v: el.dataset.v, top: r1((el.getBoundingClientRect().top - pr.top) / scale) });
    });
    textBottom = Math.max(400, r1((textEl.getBoundingClientRect().bottom - pr.top) / scale + 48));
    anchors.push({ v: 'end', top: textBottom });
    anchors.sort((a, b) => a.top - b.top);
  }
  function anchorFor(y) {
    let a = anchors[0];
    for (const x of anchors) { if (x.top <= y + 12) a = x; else break; }
    return { v: a.v, y0: a.top };
  }
  function rebase() {
    const tops = new Map(anchors.map(a => [a.v, a.top]));
    for (const s of cur.strokes) {
      const t = s.anchor && tops.get(s.anchor.v);
      if (t == null) continue;
      const dy = t - s.anchor.y0;
      if (Math.abs(dy) > 0.5) { shiftStroke(s, 0, dy); s.anchor.y0 = t; }
    }
    for (const n of cur.notes) {
      const t = n.anchor && tops.get(n.anchor.v);
      if (t == null) continue;
      const dy = t - n.anchor.y0;
      if (Math.abs(dy) > 0.5) { n.y = r1(n.y + dy); n.anchor.y0 = t; }
    }
  }
  function contentBottom() {
    let m = 0;
    for (const s of cur.strokes) m = Math.max(m, Ink.bbox(s)[3]);
    for (const n of cur.notes) m = Math.max(m, n.y + n.size * 2);
    return m;
  }
  function sizePage() {
    // Keep generous room below the lowest ink, like an endless notebook page.
    const need = contentBottom() + 320 - textBottom;
    if (need > cur.extra) cur.extra = Math.ceil(need / 100) * 100;
    pageH = Math.max(MIN_PAGE_H, textBottom + cur.extra);
    page.style.height = pageH + 'px';
    for (const svg of [hlSvg, penSvg]) { svg.setAttribute('width', PAGE_W); svg.setAttribute('height', pageH); }
    margins.forEach(el => { el.style.height = textBottom + 'px'; });
    patB.style.top = textBottom + 'px';
    patB.style.height = pageH - textBottom + 'px';
    applyScale();
  }

  // ---------- Rendering ----------
  function renderStroke(s) {
    let el = strokeEls.get(s.id);
    if (!el) {
      el = Ink.createEl(s);
      strokeEls.set(s.id, el);
      (s.tool === 'hl' ? hlSvg : penSvg).appendChild(el);
    }
    el.setAttribute('d', Ink.pathFor(s));
    return el;
  }
  function unrenderStroke(s) {
    const el = strokeEls.get(s.id);
    if (el) el.remove();
    strokeEls.delete(s.id);
  }
  function shiftStroke(s, dx, dy) {
    for (const p of s.pts) { p[0] = r1(p[0] + dx); p[1] = r1(p[1] + dy); }
    Ink.invalidate(s);
  }
  function renderAll() {
    hlSvg.replaceChildren(); penSvg.replaceChildren(); strokeEls.clear();
    cur.strokes.forEach(renderStroke);
    notesEl.replaceChildren();
    cur.notes.forEach(renderNote);
  }

  // ---------- Saving ----------
  let saveTimer = 0;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!cur.key) return;
    const empty = !cur.strokes.length && !cur.notes.length;
    if (empty && cur.extra === DEFAULT_EXTRA) { Store.del(cur.key); return; }
    Store.put({
      key: cur.key, translation: cur.translation, book: cur.book, chapter: cur.chapter,
      strokes: cur.strokes, notes: cur.notes, extra: cur.extra, updated: Date.now(),
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);

  // ---------- Undo / redo ----------
  function pushUndo(op) {
    undoStack.push(op);
    if (undoStack.length > 300) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
  }
  function updateUndoButtons() {
    $('#btnUndo').disabled = !undoStack.length;
    $('#btnRedo').disabled = !redoStack.length;
  }
  function addItems(strokes = [], notes = []) {
    for (const s of strokes) { cur.strokes.push(s); renderStroke(s); }
    for (const n of notes) { cur.notes.push(n); renderNote(n); }
  }
  function removeItems(strokes = [], notes = []) {
    const sids = new Set(strokes.map(s => s.id)), nids = new Set(notes.map(n => n.id));
    cur.strokes = cur.strokes.filter(s => { if (sids.has(s.id)) { unrenderStroke(s); return false; } return true; });
    cur.notes = cur.notes.filter(n => { if (nids.has(n.id)) { noteEl(n.id)?.remove(); return false; } return true; });
  }
  function moveItems(sids, nids, dx, dy) {
    for (const s of cur.strokes) if (sids.includes(s.id)) {
      shiftStroke(s, dx, dy); s.anchor = anchorFor(Ink.bbox(s)[1]); renderStroke(s);
    }
    for (const n of cur.notes) if (nids.includes(n.id)) {
      n.x = r1(n.x + dx); n.y = r1(n.y + dy); n.anchor = anchorFor(n.y); placeNote(n);
    }
  }
  function applyOp(op, dir) {
    if (op.t === 'move') moveItems(op.sids, op.nids, op.dx * dir, op.dy * dir);
    else if (op.t === 'swap') {
      // Eraser: `strokes`/`notes` were removed, `added` are the pieces left behind.
      if (dir > 0) { removeItems(op.strokes, op.notes); addItems(op.added); }
      else { removeItems(op.added); addItems(op.strokes, op.notes); }
    }
    else if ((op.t === 'add') === (dir > 0)) addItems(op.strokes, op.notes);
    else removeItems(op.strokes, op.notes);
  }
  function undo() {
    const op = undoStack.pop(); if (!op) return;
    clearSelection(); applyOp(op, -1); redoStack.push(op);
    updateUndoButtons(); sizePage(); scheduleSave();
  }
  function redo() {
    const op = redoStack.pop(); if (!op) return;
    clearSelection(); applyOp(op, 1); undoStack.push(op);
    updateUndoButtons(); sizePage(); scheduleSave();
  }

  // ---------- Loading chapters ----------
  function effectiveTranslation() { return settings.translation; }

  function chapterHead(b, c) {
    return `<header class="chapter-head"><div class="book">${b.chapters > 1 ? b.esvName : b.name}</div>${b.chapters > 1 ? `<div class="chap">${c}</div>` : ''}</header>`;
  }

  async function loadChapter(bi, c, opts = {}) {
    const token = ++loadToken;
    saveNow();
    clearSelection();
    cancelActive();
    settings.book = bi; settings.chapter = c; saveSettings();
    const b = BOOKS[bi], tr = effectiveTranslation();
    updateChrome();

    cur = { key: null, strokes: [], notes: [], extra: DEFAULT_EXTRA };
    undoStack = []; redoStack = []; updateUndoButtons();
    renderAll();

    if (tr === 'esv' && !settings.apiKey) { showKeySetup(); return; }

    textEl.innerHTML = chapterHead(b, c) + '<div class="loading">Loading…</div>';
    measure(); sizePage();
    if (!opts.keepScroll) viewport.scrollTop = 0;

    let html;
    try {
      html = await Sources.chapter(tr, b, c, settings.apiKey);
    } catch (err) {
      if (token === loadToken) showError(err.message);
      return;
    }
    if (token !== loadToken) return;

    textEl.innerHTML = chapterHead(b, c) + html;
    // ESV marks verse 1 with "3:1" (chapter-num); show it like any other verse number.
    textEl.querySelectorAll('b.chapter-num, b.verse-num').forEach(el => {
      const m = /^v(\d{8})/.exec(el.id || '');
      if (m) el.dataset.v = m[1];
      if (el.classList.contains('chapter-num')) {
        el.classList.add('verse-num');
        if (m) el.textContent = parseInt(m[1].slice(5), 10) + ' ';
      }
    });
    if (tr === 'esv' && settings.layout === 'verses') toVerseLines(textEl);

    try { await document.fonts.ready; } catch {}
    const key = `${tr}:${b.id}:${c}`;
    const data = await Store.get(key);
    if (token !== loadToken) return;

    cur = {
      key, translation: tr, book: b.id, chapter: c,
      strokes: data?.strokes || [], notes: data?.notes || [], extra: data?.extra || DEFAULT_EXTRA,
    };
    measure();
    rebase();
    renderAll();
    sizePage();

    if (opts.verse) {
      const vid = `${String(bi + 1).padStart(2, '0')}${String(c).padStart(3, '0')}${String(opts.verse).padStart(3, '0')}`;
      const el = textEl.querySelector(`[data-v="${vid}"]`);
      if (el) {
        const top = el.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 180;
        viewport.scrollTo({ top, behavior: 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      }
    }
  }

  // Rebuilds ESV paragraphs and poetry so each verse starts on its own line.
  // Headings stay where they are; poetry lines within a verse are joined with spaces.
  function toVerseLines(root) {
    const out = document.createDocumentFragment();
    let line = null, fresh = false; // fresh: nothing but the verse number on this line yet
    const newLine = () => { line = document.createElement('p'); line.className = 'vline'; out.appendChild(line); fresh = true; };
    const space = () => { if (line && !fresh) line.appendChild(document.createTextNode(' ')); };
    const walk = node => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === Node.TEXT_NODE) {
          let t = n.textContent.replace(/\u00a0{2,}/g, ' ');
          if (!line) { if (!t.trim()) continue; newLine(); }
          if (fresh) { t = t.replace(/^[\s\u00a0]+/, ''); if (!t) continue; fresh = false; }
          line.appendChild(document.createTextNode(t));
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          if (/^H[1-6]$/.test(n.tagName) || n.matches('.chapter-head')) { out.appendChild(n); line = null; }
          else if (n.matches('b.verse-num')) { newLine(); line.appendChild(n); }
          else if (n.matches('p') && n.querySelector('a.copyright')) { n.className = 'copyright'; out.appendChild(n); line = null; }
          else if (n.tagName === 'BR') space();
          else if (n.matches('p, div, span.line') || n.querySelector('b.verse-num')) { space(); walk(n); }
          else { if (!line) newLine(); line.appendChild(n); fresh = false; }
        }
      }
    };
    walk(root);
    root.replaceChildren(out);
  }

  function showKeySetup() {
    textEl.innerHTML = chapterHead(book(), settings.chapter) + `
      <div class="state-card">
        <h2>Connect the ESV</h2>
        <p>The English Standard Version is provided by Crossway through the ESV API. To read it here you need a free API key for personal, non-commercial use.</p>
        <p>1. <a href="https://api.esv.org/account/create-application/" target="_blank" rel="noopener">Create an application at api.esv.org</a> (sign in or make a free account).<br>
           2. Copy the key it gives you and paste it below.</p>
        <div class="row">
          <input id="inlineKey" type="password" placeholder="Paste your ESV API key" autocomplete="off" spellcheck="false">
          <button class="pill-btn primary" id="inlineKeySave">Save key</button>
        </div>
        <p style="margin-top:14px">Or <a href="#" id="useWeb">read the World English Bible</a> (public domain, no key) for now.</p>
      </div>`;
    measure(); sizePage();
    $('#inlineKeySave').onclick = () => {
      const v = $('#inlineKey').value.trim();
      if (!v) return;
      settings.apiKey = v; saveSettings();
      loadChapter(settings.book, settings.chapter);
    };
    $('#inlineKey').onkeydown = e => { if (e.key === 'Enter') $('#inlineKeySave').click(); };
    $('#useWeb').onclick = e => { e.preventDefault(); setTranslation('web'); };
  }

  function showError(msg) {
    textEl.innerHTML = chapterHead(book(), settings.chapter) + `
      <div class="state-card">
        <h2>Couldn’t load this chapter</h2>
        <p></p>
        <div class="row">
          <button class="pill-btn primary" id="retryBtn">Try again</button>
          <button class="pill-btn" id="errSettings">Settings</button>
        </div>
      </div>`;
    textEl.querySelector('.state-card p').textContent = msg;
    measure(); sizePage();
    $('#retryBtn').onclick = () => loadChapter(settings.book, settings.chapter);
    $('#errSettings').onclick = openSettings;
  }

  function setTranslation(tr) {
    if (settings.translation === tr) return;
    settings.translation = tr; saveSettings();
    loadChapter(settings.book, settings.chapter);
  }

  function step(delta) {
    let bi = settings.book, c = settings.chapter + delta;
    if (c < 1) { bi = (bi + BOOKS.length - 1) % BOOKS.length; c = BOOKS[bi].chapters; }
    else if (c > BOOKS[bi].chapters) { bi = (bi + 1) % BOOKS.length; c = 1; }
    loadChapter(bi, c);
  }

  function updateChrome() {
    const b = book();
    $('#refLabel').textContent = b.chapters > 1 ? `${b.esvName} ${settings.chapter}` : b.name;
    $('#trLabel').textContent = settings.translation === 'esv' ? 'ESV' : 'WEB';
    document.title = `${$('#refLabel').textContent} · Scripture Notebook`;
    $('#copyrightNote').textContent = settings.translation === 'esv'
      ? 'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.'
      : 'World English Bible — public domain. Text from bible-api.com.';
    page.className = `paper-${settings.paper}`;
  }

  // ---------- Pointer input ----------
  function capture(e) { try { page.setPointerCapture(e.pointerId); } catch {} }

  function pagePoint(e, rect) {
    const r = rect || page.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function pressureOf(e, last, p) {
    if (e.pointerType === 'pen') {
      const v = Math.pow(e.pressure > 0 ? e.pressure : 0.5, 0.75);
      return last ? last[2] * 0.35 + v * 0.65 : v;
    }
    // Mouse and finger have no pressure: thin the line slightly as it speeds up.
    if (!last) return 0.62;
    const d = Math.hypot(p.x - last[0], p.y - last[1]);
    const target = 0.92 - Math.min(d, 24) / 24 * 0.45;
    return last[2] * 0.75 + target * 0.25;
  }

  function applyTouchMode() {
    const t = tool();
    page.style.touchAction = (settings.penOnly || t === 'hand' || t === 'text') ? 'pan-x pan-y' : 'none';
  }

  page.addEventListener('pointerdown', e => {
    if (!cur.key || active) return;
    if (e.target.closest('.sel-menu, .note-grip')) return;
    if (tool() === 'text') return; // handled on click so taps don't fire while scrolling

    if (e.pointerType === 'pen' && !settings.penDetected) {
      settings.penDetected = true; settings.penOnly = true; saveSettings(); applyTouchMode();
      toast('Apple Pencil detected — the pencil draws, fingers scroll and pinch to zoom. Change this in Settings.');
    }
    if (e.pointerType === 'touch' && (settings.penOnly || pinch || Date.now() < pinchingUntil)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const t = (e.button === 5 || (e.buttons & 32)) ? 'eraser' : tool();
    if (t === 'hand') {
      if (e.pointerType === 'touch') return; // native scrolling
      active = { type: 'pan', id: e.pointerId, sx: e.clientX, sy: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop };
      page.classList.add('panning');
      capture(e);
      return;
    }

    e.preventDefault();
    capture(e);
    const p = pagePoint(e);
    if (t === 'pen' || t === 'hl') startDraw(e, t, p);
    else if (t === 'eraser') { active = { type: 'erase', id: e.pointerId, pointerType: e.pointerType, strokes: [], notes: [], pieces: new Map() }; eraseAt(p); }
    else if (t === 'lasso') startLasso(e, p);
  });

  page.addEventListener('pointermove', e => {
    if (tool() === 'eraser' || (active && active.type === 'erase')) moveEraserCursor(e);
    if (!active || e.pointerId !== active.id) return;
    if (active.type === 'pan') {
      viewport.scrollLeft = active.sl - (e.clientX - active.sx);
      viewport.scrollTop = active.st - (e.clientY - active.sy);
      return;
    }
    const rect = page.getBoundingClientRect();
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      const p = pagePoint(ev, rect);
      if (active.type === 'draw') extendDraw(ev, p);
      else if (active.type === 'erase') eraseAt(p);
      else if (active.type === 'lasso') extendLasso(p);
      else if (active.type === 'move') dragSelection(p);
    }
  });

  function endPointer(e) {
    if (!active || e.pointerId !== active.id) return;
    const a = active;
    active = null;
    if (a.type === 'pan') page.classList.remove('panning');
    else if (a.type === 'draw') finishDraw(a);
    else if (a.type === 'erase') finishErase(a);
    else if (a.type === 'lasso') finishLasso(a);
    else if (a.type === 'move') finishMove(a);
  }
  page.addEventListener('pointerup', endPointer);
  page.addEventListener('pointercancel', endPointer);
  page.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch' && !active) eraserCursor.hidden = true; });

  function cancelActive() {
    if (!active) return;
    if (active.type === 'draw') unrenderStroke(active.stroke);
    if (active.type === 'lasso') active.el.remove();
    active = null;
  }

  // On iPad, stop the pencil from scrolling the page so it can draw.
  const stopStylus = e => {
    for (const t of e.changedTouches) if (t.touchType === 'stylus') { e.preventDefault(); return; }
  };
  page.addEventListener('touchstart', stopStylus, { passive: false });
  page.addEventListener('touchmove', stopStylus, { passive: false });

  // ---------- Drawing ----------
  let raf = 0;
  function startDraw(e, t, p) {
    const cfg = settings[t];
    const s = {
      id: uid(), tool: t, color: cfg.color, size: SIZES[t][cfg.size],
      pts: [[r1(p.x), r1(p.y), r2(pressureOf(e, null, p))]],
    };
    if (t === 'hl' && cfg.straight) s.straight = true;
    active = { type: 'draw', id: e.pointerId, pointerType: e.pointerType, stroke: s, start: p };
    renderStroke(s);
  }
  function extendDraw(e, p) {
    const s = active.stroke;
    if (s.straight) {
      // Straight highlighter: snaps to horizontal when close, for highlighting a line of text.
      const y = Math.abs(p.y - active.start.y) < 14 ? active.start.y : p.y;
      s.pts = [s.pts[0], [r1(p.x), r1(y), 0.5]];
    } else {
      const last = s.pts[s.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) < 0.8) return;
      s.pts.push([r1(p.x), r1(p.y), r2(pressureOf(e, last, p))]);
    }
    Ink.invalidate(s);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (active && active.stroke) renderStroke(active.stroke); });
  }
  function finishDraw(a) {
    cancelAnimationFrame(raf); raf = 0;
    const s = a.stroke;
    if (s.tool === 'hl' && s.pts.length === 1) { unrenderStroke(s); return; }
    Ink.invalidate(s);
    renderStroke(s);
    s.anchor = anchorFor(Ink.bbox(s)[1]);
    cur.strokes.push(s);
    pushUndo({ t: 'add', strokes: [s], notes: [] });
    sizePage();
    scheduleSave();
  }

  // ---------- Eraser ----------
  function eraseAt(p) {
    const r = SIZES.eraser[settings.eraser.size];
    const hit = cur.strokes.filter(s => Ink.hits(s, p.x, p.y, r));
    if (settings.eraser.mode === 'partial') {
      for (const s of hit) splitStroke(s, p, r);
      hit.length = 0;
    }
    const notesHit = cur.notes.filter(n => {
      const el = noteEl(n.id); if (!el) return false;
      return p.x > n.x - r && p.x < n.x + el.offsetWidth + r && p.y > n.y - r && p.y < n.y + el.offsetHeight + r;
    });
    if (!hit.length && !notesHit.length) return;
    removeItems(hit, notesHit);
    active.strokes.push(...hit);
    active.notes.push(...notesHit);
  }
  // Partial erase: cut the part of the stroke under the eraser, keeping the pieces on either side.
  function splitStroke(s, p, r) {
    const { straight, ...base } = s;
    const pieces = Ink.cut(s, p.x, p.y, r).map(pts => {
      const c = { ...base, id: uid(), pts };
      c.anchor = anchorFor(Ink.bbox(c)[1]);
      return c;
    });
    const i = cur.strokes.indexOf(s);
    const el = strokeEls.get(s.id);
    cur.strokes.splice(i, 1, ...pieces);
    for (const c of pieces) {
      const ce = Ink.createEl(c);
      ce.setAttribute('d', Ink.pathFor(c));
      el.parentNode.insertBefore(ce, el); // keep the original stacking order
      strokeEls.set(c.id, ce);
    }
    el.remove();
    strokeEls.delete(s.id);
    // A piece made earlier in this same gesture just disappears; an original stroke is recorded for undo.
    if (active.pieces.has(s.id)) active.pieces.delete(s.id);
    else active.strokes.push(s);
    for (const c of pieces) active.pieces.set(c.id, c);
  }
  function finishErase(a) {
    if (a.pointerType === 'touch') eraserCursor.hidden = true;
    if (!a.strokes.length && !a.notes.length) return;
    pushUndo({ t: 'swap', strokes: a.strokes, notes: a.notes, added: [...a.pieces.values()] });
    scheduleSave();
  }
  function moveEraserCursor(e) {
    if (e.pointerType === 'touch' && settings.penOnly) return;
    const p = pagePoint(e), d = SIZES.eraser[settings.eraser.size] * 2;
    Object.assign(eraserCursor.style, { left: p.x + 'px', top: p.y + 'px', width: d + 'px', height: d + 'px' });
    eraserCursor.hidden = false;
  }

  // ---------- Lasso selection ----------
  function selBounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of sel.strokes) {
      const b = Ink.bbox(s);
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    for (const n of sel.notes) {
      const el = noteEl(n.id);
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + (el ? el.offsetWidth : 40)); y1 = Math.max(y1, n.y + (el ? el.offsetHeight : 30));
    }
    return [x0 - 10, y0 - 10, x1 + 10, y1 + 10];
  }
  function showSelection() {
    const b = selBounds();
    Object.assign(selBox.style, { left: b[0] + 'px', top: b[1] + 'px', width: b[2] - b[0] + 'px', height: b[3] - b[1] + 'px', transform: '' });
    selBox.hidden = false;
    positionSelMenu();
  }
  function positionSelMenu() {
    // Keep the menu a readable size whatever the zoom level.
    selMenu.style.transform = `scale(${1 / scale})`;
  }
  function clearSelection() {
    sel = null;
    selBox.hidden = true;
  }
  function startLasso(e, p) {
    if (sel) {
      const b = selBounds();
      if (p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3]) {
        active = { type: 'move', id: e.pointerId, start: p, dx: 0, dy: 0 };
        return;
      }
      clearSelection();
    }
    const el = document.createElementNS(Ink.NS, 'path');
    el.setAttribute('class', 'lasso-path');
    penSvg.appendChild(el);
    active = { type: 'lasso', id: e.pointerId, pts: [[p.x, p.y]], el };
  }
  function extendLasso(p) {
    const last = active.pts[active.pts.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 3) return;
    active.pts.push([p.x, p.y]);
    active.el.setAttribute('d', 'M' + active.pts.map(q => `${r1(q[0])} ${r1(q[1])}`).join('L') + 'Z');
  }
  function finishLasso(a) {
    a.el.remove();
    if (a.pts.length < 3) return;
    const strokes = cur.strokes.filter(s => Ink.inLasso(s, a.pts));
    const notes = cur.notes.filter(n => Ink.pointInPolygon(n.x + 10, n.y + 10, a.pts));
    if (!strokes.length && !notes.length) return;
    sel = { strokes, notes };
    showSelection();
  }
  function dragSelection(p) {
    active.dx = p.x - active.start.x;
    active.dy = p.y - active.start.y;
    const tr = `translate(${active.dx}px, ${active.dy}px)`;
    for (const s of sel.strokes) strokeEls.get(s.id).style.transform = tr;
    for (const n of sel.notes) noteEl(n.id).style.transform = tr;
    selBox.style.transform = tr;
  }
  function finishMove(a) {
    for (const s of sel.strokes) strokeEls.get(s.id).style.transform = '';
    for (const n of sel.notes) noteEl(n.id).style.transform = '';
    const dx = r1(a.dx), dy = r1(a.dy);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) { showSelection(); return; }
    const op = { t: 'move', sids: sel.strokes.map(s => s.id), nids: sel.notes.map(n => n.id), dx, dy };
    moveItems(op.sids, op.nids, dx, dy);
    pushUndo(op);
    showSelection();
    sizePage();
    scheduleSave();
  }
  selMenu.addEventListener('click', e => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act || !sel) return;
    if (act === 'delete') {
      const { strokes, notes } = sel;
      removeItems(strokes, notes);
      pushUndo({ t: 'del', strokes, notes });
      clearSelection();
    } else if (act === 'duplicate') {
      const strokes = sel.strokes.map(s => {
        const c = { ...s, id: uid(), pts: s.pts.map(p => [r1(p[0] + 24), r1(p[1] + 24), p[2]]) };
        c.anchor = anchorFor(Ink.bbox(c)[1]);
        return c;
      });
      const notes = sel.notes.map(n => ({ ...n, id: uid(), x: n.x + 24, y: n.y + 24, anchor: anchorFor(n.y + 24) }));
      addItems(strokes, notes);
      pushUndo({ t: 'add', strokes, notes });
      sel = { strokes, notes };
      showSelection();
    }
    sizePage();
    scheduleSave();
  });

  // ---------- Text notes ----------
  const noteEl = id => notesEl.querySelector(`.note[data-id="${id}"]`);
  function placeNote(n) {
    const el = noteEl(n.id); if (!el) return;
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
  }
  function renderNote(n) {
    const el = document.createElement('div');
    el.className = 'note';
    el.dataset.id = n.id;
    el.style.color = n.color;
    el.style.fontSize = n.size + 'px';
    el.innerHTML = '<div class="note-grip" title="Drag to move"><svg><use href="#i-grip"/></svg></div><div class="note-body" spellcheck="true"></div>';
    const body = el.querySelector('.note-body');
    try { body.contentEditable = 'plaintext-only'; } catch { body.contentEditable = 'true'; }
    if (body.contentEditable !== 'plaintext-only') body.contentEditable = 'true';
    body.textContent = n.text;
    notesEl.appendChild(el);
    placeNote(n);

    body.addEventListener('focus', () => { el.dataset.orig = n.text; });
    body.addEventListener('input', () => { n.text = body.innerText; scheduleSave(); });
    body.addEventListener('blur', () => finalizeNote(n, el));
    body.addEventListener('keydown', e => { if (e.key === 'Escape') body.blur(); });

    const grip = el.querySelector('.note-grip');
    grip.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch {}
      const start = pagePoint(e), x0 = n.x, y0 = n.y;
      const move = ev => {
        const p = pagePoint(ev);
        n.x = r1(x0 + p.x - start.x); n.y = r1(y0 + p.y - start.y); placeNote(n);
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        const dx = r1(n.x - x0), dy = r1(n.y - y0);
        if (!dx && !dy) return;
        n.anchor = anchorFor(n.y);
        pushUndo({ t: 'move', sids: [], nids: [n.id], dx, dy });
        sizePage(); scheduleSave();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
    return el;
  }
  function finalizeNote(n, el) {
    if (!cur.notes.includes(n)) return;
    const text = el.querySelector('.note-body').innerText.replace(/\s+$/, '');
    const fresh = el.dataset.fresh === '1';
    if (!text.trim()) {
      removeItems([], [n]);
      if (!fresh) pushUndo({ t: 'del', strokes: [], notes: [{ ...n, text: el.dataset.orig || '' }] });
    } else {
      n.text = text;
      n.anchor = anchorFor(n.y);
      if (fresh) { delete el.dataset.fresh; pushUndo({ t: 'add', strokes: [], notes: [n] }); }
    }
    sizePage();
    scheduleSave();
  }
  page.addEventListener('click', e => {
    if (tool() !== 'text' || !cur.key || e.target.closest('.note, .sel-menu, .state-card')) return;
    const p = pagePoint(e);
    const cfg = settings.text, size = SIZES.text[cfg.size];
    const n = { id: uid(), x: r1(p.x - 6), y: r1(p.y - size * 0.6), text: '', color: cfg.color, size };
    n.anchor = anchorFor(n.y);
    cur.notes.push(n);
    const el = renderNote(n);
    el.dataset.fresh = '1';
    el.querySelector('.note-body').focus();
  });

  // ---------- Pinch & wheel zoom ----------
  const touchesOf = e => [...e.touches].filter(t => t.touchType !== 'stylus');
  viewport.addEventListener('touchstart', e => {
    const ts = touchesOf(e);
    if (ts.length !== 2) return;
    e.preventDefault();
    if (active && active.pointerType === 'touch') cancelActive();
    const [a, b] = ts;
    pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z0: settings.zoom, mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2 };
  }, { passive: false });
  viewport.addEventListener('touchmove', e => {
    const ts = touchesOf(e);
    if (!pinch || ts.length < 2) return;
    e.preventDefault();
    const [a, b] = ts;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
    viewport.scrollLeft -= mx - pinch.mx;
    viewport.scrollTop -= my - pinch.my;
    pinch.mx = mx; pinch.my = my;
    zoomAt(pinch.z0 * d / pinch.d0, mx, my);
  }, { passive: false });
  viewport.addEventListener('touchend', e => {
    if (pinch && touchesOf(e).length < 2) { pinch = null; pinchingUntil = Date.now() + 250; }
  });
  document.addEventListener('gesturestart', e => e.preventDefault());
  viewport.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomAt(settings.zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener('resize', applyScale);

  // ---------- Toolbar & tray ----------
  function setTool(t) {
    if (document.activeElement && document.activeElement.closest?.('.note')) document.activeElement.blur();
    if (t !== settings.tool) settings.prevTool = settings.tool;
    settings.tool = t; saveSettings();
    page.dataset.tool = t;
    $$('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    clearSelection();
    eraserCursor.hidden = true;
    applyTouchMode();
    renderTray();
  }

  function renderTray() {
    const t = settings.tool;
    tray.replaceChildren();
    const add = html => { tray.insertAdjacentHTML('beforeend', html); return tray.lastElementChild; };
    const sep = () => add('<span class="tray-sep"></span>');

    if (t === 'pen' || t === 'hl' || t === 'text') {
      const cfg = settings[t];
      const colors = t === 'hl' ? HL_COLORS : PEN_COLORS;
      colors.forEach(c => {
        const b = add(`<button class="swatch${cfg.color === c ? ' active' : ''}" title="${c}"><span style="background:${c}"></span></button>`);
        b.onclick = () => { cfg.color = c; saveSettings(); renderTray(); };
      });
      const custom = !colors.includes(cfg.color);
      const cb = add(`<label class="swatch custom${custom ? ' active' : ''}" title="Custom color"><span${custom ? ` style="background:${cfg.color}"` : ''}></span><input type="color" value="${cfg.color}"></label>`);
      cb.querySelector('input').onchange = e => { cfg.color = e.target.value; saveSettings(); renderTray(); };
      sep();
    }
    if (t === 'pen' || t === 'hl' || t === 'text' || t === 'eraser') {
      const cfg = settings[t];
      const dots = t === 'text' ? [7, 10, 14] : [5, 9, 14];
      SIZES[t].forEach((_, i) => {
        const b = add(`<button class="size${cfg.size === i ? ' active' : ''}" title="Size ${i + 1}"><span style="width:${dots[i]}px;height:${dots[i]}px"></span></button>`);
        b.onclick = () => { cfg.size = i; saveSettings(); renderTray(); };
      });
    }
    if (t === 'hl') {
      sep();
      const b = add(`<button class="toggle${settings.hl.straight ? ' on' : ''}">Straight line</button>`);
      b.onclick = () => { settings.hl.straight = !settings.hl.straight; saveSettings(); renderTray(); };
    }
    if (t === 'eraser') {
      sep();
      for (const [mode, label] of [['partial', 'Partial'], ['stroke', 'Whole stroke']]) {
        const b = add(`<button class="toggle${settings.eraser.mode === mode ? ' on' : ''}">${label}</button>`);
        b.onclick = () => { settings.eraser.mode = mode; saveSettings(); renderTray(); };
      }
    }
    if (t === 'lasso') add('<span class="tray-hint">Circle ink to select it, then drag to move</span>');
    if (t === 'text') { sep(); add('<span class="tray-hint">Tap the page to type</span>'); }
    if (t === 'hand') add('<span class="tray-hint">Drag to scroll · pinch or ⌘-scroll to zoom</span>');

    // Show the active color under the pen/highlighter tool icons.
    for (const k of ['pen', 'hl']) {
      const btn = document.querySelector(`.tool[data-tool="${k}"]`);
      let chip = btn.querySelector('.chip');
      if (!chip) { chip = document.createElement('span'); chip.className = 'chip'; btn.appendChild(chip); }
      chip.style.background = settings[k].color;
    }
  }

  // Tapping the tool you're already on switches back to the one you used before it.
  $$('.tool').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    setTool(t === settings.tool && settings.prevTool && settings.prevTool !== t ? settings.prevTool : t);
  }));
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnPrev').onclick = $('#btnPrev2').onclick = () => step(-1);
  $('#btnNext').onclick = $('#btnNext2').onclick = () => step(1);
  $('#btnZoomIn').onclick = () => zoomCenter(settings.zoom * 1.2);
  $('#btnZoomOut').onclick = () => zoomCenter(settings.zoom / 1.2);
  $('#btnZoomReset').onclick = () => zoomCenter(1);
  $('#btnAddSpace').onclick = () => {
    if (!cur.key) return;
    cur.extra += 600; sizePage(); scheduleSave();
    viewport.scrollBy({ top: 400, behavior: 'smooth' });
  };

  document.addEventListener('keydown', e => {
    if (isEditing(e.target) || document.querySelector('dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod) return;
    const map = { p: 'pen', h: 'hl', e: 'eraser', l: 'lasso', t: 'text' };
    if (map[e.key.toLowerCase()]) { setTool(map[e.key.toLowerCase()]); return; }
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Escape') clearSelection();
    else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) selMenu.querySelector('[data-act="delete"]').click();
    else if (e.key === ' ' && !tempHand) { e.preventDefault(); tempHand = true; page.dataset.tool = 'hand'; applyTouchMode(); }
  });
  document.addEventListener('keyup', e => {
    if (e.key === ' ' && tempHand) { tempHand = false; page.dataset.tool = settings.tool; applyTouchMode(); }
  });

  // ---------- Passage picker ----------
  const pickerDlg = $('#pickerDlg'), pickerBody = $('#pickerBody'), gotoInput = $('#gotoInput');
  let annotated = new Map(); // key -> page record

  async function openPicker(focusSearch) {
    const all = await Store.all();
    annotated = new Map(all.filter(p => p.translation === settings.translation && ((p.strokes || []).length || (p.notes || []).length)).map(p => [p.key, p]));
    renderBooks();
    gotoInput.value = '';
    pickerDlg.showModal();
    if (focusSearch) gotoInput.focus(); else gotoInput.blur();
  }
  function bookHasNotes(b) {
    for (const k of annotated.keys()) if (k.split(':')[1] === b.id) return true;
    return false;
  }
  function renderBooks() {
    const recent = [...annotated.values()].sort((a, b) => b.updated - a.updated).slice(0, 10);
    const btn = b => `<button class="book-btn${b.index === settings.book ? ' current' : ''}${bookHasNotes(b) ? ' has-notes' : ''}" data-book="${b.index}">${b.name}</button>`;
    pickerBody.innerHTML = `
      ${recent.length ? `<div class="picker-sec"><h3>Recently annotated</h3><div class="recent-row">${recent.map(p => {
        const b = BOOKS.find(x => x.id === p.book);
        return b ? `<button class="recent-btn" data-book="${b.index}" data-ch="${p.chapter}">${b.chapters > 1 ? `${b.name} ${p.chapter}` : b.name}</button>` : '';
      }).join('')}</div></div>` : ''}
      <div class="picker-sec"><h3>Old Testament</h3><div class="book-grid">${BOOKS.filter(b => b.testament === 'OT').map(btn).join('')}</div></div>
      <div class="picker-sec"><h3>New Testament</h3><div class="book-grid">${BOOKS.filter(b => b.testament === 'NT').map(btn).join('')}</div></div>`;
  }
  function renderChapters(bi) {
    const b = BOOKS[bi];
    let html = `<button class="picker-back">‹ All books</button><h2 class="picker-title">${b.name}</h2><div class="ch-grid">`;
    for (let c = 1; c <= b.chapters; c++) {
      const cls = (bi === settings.book && c === settings.chapter ? ' current' : '') + (annotated.has(`${settings.translation}:${b.id}:${c}`) ? ' has-notes' : '');
      html += `<button class="ch-btn${cls}" data-book="${bi}" data-ch="${c}">${c}</button>`;
    }
    pickerBody.innerHTML = html + '</div>';
    pickerBody.scrollTop = 0;
  }
  pickerBody.addEventListener('click', e => {
    if (e.target.closest('.picker-back')) { renderBooks(); return; }
    const b = e.target.closest('[data-book]');
    if (!b) return;
    const bi = +b.dataset.book;
    if (b.dataset.ch) { pickerDlg.close(); loadChapter(bi, +b.dataset.ch); }
    else if (BOOKS[bi].chapters === 1) { pickerDlg.close(); loadChapter(bi, 1); }
    else renderChapters(bi);
  });

  function parseRef(q) {
    const m = /^\s*((?:[123]\s*)?[a-z][a-z .]*?)\.?\s*(\d+)?(?:\s*[:.]\s*(\d+))?\s*$/i.exec(q);
    if (!m) return null;
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = norm(m[1]);
    if (!key) return null;
    const alias = BOOK_ALIASES[key];
    let b = alias ? BOOKS.find(x => x.name === alias)
      : BOOKS.find(x => norm(x.name) === key) || BOOKS.find(x => norm(x.name).startsWith(key));
    if (!b) return null;
    let ch = m[2] ? +m[2] : 1, verse = m[3] ? +m[3] : null;
    if (b.chapters === 1 && m[2] && !m[3] && +m[2] > 1) { verse = +m[2]; ch = 1; } // "Jude 3" = verse 3
    if (ch < 1 || ch > b.chapters) return null;
    return { bi: b.index, ch, verse };
  }
  gotoInput.addEventListener('input', () => {
    const v = gotoInput.value.trim();
    if (!v) { renderBooks(); return; }
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = norm(v.replace(/\d+\s*([:.]\s*\d*)?\s*$/, '')) || norm(v);
    const matches = BOOKS.filter(b => norm(b.name).includes(key) || BOOK_ALIASES[key] === b.name);
    const ref = parseRef(v);
    pickerBody.innerHTML = (ref ? `<div class="picker-sec"><h3>Go to</h3><div class="recent-row"><button class="recent-btn" data-book="${ref.bi}" data-ch="${ref.ch}" data-verse="${ref.verse || ''}">${BOOKS[ref.bi].name} ${ref.ch}${ref.verse ? ':' + ref.verse : ''}</button></div></div>` : '') +
      (matches.length ? `<div class="picker-sec"><h3>Books</h3><div class="book-grid">${matches.map(b => `<button class="book-btn" data-book="${b.index}">${b.name}</button>`).join('')}</div></div>` : '');
  });
  gotoInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const ref = parseRef(gotoInput.value);
    if (ref) { pickerDlg.close(); loadChapter(ref.bi, ref.ch, { verse: ref.verse }); }
  });
  pickerBody.addEventListener('click', e => {
    const b = e.target.closest('[data-verse]');
    if (b && b.dataset.verse) { e.stopImmediatePropagation(); pickerDlg.close(); loadChapter(+b.dataset.book, +b.dataset.ch, { verse: +b.dataset.verse }); }
  }, true);
  $('#btnLibrary').onclick = () => openPicker(false);
  $('#btnRef').onclick = () => openPicker(true);

  // ---------- Settings ----------
  const settingsDlg = $('#settingsDlg');
  function syncSettingsUI() {
    $$('#segTranslation button').forEach(b => b.classList.toggle('active', b.dataset.val === settings.translation));
    $$('#segLayout button').forEach(b => b.classList.toggle('active', b.dataset.val === settings.layout));
    $$('#segPaper button').forEach(b => b.classList.toggle('active', b.dataset.val === settings.paper));
    $('#apiKeyInput').value = settings.apiKey;
    $('#chkPenOnly').checked = settings.penOnly;
  }
  function openSettings() { syncSettingsUI(); renderOffline(); settingsDlg.showModal(); }

  // ---------- Offline reading ----------
  const refName = (b, c) => b.chapters > 1 ? `${b.esvName} ${c}` : b.name;
  async function renderOffline() {
    const tr = settings.translation;
    const sum = await Sources.savedSummary(tr);
    const n = sum.chapters.length, plural = n === 1 ? '' : 's';
    $('#offlineStatus').textContent = !n ? 'No chapters saved on this device yet.'
      : tr === 'esv' ? `${n} ESV chapter${plural} saved on this device (${sum.verses} of ${Sources.ESV_VERSE_LIMIT} verses).`
      : `${n} World English Bible chapter${plural} saved on this device.`;
    const items = sum.chapters
      .map(c => ({ b: BOOKS.find(x => x.id === c.book), c: c.chapter }))
      .filter(x => x.b)
      .sort((x, y) => x.b.index - y.b.index || x.c - y.c);
    $('#offlineList').innerHTML = items.map(x => `<button class="recent-btn" data-book="${x.b.index}" data-ch="${x.c}">${refName(x.b, x.c)}</button>`).join('');
    $('#btnDownload').textContent = book().chapters > 1 ? `Save ${book().name} ${settings.chapter} onward` : `Save ${book().name}`;
  }
  $('#offlineList').onclick = e => {
    const b = e.target.closest('[data-book]'); if (!b) return;
    settingsDlg.close(); loadChapter(+b.dataset.book, +b.dataset.ch);
  };
  $('#btnDownload').onclick = async () => {
    const tr = settings.translation, b = book(), btn = $('#btnDownload');
    if (tr === 'esv' && !settings.apiKey) { toast('Add your ESV API key first.'); return; }
    if (tr === 'esv' && b.chapters === 1) { toast(`The ESV doesn’t allow one-chapter books like ${b.name} to be stored offline.`); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await Sources.download(tr, b, settings.chapter, settings.apiKey, 10, n => { btn.textContent = `Saving… ${n}`; });
      const range = r.saved.length > 1 ? `${b.esvName} ${r.saved[0]}–${r.saved[r.saved.length - 1]}` : r.saved.length ? refName(b, r.saved[0]) : '';
      if (!r.saved.length) toast(`Couldn’t save more of ${b.name}: the ESV allows 500 verses, and at most half of a book, on a device.`);
      else toast(`Saved ${range} for offline reading.` + (r.reason === 'limit' ? ' That’s as much as the ESV allows to be stored right now.' : ''));
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      renderOffline();
    }
  };
  $('#btnClearTexts').onclick = async () => {
    if (!await ask('Remove all saved chapter text from this device? Your notes are not affected.', 'Remove')) return;
    await Sources.clearSaved();
    Sources.clear();
    renderOffline();
  };
  $('#btnSettings').onclick = openSettings;
  $('#segTranslation').onclick = e => {
    const v = e.target.closest('button')?.dataset.val; if (!v) return;
    setTranslation(v); syncSettingsUI();
  };
  $('#segLayout').onclick = e => {
    const v = e.target.closest('button')?.dataset.val; if (!v || v === settings.layout) return;
    settings.layout = v; saveSettings(); syncSettingsUI();
    loadChapter(settings.book, settings.chapter, { keepScroll: true });
  };
  $('#segPaper').onclick = e => {
    const v = e.target.closest('button')?.dataset.val; if (!v) return;
    settings.paper = v; saveSettings(); updateChrome(); syncSettingsUI();
  };
  $('#btnSaveKey').onclick = () => {
    settings.apiKey = $('#apiKeyInput').value.trim(); saveSettings();
    Sources.clear();
    toast(settings.apiKey ? 'ESV key saved.' : 'ESV key removed.');
    if (settings.translation === 'esv') loadChapter(settings.book, settings.chapter, { keepScroll: true });
  };
  $('#chkPenOnly').onchange = e => { settings.penOnly = e.target.checked; settings.penDetected = true; saveSettings(); applyTouchMode(); };

  $('#btnExport').onclick = async () => {
    saveNow();
    const pages = await Store.all();
    const blob = new Blob([JSON.stringify({ app: 'scripture-notebook', version: 1, exported: new Date().toISOString(), pages })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scripture-notebook-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Exported ${pages.length} annotated chapter${pages.length === 1 ? '' : 's'}.`);
  };
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const pages = (data.pages || []).filter(p => p && typeof p.key === 'string' && Array.isArray(p.strokes));
      if (!pages.length) throw new Error('empty');
      if (!await ask(`Import ${pages.length} annotated chapter${pages.length === 1 ? '' : 's'}? Chapters that already have annotations here will be replaced.`, 'Import')) return;
      for (const p of pages) await Store.put(p);
      toast(`Imported ${pages.length} chapter${pages.length === 1 ? '' : 's'}.`);
      cur.key = null; // don't let a pending save overwrite the imported copy
      loadChapter(settings.book, settings.chapter, { keepScroll: true });
    } catch {
      toast('That file doesn’t look like a Scripture Notebook backup.');
    }
  };
  $('#btnClearPage').onclick = async () => {
    if (!cur.key || (!cur.strokes.length && !cur.notes.length)) { toast('This page has no annotations.'); return; }
    if (!await ask('Remove all ink and text boxes from this chapter? You can undo this.', 'Clear page', true)) return;
    const strokes = [...cur.strokes], notes = [...cur.notes];
    removeItems(strokes, notes);
    pushUndo({ t: 'del', strokes, notes });
    clearSelection(); scheduleSave();
    settingsDlg.close();
  };

  // In-app confirmation (window.confirm is blocked in some embedded browsers).
  const confirmDlg = $('#confirmDlg');
  function ask(message, okLabel, danger) {
    $('#confirmMsg').textContent = message;
    const ok = $('#confirmOk');
    ok.textContent = okLabel;
    ok.classList.toggle('danger-fill', !!danger);
    confirmDlg.returnValue = '';
    confirmDlg.showModal();
    ok.focus();
    return new Promise(resolve => confirmDlg.addEventListener('close', () => resolve(confirmDlg.returnValue === 'ok'), { once: true }));
  }
  $('#confirmOk').onclick = () => confirmDlg.close('ok');
  $('#confirmCancel').onclick = () => confirmDlg.close('cancel');

  for (const dlg of [pickerDlg, settingsDlg]) {
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  }

  // ---------- Toast ----------
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  // ---------- Start ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('offline', () => toast('You’re offline. Your notes and saved chapters still work.'));
  window.addEventListener('online', () => toast('Back online.'));
  setTool(settings.tool);
  updateChrome();
  applyScale();
  loadChapter(clamp(settings.book, 0, BOOKS.length - 1), settings.chapter);
})();
