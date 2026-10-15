// Storage in IndexedDB:
//   pages: one record per chapter with your ink and text boxes (localStorage fallback)
//   texts: chapter text kept for offline reading (see js/sources.js for the ESV limits)
window.Store = (() => {
  let dbp = null;
  const LS = 'sn:page:';

  function open() {
    if (!dbp) dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('scripture-notebook', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }

  function req(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r ? r.result : undefined);
      t.onerror = t.onabort = () => reject(t.error);
    }));
  }

  const ls = {
    get: k => { try { return JSON.parse(localStorage.getItem(LS + k)) || undefined; } catch { return undefined; } },
    put: p => { try { localStorage.setItem(LS + p.key, JSON.stringify(p)); } catch {} },
    del: k => { try { localStorage.removeItem(LS + k); } catch {} },
    all: () => {
      const out = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS)) out.push(JSON.parse(localStorage.getItem(k))); } } catch {}
      return out;
    },
  };

  const wrap = (idb, fallback) => (...a) => idb(...a).catch(() => fallback(...a));
  const none = () => undefined;

  return {
    get: wrap(k => req('pages', 'readonly', s => s.get(k)), ls.get),
    put: wrap(p => req('pages', 'readwrite', s => s.put(p)), ls.put),
    del: wrap(k => req('pages', 'readwrite', s => s.delete(k)), ls.del),
    all: wrap(() => req('pages', 'readonly', s => s.getAll()), ls.all),
    texts: {
      get: wrap(k => req('texts', 'readonly', s => s.get(k)), none),
      put: wrap(t => req('texts', 'readwrite', s => s.put(t)), none),
      del: wrap(k => req('texts', 'readwrite', s => s.delete(k)), none),
      all: wrap(() => req('texts', 'readonly', s => s.getAll()), () => []),
    },
  };
})();
