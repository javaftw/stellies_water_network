// ─── loadingScreen.js ─────────────────────────────────────────────────────────
// Full-screen loading overlay with real asset progress tracking and a narrative
// introduction from Mokopa to Dr Alexander Sinske at GLS.
//
// USAGE:
//   import { initLoadingScreen, taskProgress, taskDone, taskSubDone } from './loadingScreen.js';
//   initLoadingScreen();           // call before any async asset loads
//   taskProgress('tiles', n, 483); // update a bar mid-load
//   taskDone('pipelines');         // mark a single-file task complete
//   taskSubDone('lighting');       // call once per file for multi-file tasks
//
// Fires window CustomEvent('loading-complete') on dismiss (skip or CTA).
// ─────────────────────────────────────────────────────────────────────────────

// ─── Task registry ────────────────────────────────────────────────────────────
// _sub tracks how many sub-files of a multi-file task have completed.
const TASKS = {
    dem:            { label: 'Elevation model',    n: 0, total: 1,   done: false },
    tiles:          { label: 'Satellite imagery',  n: 0, total: 483, done: false },
    buildings:      { label: '3D buildings',       n: 0, total: 1,   done: false },
    pipelines:      { label: 'Pipe network',       n: 0, total: 1,   done: false },
    infrastructure: { label: 'Infrastructure',     n: 0, total: 2,   done: false, _sub: 0 },
    lighting:       { label: 'Lighting data',      n: 0, total: 2,   done: false, _sub: 0 },
    centroids:      { label: 'Building centroids', n: 0, total: 1,   done: false },
};

// DOM refs to progress bar fill + percentage label, keyed by task id.
const _bars = {};

// ─── Public API ───────────────────────────────────────────────────────────────

export function initLoadingScreen() {
    _buildDOM();
}

// Update a task's progress bar (use for tiles and buildings which report partial progress).
export function taskProgress(id, n, total) {
    const t = TASKS[id];
    if (!t || t.done) return;
    t.n = n;
    if (total !== undefined) t.total = total;
    _updateBar(id);
}

// Mark a single-file task complete.
export function taskDone(id) {
    const t = TASKS[id];
    if (!t || t.done) return;
    t.n    = t.total;
    t.done = true;
    _updateBar(id);
    _checkAllDone();
}

