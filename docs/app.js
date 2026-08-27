// app.js — Stover PWA
// Browser port of the Stover desktop app: classifies crop residue, green canopy,
// and bare soil per pixel with a U-Net (ONNX) running client-side via onnxruntime-web.
// UI shell adapted from the Canopeo web app (results table, lightbox, theme toggle).

(() => {
'use strict';

// ── Constants ─────────────────────────────────────────────────────────
const VERSION          = '1.0.0';
const MODEL_VERSION    = '20260824';   // date-stamp of the deployed U-Net (shown in the PDF report)
const MODEL_URL        = './model.onnx';
const NET_SIDE         = 512;   // model input/output side (fixed)
const DISPLAY_MAX_SIDE = 800;   // px — on-screen preview cap (longest side)
const THUMB_MAX_SIDE   = 96;    // px — thumbnail size in results table
const LB_MAX_SIDE      = 800;   // px — lightbox image max side

// Class order MUST match training: 0 = soil, 1 = plant, 2 = residue.
// Colors match the manuscript's relabel_image(): soil maroon, plant green, residue yellow.
// Model's typical 95% range per class (±1.96 SD of per-image cover error on the test set),
// in percentage points. Reported uniformly as the expected uncertainty for any single image.
const CLASS_CI = { residue: 4.0, plant: 1.1, soil: 3.8 };

const CLASS_RGB = [
  [165, 42, 42],   // 0 soil
  [0, 200, 0],     // 1 plant / canopy
  [255, 212, 0],   // 2 residue
];

// ── State ─────────────────────────────────────────────────────────────
const state = {
  files:         [],
  currentIndex:  -1,
  alpha:         0.30,        // 0..1; slider is 0..100
  overlayMode:   'classes',   // 'classes' | 'original'
  current:       null,        // decoded/classified cache for the displayed image
  batchResults:  [],          // row objects for the results table
  pendingCsv:    null,        // { blob, name }
  pendingZip:    null,        // { blob, name }
  pendingPdf:    null,        // { blob, name }
  session:       null,        // ORT InferenceSession
  modelReady:    false,
  backend:       '',          // 'webgpu' | 'wasm' — active execution provider
  threads:       1,           // WASM thread count (>1 requires cross-origin isolation)
  lastMs:        0,           // last single-image inference time (ms)
};

// ── DOM refs ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  loadBtn:        $('load-images-btn'),
  loadLabel:      $('load-label'),
  modelStatus:    $('model-status'),
  fileInput:      $('file-input'),
  prevBtn:        $('prev-btn'),
  nextBtn:        $('next-btn'),
  alphaSlider:    $('alpha-slider'),
  alphaLabel:     $('alpha-label'),
  imageCounter:   $('image-counter-label'),
  imageName:      $('image-name-label'),
  residueCover:   $('residue-cover-label'),
  canopyCover:    $('canopy-cover-label'),
  soilCover:      $('soil-cover-label'),
  residueCi:      $('residue-ci'),
  canopyCi:       $('canopy-ci'),
  soilCi:         $('soil-ci'),
  timestamp:      $('timestamp-label'),
  latitude:       $('latitude-label'),
  longitude:      $('longitude-label'),
  device:         $('device-label'),
  sizeLabel:      $('size-label'),
  mpxLabel:       $('mpx-label'),
  outputTable:    $('output-table'),
  outputPdf:      $('output-pdf'),
  outputBlended:  $('output-blended'),
  outputMask:     $('output-mask'),
  outputUncert:   $('output-uncert'),   // [uncertainty]
  reportFields:   $('report-fields'),
  projectName:    $('project-name'),
  observations:   $('observations'),
  processBtn:     $('process-btn'),
  progressFill:   $('progress-fill'),
  progressLabel:  $('progress-label'),
  canvas:         $('display-canvas'),
  emptyState:     $('empty-state'),
  imageContainer: $('image-container'),
  toast:          $('toast'),
  aboutVersion:   $('about-version'),
  themeToggle:    $('theme-toggle'),
  installBtn:     $('install-btn'),
  resultsSection: $('results-section'),
  resultsBody:    $('results-body'),
  resultsCount:   $('results-count'),
  clearBtn:       $('clear-btn'),
  dlCsvBtn:       $('dl-csv-btn'),
  dlZipBtn:       $('dl-zip-btn'),
  dlPdfBtn:       $('dl-pdf-btn'),
  lightbox:       $('lightbox'),
  lightboxImg:    $('lightbox-img'),
  lightboxClose:  $('lightbox-close'),
};

const canvasCtx = dom.canvas.getContext('2d', { willReadFrequently: true });

// ── Theme ─────────────────────────────────────────────────────────────
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  dom.themeToggle.textContent = theme === 'dark' ? '☀' : '☾';
  dom.themeToggle.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  try { localStorage.setItem('stover-theme', theme); } catch (_) {}
}

function initTheme() {
  let saved;
  try { saved = localStorage.getItem('stover-theme'); } catch (_) {}
  // Dark is the default; only an explicit saved 'light' preference overrides it.
  setTheme(saved === 'light' ? 'light' : 'dark');
}

// ── Helpers ───────────────────────────────────────────────────────────
function basenameNoExt(name) { return name.replace(/\.[^/.]+$/, ''); }

function showToast(msg, isError = false) {
  dom.toast.textContent = msg;
  dom.toast.classList.toggle('error', isError);
  dom.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { dom.toast.hidden = true; }, 4500);
}

