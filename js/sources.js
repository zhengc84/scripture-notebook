// Fetches chapter text. ESV comes from api.esv.org (needs a free personal API key);
// the World English Bible (public domain) comes from bible-api.com and needs no key.
// ESV text is cached in memory only — the ESV API terms limit how much text an app may store.
window.Sources = (() => {
  const memo = new Map();

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
      throw new Error('Could not reach bible-api.com. Are you online?');
    }
    if (res.status === 429) throw new Error('Too many requests to bible-api.com — wait a few seconds and try again.');
    if (!res.ok) throw new Error(`bible-api.com returned an error (${res.status}).`);
    const data = await res.json();
    const bookNum = pad(book.index + 1, 2), ch = pad(chapter, 3);
    return data.verses.map(v =>
      `<p class="vline"><b class="verse-num" data-v="${bookNum}${ch}${pad(v.verse, 3)}">${v.verse}&nbsp;</b>${esc(v.text.trim())}</p>`
    ).join('') + '<p class="copyright">World English Bible · Public Domain</p>';
  }

  async function chapter(translation, book, ch, key) {
    const k = `${translation}:${book.id}:${ch}`;
    if (memo.has(k)) return memo.get(k);
    const html = translation === 'esv' ? await esv(book, ch, key) : await web(book, ch);
    memo.set(k, html);
    return html;
  }

  return { chapter, clear: () => memo.clear() };
})();
