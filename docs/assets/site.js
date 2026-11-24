// Stover landing page (docs/index.html). Plain JavaScript, no libraries.

// ── Hero: drag to reveal the classified image ──────────────────────────────
const compare = document.getElementById('compare');
const split = document.getElementById('hero-split');
split.addEventListener('input', () => compare.style.setProperty('--split', split.value + '%'));

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
  { id: 3657, s: 77.7, p: 15.1, r: 7.2  },
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
