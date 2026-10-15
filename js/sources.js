// Fetches chapter text. ESV comes from api.esv.org (needs a free personal API key);
// the World English Bible (public domain) comes from bible-api.com and needs no key.
//
// Chapters you read are also kept on the device so they open offline. The ESV API terms say an app
// "may not locally store more than 500 verses or one-half of any book of the Bible (whichever is
// less)", so ESV chapters are kept within those limits: at most 500 verses in total and at most half
// of a book's chapters, dropping the least recently read first. One-chapter books (Jude, Obadiah...)
// are never stored. Stored ESV text is refreshed after 30 days, as the terms ask.
window.Sources = (() => {
  const memo = new Map();
  const ESV_VERSE_LIMIT = 500;
  const MAX_AGE = 30 * 24 * 3600 * 1000;
  const OFFLINE_MSG = 'You’re offline, and this chapter isn’t saved on this device. Chapters you’ve read recently, and ones you save under Settings → Offline reading, open without internet.';

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta,audio,video,form,input,button,small.audio,a.mp3link')
      .forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(el => {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name) || a.name === 'style') el.removeAttribute(a.name);
        if (a.name === 'href' && !/^https?:/i.test(a.value)) el.removeAttribute('href');
      }
    });
    return doc.body.firstChild.innerHTML;
  }

  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n, w) => String(n).padStart(w, '0');

  async function esv(book, chapter, key) {
    const q = book.chapters === 1 ? book.esvName : `${book.esvName} ${chapter}`;
    const params = new URLSearchParams({
      q,
      'include-passage-references': 'false',
      'include-footnotes': 'false',
      'include-footnote-body': 'false',
      'include-audio-link': 'false',
      'include-headings': 'true',
      'include-subheadings': 'true',
      'include-chapter-numbers': 'true',
      'include-first-verse-numbers': 'true',
      'include-verse-numbers': 'true',
      'include-short-copyright': 'true',
      'include-copyright': 'false',
      'include-passage-horizontal-lines': 'false',
      'include-heading-horizontal-lines': 'false',
      'include-surrounding-chapters': 'false',
    });
    let res;
    try {
      res = await fetch(`https://api.esv.org/v3/passage/html/?${params}`, {
        headers: { Authorization: `Token ${key.trim()}` },
      });
    } catch {
      if (!navigator.onLine) throw new Error(OFFLINE_MSG);
      // The ESV API omits CORS headers on auth errors, so a bad key surfaces as a network error.
      throw new Error('Could not load the ESV text. Check that your ESV API key is correct and that you are online.');
    }
    if (!res.ok) throw new Error(`The ESV API returned an error (${res.status}). Check your API key in Settings.`);
    const data = await res.json();
    if (!data.passages || !data.passages.length) throw new Error('The ESV API returned no text for this chapter.');
    return sanitize(data.passages.join(''));
  }

  async function web(book, chapter) {
    let res;
    try {
      res = await fetch(`https://bible-api.com/data/web/${book.id}/${chapter}`);
    } catch {
      throw new Error(navigator.onLine ? 'Could not reach bible-api.com. Are you online?' : OFFLINE_MSG);
    }
    if (res.status === 429) throw new Error('Too many requests to bible-api.com — wait a few seconds and try again.');
    if (!res.ok) throw new Error(`bible-api.com returned an error (${res.status}).`);
    const data = await res.json();
    const bookNum = pad(book.index + 1, 2), ch = pad(chapter, 3);
    return data.verses.map(v =>
      `<p class="vline"><b class="verse-num" data-v="${bookNum}${ch}${pad(v.verse, 3)}">${v.verse}&nbsp;</b>${esc(v.text.trim())}</p>`
    ).join('') + '<p class="copyright">World English Bible · Public Domain</p>';
  }

  const keyOf = (tr, book, ch) => `${tr}:${book.id}:${ch}`;
  const countVerses = html => (html.match(/class="(?:chapter-num|verse-num)/g) || []).length;
  const fetchText = (tr, book, ch, key) => tr === 'esv' ? esv(book, ch, key) : web(book, ch);

  // Stores a chapter for offline use. For the ESV, makes room by dropping the least recently read
  // chapters (never ones in `protect`) and returns false if the chapter can't be stored within the limits.
  async function keep(tr, book, ch, html, protect) {
    const key = keyOf(tr, book, ch), now = Date.now();
    const verses = countVerses(html);
    const record = { key, translation: tr, book: book.id, chapter: ch, html, verses, saved: now, read: now };
    if (tr !== 'esv') { await Store.texts.put(record); return true; }

    const halfBook = Math.floor(book.chapters / 2);
    if (halfBook < 1) return false;
    const others = (await Store.texts.all()).filter(t => t.translation === 'esv' && t.key !== key);
    let total = others.reduce((n, t) => n + t.verses, 0);
    let inBook = others.filter(t => t.book === book.id).length;
    const drop = [];
    for (const t of others.filter(t => !(protect && protect.has(t.key))).sort((a, b) => a.read - b.read)) {
      const overTotal = total + verses > ESV_VERSE_LIMIT, overBook = inBook >= halfBook;
      if (!overTotal && !overBook) break;
      if (overTotal || t.book === book.id) {
        drop.push(t.key); total -= t.verses;
        if (t.book === book.id) inBook--;
      }
    }
    if (total + verses > ESV_VERSE_LIMIT || inBook >= halfBook) return false;
    for (const k of drop) await Store.texts.del(k);
    await Store.texts.put(record);
    return true;
  }

  async function chapter(tr, book, ch, key) {
    const k = keyOf(tr, book, ch);
    if (memo.has(k)) return memo.get(k);
    const stored = await Store.texts.get(k);
    if (stored && (Date.now() - stored.saved < MAX_AGE || !navigator.onLine)) {
      Store.texts.put({ ...stored, read: Date.now() });
      memo.set(k, stored.html);
      return stored.html;
    }
    let html;
    try {
      html = await fetchText(tr, book, ch, key);
    } catch (err) {
      if (stored) return stored.html; // expired copy is better than nothing
      throw err;
    }
    memo.set(k, html);
    keep(tr, book, ch, html).catch(() => {});
    return html;
  }

  // Saves upcoming chapters of a book (starting at `from`) for offline reading.
  // Stops at `max` chapters, the end of the book, or the ESV storage limits.
  async function download(tr, book, from, key, max = 10, onProgress) {
    const protect = new Set(), saved = [];
    let reason = 'done';
    for (let ch = from; ch <= book.chapters && saved.length < max; ch++) {
      const k = keyOf(tr, book, ch);
      const stored = await Store.texts.get(k);
      let ok;
      if (stored) {
        ok = true;
      } else {
        const html = memo.get(k) || await fetchText(tr, book, ch, key);
        memo.set(k, html);
        ok = await keep(tr, book, ch, html, protect);
      }
      if (!ok) { reason = 'limit'; break; }
      protect.add(k);
      saved.push(ch);
      if (onProgress) onProgress(saved.length);
    }
    if (reason === 'done' && saved.length && saved[saved.length - 1] === book.chapters) reason = 'end';
    return { saved, reason };
  }

  async function savedSummary(tr) {
    const all = (await Store.texts.all()).filter(t => t.translation === tr);
    return { chapters: all.map(t => ({ book: t.book, chapter: t.chapter })), verses: all.reduce((n, t) => n + t.verses, 0) };
  }

  async function clearSaved() {
    for (const t of await Store.texts.all()) await Store.texts.del(t.key);
  }

  return { chapter, download, savedSummary, clearSaved, ESV_VERSE_LIMIT, clear: () => memo.clear() };
})();