function setMpxLabel(mpx) {
  dom.mpxLabel.textContent = ` (${mpx.toFixed(1)} MPx)`;
  dom.mpxLabel.className = mpx < 5 ? 'mpx-low' : mpx < 20 ? 'mpx-mid' : 'mpx-high';
}

function updateNavEnabled() {
  const has = state.files.length > 0;
  dom.prevBtn.disabled = !has;
  dom.nextBtn.disabled = !has;
  dom.processBtn.disabled = !has || !state.modelReady;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function localStamp() {
  const d = new Date();
  return d.getFullYear() + pad2(d.getMonth()+1) + pad2(d.getDate()) +
         pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

// ── EXIF ──────────────────────────────────────────────────────────────
function formatExifDatetime(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4}):(\d{2}):(\d{2})\s(\d{2}:\d{2}:\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}` : String(raw);
}

function dmsToDecimal(gps, ref) {
  if (!gps || gps.length < 3) return null;
  const dec = Math.round((gps[0] + gps[1]/60 + gps[2]/3600) * 1e6) / 1e6;
  return (ref === 'S' || ref === 'W') ? -dec : dec;
}

function cleanExifStr(s) {
  if (s === null || s === undefined) return null;
  const cleaned = String(s)
    .replace(/\0/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .trim();
  return cleaned || null;
}

function readExifAsync(file) {
  return new Promise(resolve => {
    const empty = { make: null, model: '', datetime: null, lat: null, lon: null, alt: null };
    if (typeof EXIF === 'undefined') { resolve(empty); return; }
    try {
      EXIF.getData(file, function() {
        const make  = cleanExifStr(EXIF.getTag(this, 'Make'));
        const model = cleanExifStr(EXIF.getTag(this, 'Model')) ?? '';
        const datetime = formatExifDatetime(EXIF.getTag(this, 'DateTime'));
        const lat = dmsToDecimal(EXIF.getTag(this, 'GPSLatitude'),  EXIF.getTag(this, 'GPSLatitudeRef'));
        const lon = dmsToDecimal(EXIF.getTag(this, 'GPSLongitude'), EXIF.getTag(this, 'GPSLongitudeRef'));
        const altRaw = EXIF.getTag(this, 'GPSAltitude');
        const alt = (altRaw !== undefined && altRaw !== null) ? Math.trunc(Number(altRaw)) : null;
        resolve({ make, model, datetime, lat, lon, alt });
      });
    } catch(_) { resolve(empty); }
  });
}

// ── Model ─────────────────────────────────────────────────────────────

async function initModel() {
  try {
    if (typeof ort === 'undefined') throw new Error('onnxruntime-web failed to load');
    // Absolute URL to the vendor folder so ORT doesn't resolve the .wasm/.mjs
    // relative to its own script location (which would double the path).
    ort.env.wasm.wasmPaths = new URL('vendor/', location.href).href;
    // WebGPU is the primary execution provider; the WASM path is a single-threaded fallback.
    ort.env.wasm.numThreads = 1;
    state.threads = 1;

    const create = (eps) => ort.InferenceSession.create(MODEL_URL, {
      executionProviders: eps,
      graphOptimizationLevel: 'all',
    });

    // Prefer WebGPU only if a real GPU adapter can actually be acquired — checking
    // for navigator.gpu alone is not enough (the API can exist while no adapter is
    // available, e.g. hardware acceleration disabled or the GPU is blocklisted).
    let adapter = null;
    if ('gpu' in navigator) {
      try { adapter = await navigator.gpu.requestAdapter(); } catch (_) {}
    }
    if (adapter) {
      try {
        state.session = await create(['webgpu']);
        state.backend = 'webgpu';
      } catch (e) {
        console.warn('[stover] WebGPU session failed despite an available adapter; using WASM:', e);
        state.session = await create(['wasm']);
        state.backend = 'wasm';
      }
    } else {
      if ('gpu' in navigator)
        console.warn('[stover] WebGPU is present but no GPU adapter is available — check chrome://gpu and enable hardware acceleration. Falling back to WASM (slow).');
      state.session = await create(['wasm']);
      state.backend = 'wasm';
    }

    // Warm-up: WebGPU compiles shaders / builds kernels on the first run, so do a
    // throwaway inference now — the user's first real image is then fast.
    const t0 = performance.now();
    const warm = new ort.Tensor('float32', new Float32Array(3 * NET_SIDE * NET_SIDE), [1, 3, NET_SIDE, NET_SIDE]);
    await state.session.run({ input: warm });
    const warmMs = Math.round(performance.now() - t0);

    state.modelReady = true;
    dom.modelStatus.textContent = 'Model ready.';
    dom.modelStatus.classList.add('mpx-low');
    console.log(`[stover] backend=${state.backend} threads=${state.threads} warm-up=${warmMs} ms`);
    updateNavEnabled();

    // If the browser exposes WebGPU but we still ended up on the CPU, the GPU
    // couldn't be acquired (accel off, blocklisted driver, RDP…). Offer safe fixes.
    if (state.backend === 'wasm' && 'gpu' in navigator) maybeShowGpuTip();
  } catch (err) {
    dom.modelStatus.textContent = 'Model failed to load — reload the page.';
    dom.modelStatus.classList.add('mpx-high');
    showToast(`Could not load the classification model: ${err.message}`, true);
  }
}

// ── GPU acceleration tip ──────────────────────────────────────────────
function maybeShowGpuTip() {
  try { if (localStorage.getItem('stover-gpu-tip-dismissed') === '1') return; } catch (_) {}
  const modal = $('gpu-modal');
  if (modal) modal.classList.add('open');
}

// ── Classification ────────────────────────────────────────────────────
// Runs the U-Net on a 512x512 RGB canvas and returns a Uint8 label map
// (0=soil, 1=plant, 2=residue) plus per-class cover fractions.

async function classify512(imageData512) {
  const { data } = imageData512;                 // RGBA, 512*512*4
  const N = NET_SIDE * NET_SIDE;
  const input = new Float32Array(3 * N);         // planar CHW, normalized [0,1]
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    input[i]         = data[o]     / 255.0;       // R
    input[i + N]     = data[o + 1] / 255.0;       // G
    input[i + 2 * N] = data[o + 2] / 255.0;       // B
  }
  const tensor = new ort.Tensor('float32', input, [1, 3, NET_SIDE, NET_SIDE]);
  const _t0 = performance.now();
  const result = await state.session.run({ input: tensor });
  state.lastMs = performance.now() - _t0;
  console.log(`[stover] ${state.backend} inference ${state.lastMs.toFixed(0)} ms`);
  const out = (result.output ?? result[Object.keys(result)[0]]).data; // [1,3,512,512]

  const labels = new Uint8Array(N);
  const maxProb = new Float32Array(N); // [uncertainty] softmax prob of the winning class
  const counts = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const s = out[i], p = out[i + N], r = out[i + 2 * N];
    let c = 0, m = s;
    if (p > m) { m = p; c = 1; }
    if (r > m) { m = r; c = 2; }
    labels[i] = c;
    counts[c]++;
    // [uncertainty] top-class softmax probability = 1 / sum(exp(logit - maxLogit))
    maxProb[i] = 1 / (Math.exp(s - m) + Math.exp(p - m) + Math.exp(r - m));
  }
  const cover = {
    soil:    Math.round(counts[0] / N * 1000) / 10,
    plant:   Math.round(counts[1] / N * 1000) / 10,
    residue: Math.round(counts[2] / N * 1000) / 10,
  };
  return { labels, cover, maxProb };
}

// Colored 512x512 class map (opaque). Background classes are all painted.
function buildClassImageData(labels) {
  const N = NET_SIDE * NET_SIDE;
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const [r, g, b] = CLASS_RGB[labels[i]];
    const o = i * 4;
    out[o] = r; out[o+1] = g; out[o+2] = b; out[o+3] = 255;
  }
  return new ImageData(out, NET_SIDE, NET_SIDE);
}

// ── [uncertainty] Uncertainty overlay (magma colormap) ────────────────────
// Per-pixel uncertainty = 1 − (top-class softmax probability), scaled so that a
// perfect 3-way tie maps to 1.0. Dark = the model is confident, bright yellow =
// uncertain (typically along soil↔residue edges and ambiguous thin residue).
// To DELETE this feature: remove this block, the maxProb line in classify512,
// the 'uncertainty' branch in renderBlend, the legend toggle in the overlay-mode
// handler, and the "Uncertainty" radio + #uncert-legend in index.html.
const MAGMA = [[0,0,4],[28,16,68],[79,18,123],[129,37,129],[181,54,122],[229,80,100],[251,135,97],[254,194,135],[252,253,191]];
function magma(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = t * (MAGMA.length - 1), i = Math.floor(x), f = x - i;
  const a = MAGMA[i], b = MAGMA[Math.min(i + 1, MAGMA.length - 1)];
  return [a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f, a[2] + (b[2]-a[2])*f];
}
function buildUncertaintyImageData(maxProb) {
  const N = NET_SIDE * NET_SIDE;
  const out = new Uint8ClampedArray(N * 4);
  const scale = 1 / (1 - 1/3);   // map [0, 2/3] uncertainty onto [0, 1]
  for (let i = 0; i < N; i++) {
    const [r, g, b] = magma((1 - maxProb[i]) * scale);
    const o = i * 4;
    out[o] = r; out[o+1] = g; out[o+2] = b; out[o+3] = 255;
  }
  return new ImageData(out, NET_SIDE, NET_SIDE);
}

// ── Canvas helpers ────────────────────────────────────────────────────

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed.'));
    img.src = url;
  });
}

function drawToCanvas(source, w, h, smooth = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

function imageDataToCanvas(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c;
}

// Resize a source canvas to (w,h). smooth=false keeps class colors crisp.
function resizeCanvas(srcCanvas, w, h, smooth) {
  return drawToCanvas(srcCanvas, w, h, smooth);
}

// ── Image decode ──────────────────────────────────────────────────────
// Replicates the dataset preprocessing (process_new_images.ipynb): center-crop the
// longer side to a centered square, then resize that square to 512x512. Matching
// this at inference is essential — the model was trained on center-cropped squares,
// not on anisotropically squished frames. The display copy is the same cropped
// square, so the 512x512 mask maps onto it 1:1 (no aspect warping).

async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  let img;
  try { img = await loadImageElement(url); }
  finally { URL.revokeObjectURL(url); }

  const ow = img.naturalWidth, oh = img.naturalHeight;

  // Center square crop: side = min(width, height), centered (matches the notebook).
  const side = Math.min(ow, oh);
  const sx = Math.round((ow - side) / 2);
  const sy = Math.round((oh - side) / 2);

  // Network input: cropped square -> 512x512
  const netCanvas = document.createElement('canvas');
  netCanvas.width = NET_SIDE; netCanvas.height = NET_SIDE;
  const nctx = netCanvas.getContext('2d', { willReadFrequently: true });
  nctx.imageSmoothingEnabled = true; nctx.imageSmoothingQuality = 'high';
  nctx.drawImage(img, sx, sy, side, side, 0, 0, NET_SIDE, NET_SIDE);
  const netData = nctx.getImageData(0, 0, NET_SIDE, NET_SIDE);

  // Display: the same cropped square, capped at DISPLAY_MAX_SIDE (square -> mask maps 1:1)
  const dispDim = Math.min(side, DISPLAY_MAX_SIDE);
  const dispCanvas = document.createElement('canvas');
  dispCanvas.width = dispDim; dispCanvas.height = dispDim;
  const dctx = dispCanvas.getContext('2d', { willReadFrequently: true });
  dctx.imageSmoothingEnabled = true; dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(img, sx, sy, side, side, 0, 0, dispDim, dispDim);

  const exif = await readExifAsync(file);

  return {
    filename: file.name,
    netData,
    dispCanvas, dispW: dispDim, dispH: dispDim,
    ow, oh,
    mpx: (ow * oh) / 1_000_000,
    exif,
  };
}

// ── Core classify → blend → render pipeline ──────────────────────────

async function classifyCurrent(updateInfo = true) {
  const c = state.current;
  const { labels, cover, maxProb } = await classify512(c.netData);
  c.labels = labels;
  c.cover = cover;
  c.classCanvas = imageDataToCanvas(buildClassImageData(labels)); // 512x512
  c.maxProb = maxProb;        // [uncertainty]
  c.uncertCanvas = null;      // [uncertainty] built lazily on first view
  if (updateInfo) {
    updateInfoPanel(c);
  }
}

function updateInfoPanel(c) {
  dom.imageCounter.textContent = `${state.currentIndex + 1} / ${state.files.length}`;
  dom.imageName.textContent    = `Filename: ${c.filename}`;
  dom.residueCover.textContent = `${c.cover.residue.toFixed(1)}%`;
  dom.canopyCover.textContent  = `${c.cover.plant.toFixed(1)}%`;
  dom.soilCover.textContent    = `${c.cover.soil.toFixed(1)}%`;
  dom.residueCi.textContent = `± ${CLASS_CI.residue.toFixed(1)}`;
  dom.canopyCi.textContent  = `± ${CLASS_CI.plant.toFixed(1)}`;
  dom.soilCi.textContent    = `± ${CLASS_CI.soil.toFixed(1)}`;
  dom.timestamp.textContent    = `Timestamp: ${c.exif.datetime ?? 'N/A'}`;
  dom.latitude.textContent     = `Latitude: ${c.exif.lat ?? 'N/A'}`;
  dom.longitude.textContent    = `Longitude: ${c.exif.lon ?? 'N/A'}`;
  const device = [c.exif.make, c.exif.model].filter(v => v && String(v).length).join(' ');
  dom.device.textContent = `Device: ${device || 'N/A'}`;
  dom.sizeLabel.textContent = `Image size: ${c.ow}x${c.oh}`;
  setMpxLabel(c.mpx);
}

// Render the display image blended with the class overlay (mask upscaled to display size).
function renderBlend() {
  const c = state.current;
  if (!c) return;
  const W = c.dispW, H = c.dispH;
  dom.canvas.width = W;
  dom.canvas.height = H;

  // Base photo
  canvasCtx.globalAlpha = 1;
  canvasCtx.imageSmoothingEnabled = true;
  canvasCtx.drawImage(c.dispCanvas, 0, 0, W, H);

  // Overlay (skip entirely when Original + 0 opacity, or always draw at alpha)
  if (state.alpha > 0) {
    let overlaySrc;
    if (state.overlayMode === 'classes') {
      overlaySrc = c.classCanvas;
    } else if (state.overlayMode === 'uncertainty') { // [uncertainty]
      if (!c.uncertCanvas) c.uncertCanvas = imageDataToCanvas(buildUncertaintyImageData(c.maxProb));
      overlaySrc = c.uncertCanvas;
    } else {
      overlaySrc = c.dispCanvas;
    }
    canvasCtx.globalAlpha = state.alpha;
    // class colors stay crisp (nearest); continuous overlays can smooth
    canvasCtx.imageSmoothingEnabled = state.overlayMode !== 'classes';
    canvasCtx.drawImage(overlaySrc, 0, 0, W, H);
    canvasCtx.globalAlpha = 1;
  }
  dom.canvas.classList.add('visible');
  dom.emptyState.style.display = 'none';
}

async function showImage(index) {
  if (!state.files.length) return;
  const i = ((index % state.files.length) + state.files.length) % state.files.length;
  state.currentIndex = i;
  try {
    state.current = await prepareImage(state.files[i]);
    await classifyCurrent(true);
  } catch (err) {
    showToast(`Couldn't open "${state.files[i].name}": ${err.message}`, true);
    return;
  }
  renderBlend();
}

