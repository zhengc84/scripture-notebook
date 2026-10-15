// Annotation storage: one record per chapter in IndexedDB, with a localStorage fallback.
window.Store = (() => {
  let dbp = null;
  const LS = 'sn:page:';

  function open() {
    if (!dbp) dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('scripture-notebook', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('pages', { keyPath: 'key' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }

  function req(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction('pages', mode);
      const r = fn(t.objectStore('pages'));
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

  return {
    get: wrap(k => req('readonly', s => s.get(k)), ls.get),
    put: wrap(p => req('readwrite', s => s.put(p)), ls.put),
    del: wrap(k => req('readwrite', s => s.delete(k)), ls.del),
    all: wrap(() => req('readonly', s => s.getAll()), ls.all),
  };
})();
