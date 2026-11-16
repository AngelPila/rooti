// "Su terreno" in 3D: the satellite photo laid flat, the farmer's plot standing up out of it as a block of its own soil,
// and the roofs read from the same photo raised as low blocks. three.js from jsDelivr (+esm so OrbitControls shares three).
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
const inside = (x, z, poly) => { let o = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) o = !o; } return o; };
// Distance from a point to the polygon's edge, so roofs are not raised on the plot or right against it
const nearEdge = (x, z, poly, d) => poly.some((a, i) => { const b = poly[(i + 1) % poly.length], vx = b[0] - a[0], vz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1))); return Math.hypot(x - a[0] - t * vx, z - a[1] - t * vz) < d; });

async function loadArea(lat, lon, S, zImg, outPx, poly, step) {
  const photo = document.createElement("canvas"); photo.width = photo.height = outPx;
  const pg = photo.getContext("2d", { willReadFrequently: true });
  const m = await mosaic(lat, lon, zImg, S, ESRI);
  pg.drawImage(m.c, m.sx, m.sy, m.sw, m.sw, 0, 0, outPx, outPx);
  step("relief");
  // Low ground from SRTM: 0 = lowest, 1 = highest in the area; null without relief data
  const DG = 256; let low = null;
  try {
    const d = await mosaic(lat, lon, 14, S, DEM), W = d.c.width, H = d.c.height, px = d.c.getContext("2d").getImageData(0, 0, W, H).data;
    // Terrarium has spike pixels (water, towers): clip to the 3rd-97th percentile, then smooth twice
    let z = new Float32Array(W * H); for (let i = 0; i < W * H; i++) z[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    const so = Float32Array.from(z).sort(), lo = so[Math.floor(so.length * 0.03)], hi = so[Math.floor(so.length * 0.97)];
    z = box3(box3(z.map((v) => Math.min(hi, Math.max(lo, v))), W, H), W, H);
    low = new Float32Array(DG * DG);
    for (let j = 0; j < DG; j++) for (let i = 0; i < DG; i++) { const x = Math.round(d.sx + (i / (DG - 1)) * d.sw), y = Math.round(d.sy + (j / (DG - 1)) * d.sw); low[j * DG + i] = (z[Math.min(H - 1, y) * W + Math.min(W - 1, x)] - lo) / Math.max(0.01, hi - lo); }
  } catch { /* no relief data: no water */ }
  // Roofs: little green and busy texture (towns), which smooth fields and clouds are not; lone specks in a field are dropped
  const R = 600, cell = S / R, sm = document.createElement("canvas"); sm.width = sm.height = R;
  const sg = sm.getContext("2d", { willReadFrequently: true }); sg.drawImage(photo, 0, 0, R, R);
  const p = sg.getImageData(0, 0, R, R).data, lum = new Float32Array(R * R), exg = new Float32Array(R * R), cand = new Uint8Array(R * R), roofs = [];
  for (let i = 0; i < R * R; i++) { const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2]; lum[i] = (r + g + b) / 3; exg[i] = (2 * g - r - b) / (r + g + b + 1); }
  for (let y = 1; y < R - 1; y++) for (let x = 1; x < R - 1; x++) {
    const i = y * R + x; let s = 0, s2 = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = lum[i + dy * R + dx]; s += v; s2 += v * v; }
    if (exg[i] < 0.03 && Math.sqrt(Math.max(0, s2 / 9 - (s / 9) ** 2)) > 22 && lum[i] > 95 && lum[i] < 235) cand[i] = 1;
  }
  for (let y = 3; y < R - 3; y++) for (let x = 3; x < R - 3; x++) {
    const i = y * R + x; if (!cand[i]) continue;
    let n = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) n += cand[i + dy * R + dx];
    const wx = (x + 0.5) * cell - S / 2, wz = (y + 0.5) * cell - S / 2;
    if (n < 4 || inside(wx, wz, poly) || nearEdge(wx, wz, poly, 8)) continue;
    const hsh = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    roofs.push([wx, wz, cell * 1.02, 4.5 + (hsh - Math.floor(hsh)) * 6]);
  }
  return { photo, low, DG, roofs };
}