// Increment the sub-file counter for a multi-file task (infrastructure, lighting).
// Automatically calls taskDone when all sub-files have completed.
export function taskSubDone(id) {
    const t = TASKS[id];
    if (!t || t.done) return;
    t._sub = (t._sub ?? 0) + 1;
    taskProgress(id, t._sub, t.total);
    if (t._sub >= t.total) taskDone(id);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _updateBar(id) {
    const t   = TASKS[id];
    const b   = _bars[id];
    if (!b) return;
    const pct = t.total > 0 ? Math.min(100, Math.round((t.n / t.total) * 100)) : 0;
    b.fill.style.width   = pct + '%';
    b.pct.textContent    = t.done ? 'done' : pct + '%';
    if (t.done) b.pct.style.color = '#00ccff';
}

function _checkAllDone() {
    if (Object.values(TASKS).every(t => t.done)) _showCTA();
}

function _showCTA() {
    const cta = document.getElementById('ls-cta');
    if (!cta) return;
    cta.style.display  = 'inline-block';
    cta.style.opacity  = '0';
    cta.style.transition = 'opacity 0.5s ease';
    requestAnimationFrame(() => { cta.style.opacity = '1'; });
}

function _dismiss() {
    const overlay = document.getElementById('ls-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 0.4s ease';
    overlay.style.opacity    = '0';
    setTimeout(() => {
        overlay.remove();
        window.dispatchEvent(new CustomEvent('loading-complete'));
    }, 400);
}

// ─── DOM builder ──────────────────────────────────────────────────────────────

function _buildDOM() {
    // ── Overlay shell ────────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'ls-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 1000;
        background: #0d0d0d;
        color: #e0e0e0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        overflow: hidden;
    `;

    // ── Skip link ────────────────────────────────────────────────────────────
    const skip = document.createElement('span');
    skip.id = 'ls-skip';
    skip.textContent = 'skip →';
    skip.style.cssText = `
        position: fixed; top: 18px; right: 24px; z-index: 1001;
        color: #555; font-size: 13px; cursor: pointer;
        letter-spacing: 0.04em; user-select: none;
    `;
    skip.addEventListener('mouseover',  () => { skip.style.color = '#aaa'; });
    skip.addEventListener('mouseout',   () => { skip.style.color = '#555'; });
    skip.addEventListener('click', _dismiss);

    // ── Scrollable body ───────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.id = 'ls-body';
    body.style.cssText = `
        height: calc(100vh - 200px);
        overflow-y: auto;
        padding-bottom: 40px;
    `;

    // ── Narrative ─────────────────────────────────────────────────────────────
    const narrative = document.createElement('div');
    narrative.id = 'ls-narrative';
    narrative.style.cssText = `
        max-width: 760px;
        margin: 0 auto;
        padding: 48px 32px 32px;
    `;
    narrative.appendChild(_buildNarrative());
    body.appendChild(narrative);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.id = 'ls-footer';
    footer.style.cssText = `
        position: fixed; bottom: 0; left: 0; right: 0;
        height: 200px;
        background: #0d0d0d;
        border-top: 1px solid #1a1a1a;
        padding: 16px 32px 14px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    `;

    const barsEl = document.createElement('div');
    barsEl.id = 'ls-bars';
    barsEl.style.cssText = 'display:flex; flex-direction:column; gap:5px;';

    for (const [id, task] of Object.entries(TASKS)) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:12px;';

        const lbl = document.createElement('span');
        lbl.textContent = task.label;
        lbl.style.cssText = 'font-size:11px; color:#555; min-width:140px; flex-shrink:0;';

        const track = document.createElement('div');
        track.style.cssText = `
            flex: 1; height: 4px;
            background: #1a1a1a; border-radius: 2px; overflow: hidden;
        `;

        const fill = document.createElement('div');
        fill.style.cssText = `
            height: 100%; width: 0%;
            background: #00ccff; border-radius: 2px;
            transition: width 0.25s ease-out;
        `;
        track.appendChild(fill);

        const pct = document.createElement('span');
        pct.textContent = '0%';
        pct.style.cssText = `
            font-size: 11px; color: #444;
            min-width: 34px; text-align: right;
            font-variant-numeric: tabular-nums;
        `;

        _bars[id] = { fill, pct };

        row.appendChild(lbl);
        row.appendChild(track);
        row.appendChild(pct);
        barsEl.appendChild(row);
    }

    // ── CTA ──────────────────────────────────────────────────────────────────
    const cta = document.createElement('button');
    cta.id = 'ls-cta';
    cta.textContent = 'Explore →';
    cta.style.cssText = `
        display: none;
        align-self: flex-end;
        padding: 8px 28px;
        background: transparent;
        border: 1px solid #00ccff;
        color: #00ccff;
        font-size: 13px;
        letter-spacing: 0.1em;
        cursor: pointer;
        font-family: inherit;
    `;
    cta.addEventListener('mouseover', () => { cta.style.background = 'rgba(0,204,255,0.08)'; });
    cta.addEventListener('mouseout',  () => { cta.style.background = 'transparent'; });
    cta.addEventListener('click', _dismiss);

    footer.appendChild(barsEl);
    footer.appendChild(cta);

    overlay.appendChild(skip);
    overlay.appendChild(body);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);
}

// ─── Narrative content ────────────────────────────────────────────────────────

function _buildNarrative() {
    const frag = document.createDocumentFragment();

    // Salutation
    const salutation = document.createElement('p');
    salutation.textContent = 'Dear Dr Sinske,';
    salutation.style.cssText = `
        font-size: 22px; font-weight: 300;
        color: #ccc; margin: 0 0 36px;
        letter-spacing: 0.02em;
    `;
    frag.appendChild(salutation);

    // Portrait + Introduction (portrait floats left)
    const introWrap = document.createElement('div');
    introWrap.style.cssText = 'overflow: hidden; margin-bottom: 40px;';

    const portrait = document.createElement('div');
    portrait.style.cssText = `
        float: left;
        width: 160px; height: 200px;
        background: #141414;
        border: 1px solid #2a2a2a;
        margin: 0 28px 12px 0;
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 6px;
        flex-shrink: 0;
    `;
    portrait.innerHTML = `
        <span style="color:#333; font-size:11px; letter-spacing:0.08em; text-align:center; line-height:1.6;">
            [ Portrait:<br>Mokopa ]
        </span>
    `;

    introWrap.appendChild(portrait);
    introWrap.appendChild(_section('INTRODUCTION',
        'My name is Mokopa — a Stellenbosch-based senior developer and QGIS enthusiast. ' +
        'This viewer is a proactive initiative, not a response to an advertised position. ' +
        'I built it to demonstrate how spatial data expertise and software engineering ' +
        'intersect in practice, using GLS\'s own municipal domain as the subject.'
    ));
    frag.appendChild(introWrap);

    // QGIS placeholder 1
    frag.appendChild(_qgisPlaceholder('QGIS: source data overview'));

    // Pipeline section
    frag.appendChild(_section('PIPELINE',
        'Raw municipal network data was imported into QGIS, cleaned, reprojected to UTM\u00a034S, ' +
        'and exported as GeoJSON. A custom Three.js renderer parses the coordinates, aligns them ' +
        'to a DEM-derived terrain mesh, and renders animated pipe flow in real time. ' +
        'The elevation model and satellite tiles loading in the progress bars below were both ' +
        'sourced and processed entirely in QGIS before being handed off to the web renderer.'
    ));

    // QGIS placeholder 2
    frag.appendChild(_qgisPlaceholder('QGIS: network topology'));

    // Skills section
    frag.appendChild(_section('SKILLS',
        'Spatial data wrangling (QGIS, Python, pyproj), web-based 3D visualisation ' +
        '(Three.js, WebGL GLSL), full-stack development, and the judgement to connect ' +
        'them cleanly — these are what I bring to GLS. I take initiative, I understand ' +
        'your domain, and I processed every layer you see below myself.'
    ));

    return frag;
}

function _section(labelText, bodyText) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 36px;';

    const label = document.createElement('div');
    label.textContent = labelText;
    label.style.cssText = `
        font-size: 13px; font-weight: 600;
        letter-spacing: 0.14em; text-transform: uppercase;
        color: #888; margin-bottom: 10px;
    `;

    const body = document.createElement('p');
    body.textContent = bodyText;
    body.style.cssText = `
        font-size: 16px; font-style: italic;
        color: #999; line-height: 1.8; margin: 0;
    `;

    wrap.appendChild(label);
    wrap.appendChild(body);
    return wrap;
}

function _qgisPlaceholder(labelText) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        width: 100%; height: 180px;
        background: #0a0a0a;
        border: 1px dashed #222;
        display: flex; align-items: center; justify-content: center;
        margin-bottom: 36px;
    `;
    const lbl = document.createElement('span');
    lbl.textContent = '[ ' + labelText + ' ]';
    lbl.style.cssText = 'font-size: 12px; color: #2a2a2a; letter-spacing: 0.06em;';
    wrap.appendChild(lbl);
    return wrap;
}
