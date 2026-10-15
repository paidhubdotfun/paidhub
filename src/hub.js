/**
 * The hero's living copy of the paidhub banner: files fly in from both edges along dotted pixel lanes and
 * disappear into the hub. Far from the hub they are big, near it small, always at whole-number pixel
 * scales. Some carry a real name from the Unclaimed board (a GitHub login and what waits for it).
 *
 * Desktop: the lanes end at the hub's sides. Phone: the hub card sits under a band where the lanes meet
 * in the middle. Files on one lane share one speed, so they never overtake or stack.
 * Reduced motion draws one still frame. The loop sleeps when the hero is off screen or the tab hidden.
 */
export function startFlow(canvas, hubEl, { labels = [] } = {}) {
  const ctx = canvas.getContext("2d");
  const sprite = new Image();
  sprite.src = "/px/file.png";
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let phone = false;
  let lanes = [];
  let raf = 0;
  let visible = true;
  let last = 0;
  let labelAt = 0;

  function measure() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    w = Math.round(r.width);
    h = Math.round(r.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    phone = w < 700;
    const old = lanes;
    lanes = [];
    if (phone) {
      for (const side of [-1, 1]) {
        [34, 76, 118].forEach((y, i) => lanes.push(lane(side, y + (side > 0 ? 10 : 0), side < 0 ? w / 2 - 14 : w / 2 + 14, i)));
      }
    } else {
      const hr = hubEl.getBoundingClientRect();
      const hub = { x: hr.left - r.left, y: hr.top - r.top, w: hr.width, h: hr.height };
      const n = 4;
      for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          const y = Math.round(hub.y + hub.h * 0.14 + (i / (n - 1)) * hub.h * 0.72 + (side < 0 ? 0 : 22));
          lanes.push(lane(side, y, side < 0 ? hub.x - 6 : hub.x + hub.w + 6, i));
        }
      }
    }
    // keep the files where they were on a resize
    lanes.forEach((l, i) => (l.files = old[i]?.files || seed(l)));
  }

  function lane(side, y, end, i) {
    const start = side < 0 ? -30 : w + 30;
    const len = Math.abs(end - start);
    // px per second, a little different on every lane so the picture never marches in step
    const speed = (phone ? 26 : 38) + ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 5;
    return { side, y, start, end, len, speed, files: [] };
  }

  function seed(l) {
    const files = [];
    const count = 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k < count; k++) files.push(spawn(l, Math.min(0.9, k * 0.45 + Math.random() * 0.25)));
    return files.sort((a, b) => a.p - b.p);
  }

  function spawn(l, p = 0) {
    const label = labels.length && Math.random() < 0.5 ? labels[labelAt++ % labels.length] : "";
    return { p, label };
  }

  const dot = (x, y, s) => ctx.fillRect(Math.round(x), Math.round(y), s, s);

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const unit = phone ? 2 : 3;
    ctx.fillStyle = "#000";
    for (const l of lanes) {
      const a = Math.min(l.start, l.end);
      const b = Math.max(l.start, l.end);
      for (let x = Math.max(0, a) + 4; x < Math.min(w, b) - 2; x += unit * 5) dot(x, l.y, unit);
    }
    ctx.font = `${phone ? 11 : 12}px "Departure Mono", monospace`;
    ctx.textBaseline = "top";
    for (const l of lanes) {
      l.files.forEach((f, idx) => {
        const x = l.start + (l.end - l.start) * f.p;
        const far = 1 - f.p;
        const max = phone ? 3 : 4;
        const k = Math.max(1, Math.min(max, Math.round(1 + far * (max - 0.6))));
        const fw = 12 * k;
        const fh = 15 * k;
        const fx = Math.round(x - fw / 2);
        const fy = Math.round(l.y - fh / 2);
        // the lane stops at the file's outline
        ctx.fillStyle = "#fdfb0a";
        ctx.fillRect(fx - 4, l.y - unit, fw + 8, unit * 2);
        ctx.fillStyle = "#000";
        if (sprite.complete && sprite.naturalWidth) ctx.drawImage(sprite, fx, fy, fw, fh);
        // one name per lane at most, on the file furthest out, while it is big
        if (f.label && k >= 3 && idx === 0 && !phone) {
          const tw = ctx.measureText(f.label).width;
          const lx = Math.round(Math.min(Math.max(4, x - tw / 2), w - tw - 4));
          ctx.fillStyle = "#fdfb0a";
          ctx.fillRect(lx - 3, fy + fh + 4, tw + 6, 16);
          ctx.fillStyle = "#000";
          ctx.fillText(f.label, lx, fy + fh + 6);
        }
      });
    }
  }

  function step(t) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    for (const l of lanes) {
      const dp = (l.speed * dt) / Math.max(1, l.len);
      for (const f of l.files) f.p += dp;
      l.files = l.files.filter((f) => f.p < 1);
      // a new file enters once the newest one is well clear of the edge
      l.files.sort((a, b) => a.p - b.p);
      const newest = l.files[0];
      if (!newest || newest.p > 0.42) l.files.unshift(spawn(l, 0));
    }
    draw();
    raf = requestAnimationFrame(step);
  }

  const wake = () => {
    if (visible && !still && !raf) {
      last = 0;
      raf = requestAnimationFrame(step);
    }
  };
  const onResize = () => {
    measure();
    draw();
  };
  window.addEventListener("resize", onResize);
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting && !document.hidden;
    wake();
  });
  io.observe(canvas);
  const onVis = () => {
    visible = !document.hidden;
    wake();
  };
  document.addEventListener("visibilitychange", onVis);

  measure();
  sprite.onload = () => draw();
  document.fonts?.ready?.then(() => {
    measure();
    draw();
  });
  draw();
  wake();

  return {
    setLabels(next) {
      labels = next;
    },
    stop() {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