function greenCanvas(photo) {
  const N = 2048, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(photo, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N), ramp = [[0, [120, 96, 66]], [0.25, [205, 191, 140]], [0.5, [174, 201, 174]], [0.75, [84, 150, 92]], [1, [200, 255, 158]]];
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], gg = d.data[i + 1], b = d.data[i + 2], t = Math.min(1, Math.max(0, ((2 * gg - r - b) / (r + gg + b + 1) + 0.05) / 0.3));
    let k = 0; while (k < ramp.length - 2 && t > ramp[k + 1][0]) k++;
    const [a0, c0] = ramp[k], [a1, c1] = ramp[k + 1], f = (t - a0) / (a1 - a0), l = 0.55 + (0.45 * (r + gg + b)) / 765;
    for (let ch = 0; ch < 3; ch++) d.data[i + ch] = (c0[ch] + (c1[ch] - c0[ch]) * f) * l;
  }
  g.putImageData(d, 0, 0); return c;
}
// Blue where the ground is lowest; `flood` is the share of the area under water
function waterCanvas(low, DG, flood) {
  const c = document.createElement("canvas"); c.width = c.height = DG;
  if (!low || flood <= 0) return c;
  const lv = Float32Array.from(low).sort()[Math.floor(flood * (DG * DG - 1))], g = c.getContext("2d"), im = g.createImageData(DG, DG);
  for (let i = 0; i < DG * DG; i++) { const a = Math.max(0, Math.min(1, (lv - low[i]) / 0.03 + 0.5)); im.data[i * 4] = 74; im.data[i * 4 + 1] = 127; im.data[i * 4 + 2] = 193; im.data[i * 4 + 3] = a * 150; }
  g.putImageData(im, 0, 0); return c;
}
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
// The soil wall coloured from the data: texture sets the earth, organic matter darkens the top. Only 0-30 cm is measured
// (dashed line); below it the wall is hatched and faded, a drawing to find your way. Roots and the wet band from below.
function soilCanvas(wetT, look = { top: "#2A1D14", mid: "#5A3E26", base: "#94714A" }) {
  const W = 512, H = 512, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), r = rng(7);
  const band = (t0, t1, a, b) => { const gr = g.createLinearGradient(0, t0 * H, 0, t1 * H); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, t0 * H, W, (t1 - t0) * H + 1); };
  band(0, 0.12, look.top, look.top); band(0.12, 0.3, look.mid, look.base); band(0.3, 1, look.base, look.base);
  g.fillStyle = "rgba(243,240,229,.28)"; g.fillRect(0, 0.3 * H, W, H);
  g.strokeStyle = "rgba(60,40,22,.22)"; g.lineWidth = 2; for (let x = -H; x < W; x += 18) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 0.7 * H, 0.3 * H); g.stroke(); }
  for (let i = 0; i < 1400; i++) { const y = r() * H, x = r() * W; g.fillStyle = `rgba(${y < H * 0.3 ? "20,12,6" : "60,40,22"},${0.25 + r() * 0.3})`; g.beginPath(); g.ellipse(x, y, 1 + r() * 2.5, 0.8 + r() * 1.6, r() * 3, 0, 7); g.fill(); }
  g.strokeStyle = "rgba(226,208,170,.55)"; g.lineCap = "round";
  for (let i = 0; i < 34; i++) { let x = r() * W, y = 0; const len = H * (0.12 + r() * 0.26); g.lineWidth = 1 + r() * 1.4; g.beginPath(); g.moveTo(x, y); while (y < len) { y += 6; x += (r() - 0.5) * 5; g.lineTo(x, y); } g.stroke(); }
  if (wetT < 1) {
    const gr = g.createLinearGradient(0, wetT * H, 0, H); gr.addColorStop(0, "rgba(74,127,193,.35)"); gr.addColorStop(0.25, "rgba(74,127,193,.62)"); gr.addColorStop(1, "rgba(52,96,160,.8)");
    g.fillStyle = gr; g.fillRect(0, wetT * H, W, H);
    g.strokeStyle = "#9CC4F0"; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= W; x += 8) g.lineTo(x, wetT * H + Math.sin(x / 26) * 3); g.stroke();
  }
  g.setLineDash([10, 8]); g.strokeStyle = "rgba(243,240,229,.55)"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0.3 * H); g.lineTo(W, 0.3 * H); g.stroke();
  return c;
}

