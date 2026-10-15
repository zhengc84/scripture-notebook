// Ink geometry: turns recorded points [x, y, pressure] into SVG paths, and hit-tests strokes.
// Pen strokes are filled outlines whose width follows pressure (or speed, for mouse/finger);
// highlighter strokes are plain wide strokes drawn underneath the text.
window.Ink = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const f = n => Math.round(n * 10) / 10;
  const boxes = new WeakMap();

  function smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      out.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  const radius = (size, p) => size * (0.25 + 0.75 * p) / 2;

  const dot = (x, y, r) =>
    `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;

  // Quadratic curve through the midpoints of P, starting from P[0] (assumed current point).
  function curve(P) {
    let d = '';
    for (let i = 1; i < P.length - 1; i++) {
      d += `Q${f(P[i][0])} ${f(P[i][1])} ${f((P[i][0] + P[i + 1][0]) / 2)} ${f((P[i][1] + P[i + 1][1]) / 2)}`;
    }
    const l = P[P.length - 1];
    return d + `L${f(l[0])} ${f(l[1])}`;
  }

  function penPath(raw, size) {
    const pts = smooth(smooth(raw));
    const n = pts.length;
    const b = bboxOf(pts);
    if (n === 1 || (b[2] - b[0] < 0.5 && b[3] - b[1] < 0.5)) {
      return dot(pts[0][0], pts[0][1], Math.max(radius(size, pts[0][2]), 0.9));
    }
    const L = [], R = [], W = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
      let tx = c[0] - a[0], ty = c[1] - a[1];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      const taper = 0.55 + 0.45 * Math.min(1, i / 3, (n - 1 - i) / 3);
      const r = radius(size, pts[i][2]) * taper;
      W.push(r);
      L.push([pts[i][0] - ty * r, pts[i][1] + tx * r]);
      R.push([pts[i][0] + ty * r, pts[i][1] - tx * r]);
    }
    const re = W[n - 1], rs = W[0];
    R.reverse();
    return `M${f(L[0][0])} ${f(L[0][1])}` + curve(L) +
      `A${f(re)} ${f(re)} 0 0 0 ${f(R[0][0])} ${f(R[0][1])}` + curve(R) +
      `A${f(rs)} ${f(rs)} 0 0 0 ${f(L[0][0])} ${f(L[0][1])}Z`;
  }

  function hlPath(pts) {
    if (pts.length === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}l0.1 0`;
    if (pts.length === 2) return `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`;
    const P = smooth(pts);
    return `M${f(P[0][0])} ${f(P[0][1])}` + curve(P);
  }

  function pathFor(s) { return s.tool === 'hl' ? hlPath(s.pts) : penPath(s.pts, s.size); }

  function createEl(s) {
    const el = document.createElementNS(NS, 'path');
    if (s.tool === 'hl') {
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', s.color);
      el.setAttribute('stroke-width', s.size);
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      el.setAttribute('stroke-opacity', '0.62');
    } else {
      el.setAttribute('fill', s.color);
    }
    return el;
  }

  function bboxOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  }

  function bbox(s) {
    let b = boxes.get(s);
    if (!b) {
      const r = s.size / 2;
      const raw = bboxOf(s.pts);
      b = [raw[0] - r, raw[1] - r, raw[2] + r, raw[3] + r];
      boxes.set(s, b);
    }
    return b;
  }

  function invalidate(s) { boxes.delete(s); }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function hits(s, x, y, r) {
    const b = bbox(s);
    if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return false;
    const lim = r + s.size / 2;
    const P = s.pts;
    if (P.length === 1) return Math.hypot(P[0][0] - x, P[0][1] - y) < lim;
    for (let i = 1; i < P.length; i++) {
      if (distToSeg(x, y, P[i - 1][0], P[i - 1][1], P[i][0], P[i][1]) < lim) return true;
    }
    return false;
  }

  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // A stroke is lassoed when most of its points fall inside the loop.
  function inLasso(s, poly) {
    const step = Math.max(1, Math.floor(s.pts.length / 40));
    let n = 0, inside = 0;
    for (let i = 0; i < s.pts.length; i += step) {
      n++;
      if (pointInPolygon(s.pts[i][0], s.pts[i][1], poly)) inside++;
    }
    return inside / n >= 0.5;
  }

  // Fill in long gaps (e.g. a straight highlighter is only two points) so a cut lands where the eraser is.
  function resample(pts, step = 2) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        out.push([f(a[0] + (b[0] - a[0]) * t), f(a[1] + (b[1] - a[1]) * t), Math.round((a[2] + (b[2] - a[2]) * t) * 100) / 100]);
      }
    }
    return out;
  }

  // Removes the points within the eraser circle and returns the runs of points left on either side.
  function cut(s, x, y, r) {
    const lim = r + s.size * 0.35;
    const runs = [];
    let run = [];
    for (const p of resample(s.pts)) {
      if (Math.hypot(p[0] - x, p[1] - y) < lim) { if (run.length) runs.push(run); run = []; }
      else run.push(p);
    }
    if (run.length) runs.push(run);
    return runs.filter(r => r.length >= 2);
  }

  return { NS, cut, pathFor, createEl, bbox, invalidate, hits, pointInPolygon, inLasso };
})();
