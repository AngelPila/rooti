// "Su terreno" in 3D: the satellite photo draped on the relief around the plot, with the plot lifted out of it
// so its soil shows underneath. three.js from jsDelivr (+esm so OrbitControls shares the same three instance).
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/+esm";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js/+esm";

const ESRI = (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const DEM = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;

async function bitmap(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return createImageBitmap(await r.blob()); }

// Tiles covering sizeM metres around (lat, lon) at native resolution, plus the crop box of that square.
async function mosaic(lat, lon, z, sizeM, urlFn) {
  const n = 256 * 2 ** z, s = Math.sin((lat * Math.PI) / 180), mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  const cx = ((lon + 180) / 360) * n, cy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n, half = sizeM / 2 / mpp;
  const x0 = cx - half, y0 = cy - half, tx0 = Math.floor(x0 / 256), ty0 = Math.floor(y0 / 256), tx1 = Math.floor((cx + half) / 256), ty1 = Math.floor((cy + half) / 256);
  const c = document.createElement("canvas"); c.width = (tx1 - tx0 + 1) * 256; c.height = (ty1 - ty0 + 1) * 256;
  const g = c.getContext("2d", { willReadFrequently: true }), jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) jobs.push(bitmap(urlFn(z, tx, ty)).then((b) => g.drawImage(b, (tx - tx0) * 256, (ty - ty0) * 256)));
  await Promise.all(jobs);
  return { c, sx: x0 - tx0 * 256, sy: y0 - ty0 * 256, sw: 2 * half };
}

function box3(src, W, H) {
  const o = new Float32Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += src[yy * W + xx]; k++; } }
    o[y * W + x] = s / k;
  }
  return o;
}
function bilinear(arr, W, H, x, y) {
  x = Math.min(W - 1, Math.max(0, x)); y = Math.min(H - 1, Math.max(0, y));
  const X = Math.floor(x), Y = Math.floor(y), X1 = Math.min(W - 1, X + 1), Y1 = Math.min(H - 1, Y + 1), fx = x - X, fy = y - Y;
  return arr[Y * W + X] * (1 - fx) * (1 - fy) + arr[Y * W + X1] * fx * (1 - fy) + arr[Y1 * W + X] * (1 - fx) * fy + arr[Y1 * W + X1] * fx * fy;
}