// ── Clear / reset ─────────────────────────────────────────────────────

function clearResults() {
  state.batchResults = [];
  state.pendingCsv   = null;
  state.pendingZip   = null;
  state.pendingPdf   = null;
  dom.resultsBody.innerHTML = '';
  dom.resultsCount.textContent = '0';
  dom.resultsSection.hidden = true;
  dom.dlCsvBtn.hidden = true;  dom.dlCsvBtn.disabled = true;
  dom.dlZipBtn.hidden = true;  dom.dlZipBtn.disabled = true;
  dom.dlPdfBtn.hidden = true;  dom.dlPdfBtn.disabled = true;
  dom.progressFill.style.width = '0%';
  dom.progressLabel.textContent = '';
}

function clearAll() {
  state.files = [];
  state.currentIndex = -1;
  state.current = null;
  clearResults();
  dom.canvas.classList.remove('visible');
  dom.emptyState.style.display = '';
  dom.loadLabel.textContent = 'No images loaded';
  dom.imageCounter.textContent = '–';
  dom.imageName.textContent    = 'Filename:';
  dom.residueCover.textContent = '–';
  dom.canopyCover.textContent  = '–';
  dom.soilCover.textContent    = '–';
  dom.residueCi.textContent = '';
  dom.canopyCi.textContent  = '';
  dom.soilCi.textContent    = '';
  dom.timestamp.textContent    = 'Timestamp:';
  dom.latitude.textContent     = 'Latitude:';
  dom.longitude.textContent    = 'Longitude:';
  dom.device.textContent       = 'Device:';
  dom.sizeLabel.textContent    = 'Image size:';
  dom.mpxLabel.textContent     = '';
  dom.mpxLabel.className       = '';
  updateNavEnabled();
}