// Mounts the scene in `stage` (which also holds `labelsEl`). opts: lat, lon (centre), lot [[lon,lat]...], labels() for the label words.
// Returns setters the page calls; the scene repaints only while something moves.
export async function mountSoil3d(stage, labelsEl, opts) {
  const { lat, lon, lot } = opts, k = Math.PI / 180;
  const toXZ = ([lo, la]) => [(lo - lon) * Math.cos(lat * k) * 111320, -(la - lat) * 110574];
  const poly = lot.map(toXZ), xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const span = Math.max(60, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const dist = Math.max(500, span * 3.6), S = Math.max(3000, dist * 4.5), small = innerWidth < 700;
  const H = span * 0.26; // how far the plot stands up, drawn tall on purpose
  const step = opts.onStep || (() => {});
  const area = await loadArea(lat, lon, S, S > 3600 || small ? 16 : 17, small ? 2048 : 4096, poly, step);
  step("build");
  if (!stage.isConnected) return null;

  const canvas = document.createElement("canvas"); stage.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 1, S * 4);
  // haze hides the far edge of the photo, like looking across the fields
  scene.fog = new THREE.Fog(0xdcd9c8, dist * 1.9, dist * 3.6);
  scene.add(new THREE.HemisphereLight(0xfbfaf4, 0x3a2919, 1.2));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.9); sun.position.set(-500, 800, 300); scene.add(sun);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enablePan: false, maxPolarAngle: 1.2, minPolarAngle: 0.35, minDistance: dist * 0.4, maxDistance: dist * 1.8 });

  const tex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const photoTex = tex(area.photo); let greenTex = null;
  const st = { mode: "foto", water: true, roofs: true, lifted: true, wet: 0.5, flood: 0, hi: null };
  const uvOf = (x, z) => [0.5 + x / S, 0.5 - z / S];

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: photoTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const roofGeo = new THREE.BoxGeometry(1, 1, 1); roofGeo.translate(0, 0.5, 0);
  const roofMesh = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xe9e3d3, roughness: 0.9 }), Math.max(1, area.roofs.length));
  const mtx = new THREE.Matrix4();
  area.roofs.forEach(([x, z, w, h], i) => { mtx.makeScale(w, h, w); mtx.setPosition(x, 0, z); roofMesh.setMatrixAt(i, mtx); });
  roofMesh.count = area.roofs.length; scene.add(roofMesh);

  // The plot: its top is the same photo, its sides its soil; built at height 1 and scaled to stand up
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const topGeo = new THREE.ShapeGeometry(shape), tp = topGeo.attributes.position, tuv = topGeo.attributes.uv;
  for (let i = 0; i < tp.count; i++) { const [u, v] = uvOf(tp.getX(i), -tp.getY(i)); tuv.setXY(i, u, v); }
  const lotGroup = new THREE.Group(); scene.add(lotGroup);
  const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ map: photoTex, roughness: 0.95, side: THREE.DoubleSide })); top.rotation.x = -Math.PI / 2; lotGroup.add(top);
  const wallPos = [], wallUv = [], wallIdx = [];
  let run = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), q = wallPos.length / 3;
    wallPos.push(a[0], 1, a[1], a[0], 0, a[1], b[0], 1, b[1], b[0], 0, b[1]);
    wallUv.push(run / 60, 1, run / 60, 0, (run + len) / 60, 1, (run + len) / 60, 0); run += len;
    wallIdx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
  });
  const wallGeo = new THREE.BufferGeometry(); wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(wallPos, 3)); wallGeo.setAttribute("uv", new THREE.Float32BufferAttribute(wallUv, 2)); wallGeo.setIndex(wallIdx); wallGeo.computeVertexNormals();
  const soilTex = tex(soilCanvas(0.5, opts.look)); soilTex.wrapS = THREE.RepeatWrapping;
  const walls = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ map: soilTex, roughness: 1, side: THREE.DoubleSide })); lotGroup.add(walls);
  const ring = (y, r) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(poly.map(([x, z]) => new THREE.Vector3(x, y, z)), true, "catmullrom", 0), poly.length * 24, r, 6, true), new THREE.MeshBasicMaterial({ color: 0xc8ff9e }));
  const rim = ring(0, Math.max(1, span * 0.01)); lotGroup.add(rim);
  const foot = ring(0.4, Math.max(0.6, span * 0.005)); foot.material.transparent = true; foot.material.opacity = 0.6; scene.add(foot);
  let waterMesh = null, h = H;
  const setHeight = (v) => { h = v; top.position.y = v; walls.scale.y = v; rim.position.y = v + 0.3; };
  setHeight(H);

  let labels = [];
  const nearRoof = area.roofs.reduce((a, r) => { const d = Math.hypot(r[0], r[1]); return d > span * 1.5 && (!a || d < Math.hypot(a[0], a[1])) ? r : a; }, null);
  // looking across the plot towards the town when there is one, else from the south-east
  const toTown = nearRoof ? new THREE.Vector3(-nearRoof[0], 0, -nearRoof[1]).normalize() : new THREE.Vector3(0.5, 0, 0.85).normalize();
  const dir = new THREE.Vector3(toTown.x * 0.9, 0.45, toTown.z * 0.9).normalize();
  const towardCam = (p) => p[0] * dir.x + p[1] * dir.z;
  // labels spread out: the plot's name on its far corner, the soil on the wall facing the camera, the water in front
  const far = poly.reduce((a, p) => (towardCam(p) < towardCam(a) ? p : a)), near = poly.reduce((a, p) => (towardCam(p) > towardCam(a) ? p : a));
  const lowSpot = (() => {
    if (!area.low) return null;
    let best = null;
    for (let j = 0; j <= 30; j++) for (let i = 0; i <= 30; i++) {
      const x = -span * 2.5 + (span * 5 * i) / 30, z = -span * 2.5 + (span * 5 * j) / 30;
      if (towardCam([x, z]) < span * 0.4 || towardCam([x, z]) > span * 1.05 || Math.abs(z * dir.x - x * dir.z) > span * 1.1 || inside(x, z, poly) || nearEdge(x, z, poly, span * 0.4)) continue;
      const [u, v] = uvOf(x, z), gi = Math.round(u * (area.DG - 1)), gj = Math.round((1 - v) * (area.DG - 1)), lv = area.low[gj * area.DG + gi];
      if (!best || lv < best[2]) best = [x, z, lv];
    }
    return best;
  })();
  function setLabels() {
    const L = opts.labels(), list = [
      { key: "lot", cls: "lot", k: L.lot, v: L.lotSub, pos: () => new THREE.Vector3(far[0], h + span * 0.05, far[1]) },
      { key: "soil", cls: "left", k: L.cut, v: L.soil, pos: () => new THREE.Vector3(near[0], h * 0.45, near[1]) },
    ];
    if (lowSpot) list.push({ key: "water", cls: "water left", k: L.waterK, v: L.waterV, pos: () => new THREE.Vector3(lowSpot[0], 2, lowSpot[1]) });
    labelsEl.replaceChildren(); labels = list.map((l) => {
      const el = document.createElement("div"); el.className = `s3-lbl ${l.cls}${st.hi === l.key ? " on" : ""}`;
      el.innerHTML = `<span class="dot"></span><span class="ln"></span><span class="tx"><small></small><b></b></span>`;
      el.querySelector("small").textContent = l.k; el.querySelector("b").textContent = l.v;
      labelsEl.append(el); return { ...l, el };
    });
  }
  const v3 = new THREE.Vector3();
  function placeLabels() {
    const W = stage.clientWidth, Hh = stage.clientHeight;
    for (const l of labels) {
      v3.copy(l.pos()).project(camera);
      const x = ((v3.x + 1) / 2) * W, y = ((1 - v3.y) / 2) * Hh, w = l.el.offsetWidth, pad = 8;
      // on a narrow screen a label flips to the side with room, so it never runs off the edge
      let left = l.cls.includes("left");
      if (left && x - w < pad && x + w <= W - pad) left = false; else if (!left && x + w > W - pad && x - w >= pad) left = true;
      l.el.classList.toggle("left", left);
      const tx = Math.max(pad, Math.min(W - w - pad, left ? x - w : x));
      l.el.style.transform = `translate(${tx}px, ${y - l.el.offsetHeight / 2}px)`;
      l.el.style.opacity = v3.z < 1 ? 1 : 0;
    }
  }
  function build() {
    const map = st.mode === "verdor" ? (greenTex ??= tex(greenCanvas(area.photo))) : photoTex;
    ground.material.map = map; ground.material.needsUpdate = true; top.material.map = map; top.material.needsUpdate = true;
    soilTex.image = soilCanvas(1 - st.wet * 0.72, opts.look); soilTex.needsUpdate = true;
    if (waterMesh) { scene.remove(waterMesh); waterMesh.geometry.dispose(); waterMesh.material.map.dispose(); waterMesh.material.dispose(); waterMesh = null; }
    if (st.water && st.flood > 0 && area.low) {
      waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshBasicMaterial({ map: tex(waterCanvas(area.low, area.DG, st.flood), false), transparent: true, depthWrite: false }));
      waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.y = 0.3; scene.add(waterMesh);
    }
    roofMesh.visible = st.roofs;
    setLabels(); request();
  }

  let raf = 0, dead = false;
  const request = () => { if (!dead) raf ||= requestAnimationFrame(frame); };
  function frame() {
    raf = 0;
    if (!stage.isConnected) return destroy();
    let moving = controls.update();
    const target = st.lifted ? H : 1;
    if (Math.abs(h - target) > 0.05) { setHeight(h + (target - h) * 0.16); moving = true; }
    renderer.render(scene, camera); placeLabels();
    if (moving) request();
  }
  controls.addEventListener("change", request);
  const resize = () => {
    // the observer also fires when the view is swapped out: that is the moment to free the GPU
    if (!stage.isConnected) return destroy();
    const w = stage.clientWidth, hh = stage.clientHeight; if (!w || !hh) return;
    renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.fov = camera.aspect < 1 ? 50 : camera.aspect < 1.5 ? 42 : 36; camera.updateProjectionMatrix(); request();
  };
  const ro = new ResizeObserver(resize); ro.observe(stage);
  function destroy() {
    if (dead) return; dead = true;
    cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
    scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    [photoTex, greenTex, soilTex, waterMesh?.material.map].forEach((t) => t?.dispose()); renderer.dispose();
  }

  controls.target.set(0, H * 0.3, 0);
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  resize();

  return {
    // wet: 0 dry .. 1 soaked (soil wall band); flood: share of the ground under water
    update(p) { Object.assign(st, p); build(); },
    lift(on) { st.lifted = on; request(); },
    highlight(key) { st.hi = key; labels.forEach((l) => l.el.classList.toggle("on", l.key === key)); },
  };
}
