// Stover landing page (docs/index.html). Plain JavaScript, no libraries.

// ── Hero: drag to reveal the classified image ──────────────────────────────
const compare = document.getElementById('compare');
const split = document.getElementById('hero-split');
split.addEventListener('input', () => compare.style.setProperty('--split', split.value + '%'));

// ── Hero: a few example photos in turn (classified by the model; s soil, p canopy, r residue) ──
const HERO = [
  { id: 'start', s: 58.0, p: 2.9,  r: 39.2 },
  { id: '1500',  s: 15.9, p: 44.4, r: 39.7 },
  { id: '2300',  s: 24.0, p: 0.0,  r: 76.0 },
  { id: '0350',  s: 82.4, p: 0.2,  r: 17.4 },
  { id: '3550',  s: 55.7, p: 0.1,  r: 44.2 },
];
const HERO_SECONDS = 7;
const heroDots = document.getElementById('hero-dots');
let heroIndex = 0, heroTimer = null;

function showHero(k) {
  heroIndex = k;
  const h = HERO[k];
  document.getElementById('hero-photo').src = `assets/hero/${h.id}_photo.jpg`;
  document.getElementById('hero-mask').src = `assets/hero/${h.id}_mask.png`;
  document.getElementById('hero-r').textContent = h.r.toFixed(1);
  document.getElementById('hero-p').textContent = h.p.toFixed(1);
  document.getElementById('hero-s').textContent = h.s.toFixed(1);
  document.getElementById('hero-t').textContent = (h.r + h.p).toFixed(1);
  heroDots.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', i === k));
}

HERO.forEach((h, k) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', `Example ${k + 1}`);
  b.addEventListener('click', () => { showHero(k); restartHero(); });
  heroDots.appendChild(b);
  if (k > 0) { new Image().src = `assets/hero/${h.id}_photo.jpg`; new Image().src = `assets/hero/${h.id}_mask.png`; }
});

function restartHero() {
  clearInterval(heroTimer);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  heroTimer = setInterval(() => { if (!compare.matches(':hover')) showHero((heroIndex + 1) % HERO.length); }, HERO_SECONDS * 1000);
}
showHero(0);
restartHero();

// ── Gallery ─────────────────────────────────────────────────────────────────
// Percent cover from each label image: s soil, p plant (canopy), r residue. The order mixes cover types,
// so any number of complete rows shows a varied set.
const TILES = [
  { id: 2651, s: 7.6,  p: 0.0,  r: 92.4 },
  { id: 1103, s: 99.0, p: 0.0,  r: 1.0  },
  { id: 3427, s: 5.1,  p: 42.2, r: 52.7 },
  { id: 2007, s: 57.1, p: 0.0,  r: 42.9 },
  { id: 3385, s: 2.0,  p: 97.9, r: 0.1  },
  { id: 3673, s: 8.1,  p: 8.0,  r: 83.8 },
  { id: 4265, s: 9.7,  p: 0.0,  r: 90.3 },
  { id: 1950, s: 71.8, p: 0.0,  r: 28.2 },
  { id: 4643, s: 44.5, p: 0.0,  r: 55.5 },
  { id: 3453, s: 7.2,  p: 92.1, r: 0.6  },
];

const grid = document.getElementById('grid');

function tileHTML(t) {
  const f = (v) => v.toFixed(1);
  const alt = `Field photo: residue ${f(t.r)}%, canopy ${f(t.p)}%, soil ${f(t.s)}%`;
  return `<article class="tile" tabindex="0" aria-label="${alt}. Press to switch between photo and classified image.">
    <div class="pic">
      <img src="assets/gallery/${t.id}_photo.jpg" alt="${alt}" loading="lazy" width="560" height="560">
      <img class="mask" src="assets/gallery/${t.id}_mask.png" alt="" loading="lazy" width="560" height="560">
    </div>
    <div class="body">
      <div class="bar" aria-hidden="true"><span style="width:${t.r}%;background:var(--residue)"></span><span style="width:${t.p}%;background:var(--canopy)"></span><span style="width:${t.s}%;background:var(--soil)"></span></div>
      <dl>
        <div><dt>Residue</dt><dd>${f(t.r)}%</dd></div>
        <div><dt>Canopy</dt><dd>${f(t.p)}%</dd></div>
        <div><dt>Soil</dt><dd>${f(t.s)}%</dd></div>
        <div class="tot"><dt>Total</dt><dd>${f(t.r + t.p)}%</dd></div>
      </dl>
    </div>
  </article>`;
}

// Only complete rows: as many tiles as fill 3 rows, or 2 rows when there are not enough for 3.
let shown = 0;
function render() {
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const rows = Math.max(1, Math.min(3, Math.floor(TILES.length / cols)));
  const n = cols * rows;
  if (n === shown) return;
  shown = n;
  grid.innerHTML = TILES.slice(0, n).map(tileHTML).join('');
}
render();
window.addEventListener('resize', render);

// Click (or Enter/Space) on a tile flips it: useful on touch screens, which have no hover.
const flip = (e) => e.target.closest('.tile')?.classList.toggle('flip');
grid.addEventListener('click', flip);
grid.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(e); }
});

document.getElementById('view').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#view button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  grid.classList.toggle('masks', b.dataset.view === 'masks');
  grid.querySelectorAll('.flip').forEach((t) => t.classList.remove('flip'));
});

// ── Windows download: newest GitHub release (version and size), else the Releases page ──
fetch('https://api.github.com/repos/soilwater/stover/releases/latest')
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    const exe = rel && (rel.assets || []).find((a) => /setup\.exe$/i.test(a.name));
    if (!exe) return;
    document.querySelectorAll('[data-download]').forEach((a) => { a.href = exe.browser_download_url; });
    const version = rel.tag_name.replace(/^v/i, '');
    document.getElementById('win-meta').textContent =
      `Version ${version} · Windows 10 and 11 · ${Math.round(exe.size / 1e6)} MB`;
  })
  .catch(() => {});