// ── Results table ─────────────────────────────────────────────────────

function appendResultRow(r) {
  const fv = v => (v !== null && v !== undefined) ? String(v) : '<span class="null-val">—</span>';
  const fc = v => v !== null ? v.toFixed(5) : '<span class="null-val">—</span>';
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${r.index}</td>
    <td><img class="thumb thumb-orig" src="${r.origThumbUrl}" title="Click to zoom" /></td>
    <td><img class="thumb thumb-mask" src="${r.maskThumbUrl}" title="Click to zoom" /></td>
    <td class="col-res"  style="color:#c8a400">${r.cover.residue.toFixed(1)}<span class="pct">%</span></td>
    <td class="col-can"  style="color:#2a9a2a">${r.cover.plant.toFixed(1)}<span class="pct">%</span></td>
    <td class="col-soil" style="color:#a5524a">${r.cover.soil.toFixed(1)}<span class="pct">%</span></td>
    <td class="col-fn" title="${r.filename}">${r.filename}</td>
    <td class="hide-sm">${fv(r.datetime)}</td>
    <td class="hide-sm">${fc(r.lat)}</td>
    <td class="hide-sm">${fc(r.lon)}</td>
  `;

  tr.querySelector('.thumb-orig').addEventListener('click', async () => {
    const prepared = await prepareImage(r.file);
    openLightbox(prepared.dispCanvas.toDataURL('image/jpeg', 0.88));
  });

  tr.querySelector('.thumb-mask').addEventListener('click', async () => {
    const prepared = await prepareImage(r.file);
    const { labels } = await classify512(prepared.netData);
    const classCanvas = imageDataToCanvas(buildClassImageData(labels));
    const up = resizeCanvas(classCanvas, prepared.dispW, prepared.dispH, false);
    openLightbox(up.toDataURL('image/jpeg', 0.88));
  });

  dom.resultsBody.appendChild(tr);
}

// ── Lightbox ──────────────────────────────────────────────────────────

function openLightbox(url) {
  dom.lightboxImg.src = url;
  dom.lightbox.classList.add('open');
}

function closeLightbox() {
  dom.lightbox.classList.remove('open');
  setTimeout(() => { dom.lightboxImg.src = ''; }, 300);
}

// ── Batch export helpers ──────────────────────────────────────────────

function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc  = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n') + '\n';
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(res => canvas.toBlob(res, type, quality));
}

// ── PDF report (client-side, ports the Stover desktop report layout) ──────
// Letter page, 1-inch margins; per image: metadata block on the left, the original
// photo and the class-color mask side by side on the right; page header + footer.

function buildPdfReport(entries, projectName, observations) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  const M = 1, RIGHT = 7.5, CONTENT_W = 6.5, PAGE_MID = 4.25;
  const LINE_H = 0.22, IMG_W = 1.9, IMG_X1 = 3.55, IMG_X2 = 5.55, TOP = 1.15, BOTTOM = 9.7;
  const analysisTs = new Date().toLocaleString();
  let y = TOP;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  if (observations) {
    doc.setTextColor(30);
    const obs = doc.splitTextToSize(`Observations: ${observations}`, CONTENT_W);
    doc.text(obs, M, y); y += obs.length * LINE_H + 0.15;
  }

  for (const e of entries) {
    if (y + IMG_W + 0.3 > BOTTOM) { doc.addPage(); y = TOP; }

    doc.setDrawColor(150); doc.setLineWidth(0.008);
    doc.line(M, y, RIGHT, y);
    y += 0.14;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30);
    doc.text('Original image', IMG_X1, y);
    doc.text('Classified image', IMG_X2, y);

    const imgTop = y + 0.06;
    doc.addImage(e.origUrl, 'JPEG', IMG_X1, imgTop, IMG_W, IMG_W);
    doc.addImage(e.classUrl, 'JPEG', IMG_X2, imgTop, IMG_W, IMG_W);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    const lines = [
      e.filename,
      `Soil: ${e.soil} % (±${CLASS_CI.soil.toFixed(1)})`,
      `Plant: ${e.plant} % (±${CLASS_CI.plant.toFixed(1)})`,
      `Residue: ${e.residue} % (±${CLASS_CI.residue.toFixed(1)})`,
      `Total cover: ${e.totalCover} %`,
      `Timestamp: ${e.datetime}`,
      `Latitude: ${e.lat}`,
      `Longitude: ${e.lon}`,
      `Device: ${e.device}`,
    ];
    let ty = imgTop + 0.16;
    for (const ln of lines) {
      doc.text(doc.splitTextToSize(ln, 2.4), M, ty);
      ty += LINE_H;
    }
    y = Math.max(ty, imgTop + IMG_W) + 0.15;
  }

  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20);
    doc.text('Stover App Report', PAGE_MID, 0.6, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(60);
    const sub = projectName
      ? `Report for ${projectName} created on ${analysisTs} — Page ${p} of ${pages}`
      : `Report created on ${analysisTs} — Page ${p} of ${pages}`;
    doc.text(sub, PAGE_MID, 0.82, { align: 'center' });
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Analyzed with the Stover web app and U-Net model v${MODEL_VERSION}`, PAGE_MID, 10.55, { align: 'center' });
  }
  return doc.output('blob');
}

