# Scripture Notebook

A GoodNotes / Freeform-style notebook for the Bible. Each chapter of the ESV is laid out
on a page of paper with a wide ruled margin and open space underneath, and you can write
anywhere on it with Apple Pencil, a mouse, a trackpad or your finger.

## Features

- **ESV text** from Crossway's ESV API, with section headings and poetry layout. The
  World English Bible (public domain) is built in as a no-key fallback.
- **Pen** that responds to pressure (Apple Pencil), or to speed (mouse and finger).
- **Highlighter** that sits *under* the text so the words stay crisp. "Straight line" mode
  snaps to horizontal so you can highlight a line of text cleanly.
- **Eraser** that removes whole strokes and text boxes.
- **Lasso** to circle ink and then move, duplicate or delete it.
- **Text boxes** in a handwriting font, for typed notes.
- **Margin paper:** lined, dotted, grid or blank. Writing space grows as you write near
  the bottom, and **＋ Add writing space** gives you more.
- **Palm rejection:** the first time Apple Pencil touches the page, the app switches to
  pencil-only drawing. After that, fingers scroll and pinch to zoom.
- Undo/redo, zoom, a passage picker with "Go to" search (`Rom 8`, `Ps 23`, `Jn 3:16`),
  and dots that mark the chapters you have annotated.
- Annotations save automatically in the browser (IndexedDB), one notebook page per chapter
  and per translation. **Export backup / Import backup** moves them between devices.
- Ink is anchored to the nearest verse, so it stays beside the right verse if the text
  ever reflows.

## Offline use

After the first visit, the app opens without internet: a service worker (`sw.js`) keeps the
app's files on the device. Your annotations are always stored on the device.

Chapter text is kept too, so chapters you've read open offline. **Settings → Offline reading**
shows what's saved, and can save the next chapters of the book you're in. The ESV API terms
allow at most 500 verses, and no more than half of any book, to be stored locally, so ESV
chapters are kept within those limits (the least recently read are dropped first, one-chapter
books are never stored, and saved text is refreshed after 30 days). World English Bible chapters
have no limit.

## Running it

It's a static site with no build step. Serve the folder with any web server:

```bash
cd scripture-notebook && python3 -m http.server 8000
```

Then open http://localhost:8000.

### On iPad with Apple Pencil

Host the folder anywhere that serves HTTPS, such as GitHub Pages, Netlify or Cloudflare
Pages. Open it in Safari, then choose **Share → Add to Home Screen** so it runs full screen.
For a quick test on the same Wi-Fi network you can also open `http://<your-mac's-IP>:8000`.

## Getting an ESV API key

1. Create a free account and application at https://api.esv.org/account/create-application/
2. Paste the key into the app, either on the first page or under **Settings → ESV API key**.

The key is stored only in your browser's localStorage. Keys are for personal,
non-commercial use. Offline copies of ESV text are kept within the API's storage limits
(see Offline use above).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| P / H / E / L / T | Pen / Highlighter / Eraser / Lasso / Text |
| Hold Space | Temporary hand (drag to scroll) |
| ⌘Z / ⇧⌘Z | Undo / Redo |
| ← / → | Previous / next chapter |
| ⌘ + scroll or trackpad pinch | Zoom |
| Delete | Delete lasso selection |

## Files

- `index.html`: markup, icons and dialogs
- `css/styles.css`: all styling
- `js/books.js`: the 66 books, with chapter counts and abbreviations
- `js/sources.js`: fetches ESV (api.esv.org) and WEB (bible-api.com) chapters
- `js/ink.js`: stroke geometry: pressure outlines, highlighter paths, hit-testing, lasso
- `js/store.js`: IndexedDB storage, with a localStorage fallback
- `js/app.js`: everything else: page layout, tools, input, undo, notes, navigation
- `sw.js`: service worker that keeps the app's files on the device for offline use

---

Scripture quotations marked "ESV" are from the ESV® Bible (The Holy Bible, English Standard
Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by
permission. All rights reserved.