async function loadArea(lat, lon, sizeM, zImg, outPx) {
  const photo = document.createElement("canvas"); photo.width = photo.height = outPx;
  const pg = photo.getContext("2d", { willReadFrequently: true });
  const m = await mosaic(lat, lon, zImg, sizeM, ESRI);
  pg.drawImage(m.c, m.sx, m.sy, m.sw, m.sw, 0, 0, outPx, outPx);
  let dem = () => 0, dmin = 0;
  try {
    const d = await mosaic(lat, lon, 14, sizeM, DEM), W = d.c.width, H = d.c.height, px = d.c.getContext("2d").getImageData(0, 0, W, H).data;
    // Terrarium has spike pixels (water, towers): clip to the 3rd-97th percentile, then smooth twice
    let z = new Float32Array(W * H); for (let i = 0; i < W * H; i++) z[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    const sorted = Float32Array.from(z).sort(), lo = sorted[Math.floor(sorted.length * 0.03)], hi = sorted[Math.floor(sorted.length * 0.97)];
    z = box3(box3(z.map((v) => Math.min(hi, Math.max(lo, v))), W, H), W, H);
    dem = (u, v) => bilinear(z, W, H, d.sx + u * d.sw - 0.5, d.sy + v * d.sw - 0.5);
    dmin = Infinity; for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) dmin = Math.min(dmin, dem(i / 40, j / 40));
  } catch { /* no relief: flat ground */ }
  // Plant height guessed from how green each pixel is (excess-green index); bright roofs and clouds stay flat
  const VR = 256, sm = document.createElement("canvas"); sm.width = sm.height = VR;
  const sg = sm.getContext("2d", { willReadFrequently: true }); sg.drawImage(photo, 0, 0, VR, VR);
  const px = sg.getImageData(0, 0, VR, VR).data, raw = new Float32Array(VR * VR);
  for (let i = 0; i < VR * VR; i++) { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; raw[i] = Math.min(1, Math.max(0, ((2 * g - r - b) / (r + g + b + 1) - 0.03) / 0.22)) * (1 - Math.max(0, (r + g + b) / 3 - 150) / 105); }
  const veg = box3(raw, VR, VR), vegAt = (u, v) => bilinear(veg, VR, VR, u * (VR - 1), v * (VR - 1));
  const makeGreen = () => {
    const c = document.createElement("canvas"); c.width = c.height = outPx;
    const g = c.getContext("2d"), pd = pg.getImageData(0, 0, outPx, outPx), od = g.createImageData(outPx, outPx);
    const ramp = [[0, [120, 96, 66]], [0.25, [205, 191, 140]], [0.5, [174, 201, 174]], [0.75, [84, 150, 92]], [1, [200, 255, 158]]];
    for (let i = 0; i < outPx * outPx; i++) {
      const r = pd.data[i * 4], gg = pd.data[i * 4 + 1], b = pd.data[i * 4 + 2], t = Math.min(1, Math.max(0, ((2 * gg - r - b) / (r + gg + b + 1) + 0.05) / 0.3));
      let k = 0; while (k < ramp.length - 2 && t > ramp[k + 1][0]) k++;
      const [a0, c0] = ramp[k], [a1, c1] = ramp[k + 1], f = (t - a0) / (a1 - a0), lum = 0.55 + (0.45 * (r + gg + b)) / 765;
      for (let ch = 0; ch < 3; ch++) od.data[i * 4 + ch] = (c0[ch] + (c1[ch] - c0[ch]) * f) * lum;
      od.data[i * 4 + 3] = 255;
    }
    g.putImageData(od, 0, 0); return c;
  };
  return { photo, makeGreen, dem, dmin, vegAt };
}

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
// The soil wall: dark top, the measured 0-30 cm (dashed line), subsoil, roots, and the wet band from below
function soilTexture(wetT) {
  const W = 512, H = 512, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), r = rng(7);
  const band = (t0, t1, a, b) => { const gr = g.createLinearGradient(0, t0 * H, 0, t1 * H); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, t0 * H, W, (t1 - t0) * H + 1); };
  band(0, 0.12, "#2A1D14", "#3A2919"); band(0.12, 0.3, "#4E3622", "#6A4A2E"); band(0.3, 1, "#7A5636", "#94714A");
  for (let i = 0; i < 1400; i++) { const y = r() * H, x = r() * W; g.fillStyle = `rgba(${y < H * 0.3 ? "20,12,6" : "60,40,22"},${0.25 + r() * 0.3})`; g.beginPath(); g.ellipse(x, y, 1 + r() * 2.5, 0.8 + r() * 1.6, r() * 3, 0, 7); g.fill(); }
  g.strokeStyle = "rgba(226,208,170,.55)"; g.lineCap = "round";
  for (let i = 0; i < 34; i++) { let x = r() * W, y = 0; const len = H * (0.12 + r() * 0.26); g.lineWidth = 1 + r() * 1.4; g.beginPath(); g.moveTo(x, y); while (y < len) { y += 6; x += (r() - 0.5) * 5; g.lineTo(x, y); } g.stroke(); }
  if (wetT < 1) {
    const gr = g.createLinearGradient(0, wetT * H, 0, H); gr.addColorStop(0, "rgba(74,127,193,.35)"); gr.addColorStop(0.25, "rgba(74,127,193,.62)"); gr.addColorStop(1, "rgba(52,96,160,.8)");
    g.fillStyle = gr; g.fillRect(0, wetT * H, W, H);
    g.strokeStyle = "#9CC4F0"; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= W; x += 8) g.lineTo(x, wetT * H + Math.sin(x / 26) * 3); g.stroke();
  }
  g.setLineDash([10, 8]); g.strokeStyle = "rgba(243,240,229,.55)"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0.3 * H); g.lineTo(W, 0.3 * H); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

const inside = (x, z, poly) => { let o = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) o = !o; } return o; };