// ── Batch processing ──────────────────────────────────────────────────

async function processBatch() {
  const wantTable   = dom.outputTable.checked;
  const wantPdf     = dom.outputPdf.checked;
  const wantBlended = dom.outputBlended.checked;
  const wantMask    = dom.outputMask.checked;
  const wantUncert  = dom.outputUncert.checked; // [uncertainty]

  if (!wantTable && !wantPdf && !wantBlended && !wantMask && !wantUncert) {
    showToast('Select at least one output type.', true); return;
  }
  if (!state.files.length || !state.modelReady) return;

  dom.processBtn.disabled = true;
  clearResults();

  const csvRows   = [];
  const pdfEntries = [];
  const zip      = (wantBlended || wantMask || wantUncert) ? new JSZip() : null;
  const saved    = state.currentIndex;
  const n        = state.files.length;

  try {
    for (let i = 0; i < n; i++) {
      const pct = Math.round(i / n * 100);
      dom.progressFill.style.width = pct + '%';
      dom.progressLabel.textContent = `Progress: ${pct} %`;

      let img;
      try { img = await prepareImage(state.files[i]); }
      catch (_) { continue; }

      const { labels, cover, maxProb } = await classify512(img.netData);
      const baseName = basenameNoExt(img.filename);
      const classCanvas = imageDataToCanvas(buildClassImageData(labels)); // 512x512

      // Thumbnails for results table
      const origThumb = resizeCanvas(img.dispCanvas, ...fitBox(img.dispW, img.dispH, THUMB_MAX_SIDE), true);
      const maskThumb = resizeCanvas(classCanvas,    ...fitBox(img.dispW, img.dispH, THUMB_MAX_SIDE), false);
      const origThumbUrl = origThumb.toDataURL('image/jpeg', 0.78);
      const maskThumbUrl = maskThumb.toDataURL('image/jpeg', 0.78);

      const result = {
        index: state.batchResults.length + 1,
        file: state.files[i],
        cover, filename: img.filename,
        datetime: img.exif.datetime, lat: img.exif.lat, lon: img.exif.lon,
        origThumbUrl, maskThumbUrl,
      };

      state.batchResults.push(result);
      appendResultRow(result);
      dom.resultsCount.textContent = String(state.batchResults.length);
      if (state.batchResults.length === 1) dom.resultsSection.hidden = false;

      if (wantTable) {
        csvRows.push({
          file_name: img.filename, mpx: img.mpx,
          image_size: `${img.ow}x${img.oh}`,
          residue_cover: cover.residue,
          canopy_cover: cover.plant,
          soil_cover: cover.soil,
          latitude: img.exif.lat, longitude: img.exif.lon, altitude: img.exif.alt,
          device_maker: img.exif.make, device_model: img.exif.model,
          image_timestamp: img.exif.datetime,
        });
      }

      if (wantPdf) {
        const device = [img.exif.make, img.exif.model].filter(v => v && String(v).length).join(' ');
        pdfEntries.push({
          filename: img.filename,
          soil: cover.soil.toFixed(1), plant: cover.plant.toFixed(1), residue: cover.residue.toFixed(1),
          totalCover: (cover.plant + cover.residue).toFixed(1),
          datetime: img.exif.datetime ?? 'N/A',
          lat: img.exif.lat ?? 'N/A', lon: img.exif.lon ?? 'N/A',
          device: device || 'N/A',
          origUrl:  img.dispCanvas.toDataURL('image/jpeg', 0.85),
          classUrl: classCanvas.toDataURL('image/jpeg', 0.9),
        });
      }

      if (zip) {
        if (wantMask) {
          const maskBlob = await canvasToBlob(classCanvas, 'image/png');
          zip.file(`mask_${baseName}.png`, maskBlob);
        }
        if (wantUncert) { // [uncertainty]
          const uncertCanvas = imageDataToCanvas(buildUncertaintyImageData(maxProb));
          const uncertBlob = await canvasToBlob(uncertCanvas, 'image/png');
          zip.file(`uncertainty_${baseName}.png`, uncertBlob);
        }
        if (wantBlended) {
          // Blend photo + class overlay at display resolution
          const up = resizeCanvas(classCanvas, img.dispW, img.dispH, false);
          const blend = document.createElement('canvas');
          blend.width = img.dispW; blend.height = img.dispH;
          const bctx = blend.getContext('2d');
          bctx.drawImage(img.dispCanvas, 0, 0);
          bctx.globalAlpha = state.alpha;
          bctx.imageSmoothingEnabled = false;
          bctx.drawImage(up, 0, 0);
          bctx.globalAlpha = 1;
          const blendedBlob = await canvasToBlob(blend, 'image/jpeg', 0.8);
          zip.file(`blended_${baseName}.jpg`, blendedBlob);
        }
      }

      await new Promise(r => setTimeout(r, 0));
    }

    dom.progressLabel.textContent = 'Building outputs…';
    await new Promise(r => setTimeout(r, 0));

    const stamp = localStamp();
    const proj = (dom.projectName.value || '').trim();
    const projSlug = proj ? proj.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') + '_' : '';
    if (wantTable && csvRows.length) {
      state.pendingCsv = { blob: new Blob([toCSV(csvRows)], { type: 'text/csv;charset=utf-8' }), name: `Stover_${projSlug}${stamp}.csv` };
    }
    if (wantPdf && pdfEntries.length) {
      dom.progressLabel.textContent = 'Building PDF report…';
      await new Promise(r => setTimeout(r, 0));
      const pdfBlob = buildPdfReport(pdfEntries, proj, (dom.observations.value || '').trim());
      state.pendingPdf = { blob: pdfBlob, name: `Stover_${projSlug}${stamp}.pdf` };
    }
    if (zip) {
      state.pendingZip = { blob: await zip.generateAsync({ type: 'blob', compression: 'STORE' }), name: `Stover_${projSlug}${stamp}.zip` };
    }

    dom.dlCsvBtn.hidden    = false;
    dom.dlCsvBtn.disabled  = !state.pendingCsv;
    dom.dlCsvBtn.title     = state.pendingCsv ? 'Download CSV' : 'Enable "Table (CSV)" before processing to generate this';
    dom.dlPdfBtn.hidden    = false;
    dom.dlPdfBtn.disabled  = !state.pendingPdf;
    dom.dlPdfBtn.title     = state.pendingPdf ? 'Download PDF report' : 'Enable "PDF report" before processing to generate this';
    dom.dlZipBtn.hidden    = false;
    dom.dlZipBtn.disabled  = !state.pendingZip;
    dom.dlZipBtn.title     = state.pendingZip ? 'Download ZIP' : 'Enable "Blended JPEGs", "Class masks", or "Uncertainty maps" before processing to generate this';

    dom.progressFill.style.width = '100%';
    dom.progressLabel.textContent = 'Done — click a download button.';

    if (state.batchResults.length)
      setTimeout(() => dom.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);

  } catch (err) {
    showToast(`Batch failed: ${err.message}`, true);
  } finally {
    dom.processBtn.disabled = false;
    if (state.files.length) await showImage(saved);
    setTimeout(() => {
      dom.progressFill.style.width = '0%';
      dom.progressLabel.textContent = '';
    }, 5000);
  }
}

// longest-side-capped (w,h) for a thumbnail box
function fitBox(w, h, maxSide) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

// ── File loading ──────────────────────────────────────────────────────

async function loadFiles(fileList) {
  const files = Array.from(fileList).filter(
    f => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif)$/i.test(f.name)
  );
  if (!files.length) return;
  clearResults();
  state.files = files;
  dom.loadLabel.textContent = `${files.length} image${files.length === 1 ? '' : 's'} loaded`;
  updateNavEnabled();
  await showImage(0);
}

// ── Event wiring ──────────────────────────────────────────────────────

dom.loadBtn.addEventListener('click',  () => dom.fileInput.click());
dom.fileInput.addEventListener('change', () => {
  loadFiles(dom.fileInput.files).catch(err => showToast(err.message, true));
  dom.fileInput.value = '';
});

['dragenter','dragover'].forEach(evt =>
  dom.imageContainer.addEventListener(evt, e => { e.preventDefault(); dom.imageContainer.classList.add('drag-over'); })
);
['dragleave','drop'].forEach(evt =>
  dom.imageContainer.addEventListener(evt, e => {
    if (evt === 'drop') { e.preventDefault(); }
    dom.imageContainer.classList.remove('drag-over');
  })
);
dom.imageContainer.addEventListener('drop', e => {
  if (e.dataTransfer?.files?.length)
    loadFiles(e.dataTransfer.files).catch(err => showToast(err.message, true));
});