// Mounts the scene in `stage` (which also holds `labelsEl`). opts: lat, lon (centre), lot [[lon,lat]...], state getters.
// Returns setters the page calls; the scene repaints only while something moves.
export async function mountSoil3d(stage, labelsEl, opts) {
  const { lat, lon, lot } = opts, k = Math.PI / 180;
  const toXZ = ([lo, la]) => [(lo - lon) * Math.cos(lat * k) * 111320, -(la - lat) * 110574];
  const poly = lot.map(toXZ), xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const span = Math.max(60, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const dist = Math.max(480, span * 3.3), S = Math.max(3200, dist * 5), small = innerWidth < 700;
  const area = await loadArea(lat, lon, S, S > 3600 || small ? 16 : 17, small ? 2048 : 4096);
  if (!stage.isConnected) return null;

  const canvas = document.createElement("canvas"); stage.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 1, S * 4);
  // haze hides the far edge of the tile, like looking across the fields
  scene.fog = new THREE.Fog(0xdcd9c8, dist * 2, dist * 4.2);
  scene.add(new THREE.HemisphereLight(0xfbfaf4, 0x3a2919, 1.25));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.8); sun.position.set(-600, 900, 300); scene.add(sun);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enablePan: false, maxPolarAngle: 1.18, minPolarAngle: 0.35, minDistance: dist * 0.45, maxDistance: dist * 1.7 });

  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const photoTex = tex(area.photo); let greenTex = null;
  const uvOf = (x, z) => [0.5 + x / S, 0.5 + z / S];
  const st = { month: 0, ex: 3, mode: "foto", water: true, lifted: true, wet: 0.5, flood: 0, hi: null };
  const hf = (x, z) => { const [u, v] = uvOf(x, z); return (area.dem(u, v) - area.dmin) * st.ex + area.vegAt(u, v) * 4; };
  const lift = () => (st.lifted ? span * 0.25 : 0), depth = span * 0.2;
  let root = new THREE.Group(), lotGroup = null, labels = [];
  scene.add(root);

  function surface(R, x0, z0, size, keep, matOpts) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const x = x0 + (size * i) / (R - 1), z = z0 + (size * j) / (R - 1), [u, v] = uvOf(x, z); pos.push(x, hf(x, z), z); uv.push(u, 1 - v); }
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < R - 1; i++) {
      const cx = x0 + (size * (i + 0.5)) / (R - 1), cz = z0 + (size * (j + 0.5)) / (R - 1);
      if (keep && !keep(cx, cz)) continue;
      const a = j * R + i, b = a + 1, c = a + R, d = c + 1; idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.95, ...matOpts }));
  }
  function walls(soil) {
    const pos = [], uv = [], idx = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(len / 2)), base = pos.length / 3;
      for (let s = 0; s <= n; s++) { const f = s / n, x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f; pos.push(x, hf(x, z), z, x, -depth, z); uv.push((f * len) / depth, 1, (f * len) / depth, 0); }
      for (let s = 0; s < n; s++) { const q = base + s * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    });
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: soil, roughness: 1, side: THREE.DoubleSide }));
  }

  function build() {
    root.traverse((o) => { o.geometry?.dispose(); if (o.material) { if (o.material.map && o.material.map !== photoTex && o.material.map !== greenTex) o.material.map.dispose(); o.material.dispose(); } });
    scene.remove(root); root = new THREE.Group(); scene.add(root);
    const map = st.mode === "verdor" ? (greenTex ??= tex(area.makeGreen())) : photoTex, soil = soilTexture(1 - st.wet * 0.72);
    root.add(surface(small ? 201 : 321, -S / 2, -S / 2, S, null, { map }));
    // where the plot was: a dark patch on the field, under the lifted plot
    const x0 = Math.min(...xs), z0 = Math.min(...zs), RL = 120;
    const pit = surface(RL, x0, z0, span, (x, z) => inside(x, z, poly), { color: 0x241811, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    root.add(pit);
    lotGroup = new THREE.Group();
    lotGroup.add(surface(RL, x0, z0, span, (x, z) => inside(x, z, poly), { map }), walls(soil));
    const pts = poly.flatMap((a, i) => { const b = poly[(i + 1) % poly.length]; return Array.from({ length: 24 }, (_, s) => { const f = s / 24, x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f; return new THREE.Vector3(x, hf(x, z) + span * 0.008, z); }); });
    lotGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0), 400, Math.max(1, span * 0.011), 6, true), new THREE.MeshBasicMaterial({ color: 0xc8ff9e })));
    lotGroup.position.y = lift() + 0.6; lotGroup.userData.target = lotGroup.position.y;
    root.add(lotGroup);
    // water fills the lowest ground first
    const hs = []; for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) hs.push((area.dem(i / 60, j / 60) - area.dmin) * st.ex); hs.sort((a, b) => a - b);
    if (st.water && st.flood > 0) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ color: 0x4a7fc1, transparent: true, opacity: 0.62, roughness: 0.2 }));
      w.rotation.x = -Math.PI / 2; w.position.y = hs[Math.floor(st.flood * (hs.length - 1))] + 0.4; root.add(w);
    }
    // labels: the plot, its soil, the lowest ground near it
    let low = null;
    for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) { const x = -span * 0.9 + (span * 2.1 * i) / 24, z = span * 0.6 + (span * 0.9 * j) / 24, [u, v] = uvOf(x, z), zz = area.dem(u, v); if (!low || zz < low.zz) low = { x, z, zz }; }
    const east = poly.reduce((a, p) => (p[0] > a[0] ? p : a)), south = poly.reduce((a, p) => (p[1] > a[1] ? p : a));
    const L = opts.labels();
    setLabels([
      { key: "lot", cls: "lot", k: L.lot, v: L.lotSub, pos: () => new THREE.Vector3(east[0], hf(east[0], east[1]) + lotGroup.position.y + span * 0.05, east[1]) },
      { key: "soil", cls: "left", k: L.cut, v: L.soil, pos: () => new THREE.Vector3(south[0], lotGroup.position.y - depth * 0.45, south[1]) },
      { key: "water", cls: "water left", k: L.waterK, v: L.waterV, pos: () => new THREE.Vector3(low.x, hf(low.x, low.z) + 2, low.z) },
    ]);
    request();
  }

  function setLabels(list) {
    labelsEl.replaceChildren(); labels = list.map((l) => {
      const el = document.createElement("div"); el.className = `s3-lbl ${l.cls || ""}${st.hi === l.key ? " on" : ""}`;
      el.innerHTML = `<span class="dot"></span><span class="ln"></span><span class="tx"><small></small><b></b></span>`;
      el.querySelector("small").textContent = l.k; el.querySelector("b").textContent = l.v;
      labelsEl.append(el); return { ...l, el };
    });
  }
  const v3 = new THREE.Vector3();
  function placeLabels() {
    const W = stage.clientWidth, H = stage.clientHeight;
    for (const l of labels) {
      v3.copy(l.pos()).project(camera);
      const x = ((v3.x + 1) / 2) * W, y = ((1 - v3.y) / 2) * H, left = l.cls.includes("left");
      l.el.style.transform = `translate(${left ? x - l.el.offsetWidth : x}px, ${y - l.el.offsetHeight / 2}px)`;
      l.el.style.opacity = v3.z < 1 ? 1 : 0;
    }
  }

  let raf = 0;
  const request = () => { raf ||= requestAnimationFrame(frame); };
  function frame() {
    raf = 0;
    if (!stage.isConnected) return destroy();
    let moving = controls.update();
    if (lotGroup && Math.abs(lotGroup.position.y - lotGroup.userData.target) > 0.1) { lotGroup.position.y += (lotGroup.userData.target - lotGroup.position.y) * 0.16; moving = true; }
    renderer.render(scene, camera); placeLabels();
    if (moving) request();
  }
  controls.addEventListener("change", request);
  const resize = () => {
    // the observer also fires when the view is swapped out: that is the moment to free the GPU
    if (!stage.isConnected) return destroy();
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = camera.aspect < 1 ? 50 : camera.aspect < 1.5 ? 42 : 36; camera.updateProjectionMatrix(); request();
  };
  const ro = new ResizeObserver(resize); ro.observe(stage);
  let dead = false;
  function destroy() {
    if (dead) return; dead = true;
    cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
    root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    photoTex.dispose(); greenTex?.dispose(); renderer.dispose();
  }

  const dir = new THREE.Vector3(-0.42, 0.43, 0.8).normalize();
  controls.target.set(span * 0.05, span * 0.1, span * 0.1);
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  resize();

  return {
    // wet: 0 dry .. 1 soaked (soil wall band); flood: share of the ground under water
    update(p) { Object.assign(st, p); build(); },
    lift(on) { st.lifted = on; if (lotGroup) { lotGroup.userData.target = lift() + 0.6; request(); } },
    highlight(key) { st.hi = key; labels.forEach((l) => l.el.classList.toggle("on", l.key === key)); },
  };
}