dom.canvas.addEventListener('click', () => {
  if (!dom.canvas.classList.contains('visible')) return;
  openLightbox(dom.canvas.toDataURL('image/jpeg', 0.9));
});

dom.prevBtn.addEventListener('click', () => showImage(state.currentIndex - 1).catch(err => showToast(err.message, true)));
dom.nextBtn.addEventListener('click', () => showImage(state.currentIndex + 1).catch(err => showToast(err.message, true)));

// Alpha slider (blend-only — no reclassify needed)
dom.alphaSlider.addEventListener('input', () => {
  const pct = parseInt(dom.alphaSlider.value, 10);
  state.alpha = pct / 100;
  dom.alphaLabel.textContent = `Overlay opacity: ${pct}`;
  renderBlend();
});

// Overlay mode radios (blend-only)
document.querySelectorAll('input[name="overlay-mode"]').forEach(r =>
  r.addEventListener('change', () => {
    if (!r.checked) return;
    state.overlayMode = r.value;
    // [uncertainty] swap the class legend for the magma gradient legend
    const uncert = r.value === 'uncertainty';
    $('class-legend').hidden = uncert;
    $('uncert-legend').hidden = !uncert;
    renderBlend();
  })
);

dom.processBtn.addEventListener('click', () => processBatch().catch(err => showToast(err.message, true)));
dom.clearBtn.addEventListener('click', clearAll);

dom.dlCsvBtn.addEventListener('click', () => { if (state.pendingCsv) saveAs(state.pendingCsv.blob, state.pendingCsv.name); });
dom.dlZipBtn.addEventListener('click', () => { if (state.pendingZip) saveAs(state.pendingZip.blob, state.pendingZip.name); });
dom.dlPdfBtn.addEventListener('click', () => { if (state.pendingPdf) saveAs(state.pendingPdf.blob, state.pendingPdf.name); });

// Show the optional report-detail fields only when "PDF report" is selected
dom.outputPdf.addEventListener('change', () => {
  dom.reportFields.hidden = !dom.outputPdf.checked;
});

dom.lightbox.addEventListener('click', e => { if (e.target === dom.lightbox) closeLightbox(); });
dom.lightboxClose.addEventListener('click', closeLightbox);

// ── Help menu / modals ────────────────────────────────────────────────

const helpBtn = $('help-menu-btn');
helpBtn.addEventListener('click', e => { e.stopPropagation(); helpBtn.classList.toggle('open'); });
document.addEventListener('click', () => helpBtn.classList.remove('open'));

const openModal  = id => $(id).classList.add('open');
const closeModal = el => el.closest('.modal-overlay').classList.remove('open');

$('menu-photoguide').addEventListener('click', () => { helpBtn.classList.remove('open'); openModal('photoguide-modal'); });
$('menu-about').addEventListener('click',   () => { helpBtn.classList.remove('open'); openModal('about-modal');   });
$('menu-guide').addEventListener('click',   () => { helpBtn.classList.remove('open'); openModal('guide-modal');   });
$('menu-license').addEventListener('click', () => { helpBtn.classList.remove('open'); openModal('license-modal'); });

// Show the field-photo guide automatically on the very first visit only.
// The "seen" flag is persisted when the user DISMISSES the guide (not when it
// opens), so the one-time cross-origin-isolation reload on first load — which
// unloads the page without a close event — doesn't consume the first view.
(function firstVisitGuide() {
  const photoGuide = $('photoguide-modal');
  if (!photoGuide) return;
  let seen = '1';
  try { seen = localStorage.getItem('stover-guide-seen'); } catch (_) { seen = null; }
  if (seen !== '1') openModal('photoguide-modal');

  let wasOpen = photoGuide.classList.contains('open');
  new MutationObserver(() => {
    const open = photoGuide.classList.contains('open');
    if (wasOpen && !open) { try { localStorage.setItem('stover-guide-seen', '1'); } catch (_) {} }
    wasOpen = open;
  }).observe(photoGuide, { attributes: true, attributeFilter: ['class'] });
})();

document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn)));

// "Don't show again" for the GPU tip
const gpuDismiss = $('gpu-tip-dismiss');
if (gpuDismiss) gpuDismiss.addEventListener('change', () => {
  try { localStorage.setItem('stover-gpu-tip-dismissed', gpuDismiss.checked ? '1' : '0'); } catch (_) {}
});
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (dom.lightbox.classList.contains('open')) { closeLightbox(); return; }
    document.querySelectorAll('.modal-overlay.open').forEach(o => o.classList.remove('open'));
  }
});

// ── Theme toggle ───────────────────────────────────────────────────────

dom.themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(cur === 'dark' ? 'light' : 'dark');
});

// ── PWA install prompt ────────────────────────────────────────────────

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  dom.installBtn.hidden = false;
});
dom.installBtn.addEventListener('click', async () => {
  if (!deferredInstall) return;
  dom.installBtn.hidden = true;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
});
window.addEventListener('appinstalled', () => { dom.installBtn.hidden = true; });

// ── Service worker ────────────────────────────────────────────────────

// Register the service worker for the offline app-shell cache (model + libraries).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────────────

initTheme();
dom.aboutVersion.textContent = VERSION;
updateNavEnabled();
initModel();

// Load bundled demo images once the model is ready so the first classification works.
(async () => {
  const paths = ['demo/demo_1.jpg', 'demo/demo_2.jpg', 'demo/demo_3.jpg', 'demo/demo_4.jpg'];
  // wait until model ready (poll briefly)
  const waitReady = () => new Promise(res => {
    if (state.modelReady) return res(true);
    const t = setInterval(() => { if (state.modelReady) { clearInterval(t); res(true); } }, 200);
    setTimeout(() => { clearInterval(t); res(state.modelReady); }, 60000);
  });
  try {
    const files = (await Promise.all(paths.map(async p => {
      const r = await fetch(p);
      if (!r.ok) return null;
      return new File([await r.blob()], p.split('/').pop(), { type: 'image/jpeg' });
    }))).filter(Boolean);
    if (files.length && await waitReady()) {
      await loadFiles(files);
      dom.loadLabel.textContent = `${files.length} demo images loaded`;
    }
  } catch (_) { /* demo images unavailable — user loads their own */ }
})();

})();
