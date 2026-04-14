// ─── loadingScreen.js ─────────────────────────────────────────────────────────
// Full-screen loading overlay with real asset progress tracking and a narrative
// introduction from Hennie Kotze to Dr Alexander Sinske at GLS.
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
    b.fill.style.width = pct + '%';
    b.pct.textContent  = t.done ? 'done' : pct + '%';
    if (t.done) {
        b.pct.style.color      = '#00ccff';
        b.fill.style.animation = 'ls-bar-complete 0.9s ease-out forwards';
    }
}

function _checkAllDone() {
    if (Object.values(TASKS).every(t => t.done)) _showCTA();
}

function _showCTA() {
    const cta = document.getElementById('ls-cta');
    if (!cta) return;
    cta.style.display = 'inline-block';
    requestAnimationFrame(() => {
        cta.style.opacity   = '1';
        cta.style.animation = 'ls-pulse 2s ease-in-out infinite';
    });

    const status = document.getElementById('ls-status');
    if (status) {
        status.textContent  = 'RESOURCES LOADED — READY';
        status.style.color  = '#00ff88';
        status.style.animation = 'ls-status-done 2s ease-in-out infinite';
    }
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

    // ── Keyframe for CTA pulse glow ───────────────────────────────────────────
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        @keyframes ls-pulse {
            0%, 100% { box-shadow: 0 0 12px rgba(0,204,255,0.35), 0 0 28px rgba(0,204,255,0.12); }
            50%       { box-shadow: 0 0 28px rgba(0,204,255,0.80), 0 0 56px rgba(0,204,255,0.30); }
        }
        @keyframes ls-bar-complete {
            0%   { background: #00ff88; box-shadow: 0 0 6px rgba(0,255,136,0.9), 0 0 14px rgba(0,255,136,0.5); }
            55%  { background: #00ff88; box-shadow: 0 0 10px rgba(0,255,136,0.7), 0 0 22px rgba(0,255,136,0.3); }
            100% { background: #00ccff; box-shadow: none; }
        }
        @keyframes ls-status-pulse {
            0%, 100% { text-shadow: 0 0 8px rgba(0,204,255,0.5), 0 0 20px rgba(0,204,255,0.2); }
            50%       { text-shadow: 0 0 16px rgba(0,204,255,0.9), 0 0 40px rgba(0,204,255,0.4); }
        }
        @keyframes ls-status-done {
            0%, 100% { text-shadow: 0 0 8px rgba(0,255,136,0.5), 0 0 20px rgba(0,255,136,0.2); }
            50%       { text-shadow: 0 0 16px rgba(0,255,136,0.9), 0 0 40px rgba(0,255,136,0.4); }
        }
    `;
    document.head.appendChild(styleEl);

    // ── Scroll "more" indicator ───────────────────────────────────────────────
    const moreIndicator = document.createElement('div');
    moreIndicator.id = 'ls-more';
    moreIndicator.style.cssText = `
        position: fixed; bottom: 208px; left: 0; right: 0;
        display: flex; flex-direction: column; align-items: center;
        pointer-events: none; transition: opacity 0.3s ease;
        opacity: 1;
    `;
    moreIndicator.innerHTML = `
        <span style="color:#999; font-size:13px; letter-spacing:0.14em; text-transform:uppercase; margin-bottom:6px;">more</span>
        <span style="color:#00ccff; font-size:28px; line-height:1; animation:ls-bounce 1.4s ease-in-out infinite;">↓</span>
    `;
    styleEl.textContent += `
        @keyframes ls-bounce {
            0%, 100% { transform: translateY(0); }
            50%       { transform: translateY(4px); }
        }
    `;

    body.addEventListener('scroll', () => {
        const t = Math.min(1, body.scrollTop / 120);
        moreIndicator.style.opacity = String(1 - t);
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.id = 'ls-footer';
    footer.style.cssText = `
        position: fixed; bottom: 0; left: 0; right: 0;
        height: 200px;
        background: #0d0d0d;
        border-top: 1px solid #1a1a1a;
        display: flex;
        flex-direction: row;
        align-items: stretch;
    `;

    // Bars + CTA row
    const footerRow = document.createElement('div');
    footerRow.style.cssText = `
        display: flex; flex-direction: row;
        align-items: stretch; flex: 1; min-height: 0;
    `;

    // Left 75% — progress bars
    const barsEl = document.createElement('div');
    barsEl.id = 'ls-bars';
    barsEl.style.cssText = `
        flex: 3;
        display: flex; flex-direction: column; justify-content: center; gap: 6px;
        padding: 16px 28px 16px 32px;
    `;

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
            background: #ff3333; border-radius: 2px;
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

    // Right 25% — CTA
    const ctaWrap = document.createElement('div');
    ctaWrap.style.cssText = `
        flex: 1;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px;
        border-left: 1px solid #1a1a1a;
    `;

    const statusHeader = document.createElement('div');
    statusHeader.id = 'ls-status';
    statusHeader.textContent = 'LOADING RESOURCES — PLEASE WAIT';
    statusHeader.style.cssText = `
        text-align: center;
        font-size: 10px; font-weight: 600;
        letter-spacing: 0.16em; text-transform: uppercase;
        color: #00ccff;
        animation: ls-status-pulse 2s ease-in-out infinite;
        padding: 0 12px;
    `;
    ctaWrap.appendChild(statusHeader);

    const cta = document.createElement('button');
    cta.id = 'ls-cta';
    cta.textContent = 'Explore →';
    cta.style.cssText = `
        display: none;
        padding: 14px 32px;
        background: transparent;
        border: 1px solid #00ccff;
        color: #00ccff;
        font-size: 16px;
        letter-spacing: 0.14em;
        cursor: pointer;
        font-family: inherit;
        opacity: 0;
        transition: opacity 0.5s ease, background 0.2s ease;
    `;
    cta.addEventListener('mouseover', () => { cta.style.background = 'rgba(0,204,255,0.1)'; });
    cta.addEventListener('mouseout',  () => { cta.style.background = 'transparent'; });
    cta.addEventListener('click', _dismiss);

    ctaWrap.appendChild(cta);
    footerRow.appendChild(barsEl);
    footerRow.appendChild(ctaWrap);
    footer.appendChild(footerRow); // footer is back to row layout; footerRow fills it

    overlay.appendChild(skip);
    overlay.appendChild(body);
    overlay.appendChild(moreIndicator);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);
}

// ─── Narrative content ────────────────────────────────────────────────────────

function _buildNarrative() {
    const frag = document.createDocumentFragment();

    // ── INTRODUCTION ──────────────────────────────────────────────────────────
    const introLabel = document.createElement('div');
    introLabel.textContent = 'INTRODUCTION';
    introLabel.style.cssText = `
        font-size: 14px; font-weight: 600;
        letter-spacing: 0.14em; text-transform: uppercase;
        color: #888; margin-bottom: 10px;
    `;
    frag.appendChild(introLabel);

    const headshot = document.createElement('img');
    headshot.src = 'headshot.png';
    headshot.alt = 'Hennie Kotze';
    headshot.style.cssText = `
        width: 120px; height: 200px;
        object-fit: cover;
        display: block;
        margin-bottom: 20px;
        border: 1px solid #2a2a2a;
    `;
    frag.appendChild(headshot);

    frag.appendChild(_sectionMulti(null, [
        'My name is Hennie Kotze. I am a Stellenbosch-based senior software developer and an avid ' +
        'QGIS enthusiast looking for work or employment in any capacity where my skills could be of use to you.',
        'Using GLS\'s own municipal domain as the subject and inspiration, I envisaged and developed this ' +
        'interactive viewer from scratch (no boilerplate or prefab components) as a proactive initiative ' +
        'to demonstrate my understanding of how spatial data and software development intersect in practice.',
    ]));

    // ── WPRS document image ───────────────────────────────────────────────────
    const wprsBlock = document.createElement('div');
    wprsBlock.style.cssText = 'margin-bottom: 36px;';
    const wprsImg = document.createElement('img');
    wprsImg.src = 'WPRS.png';
    wprsImg.alt = 'Water Distribution System — Pipe Replacement Study (GLS, June 2019)';
    wprsImg.style.cssText = 'width: 100%; border: 1px solid #1e1e1e; display: block;';
    const wprsCaption = document.createElement('p');
    wprsCaption.textContent =
        'Water Distribution System — Pipe Replacement Study, prepared by GLS for the ' +
        'Stellenbosch Municipality (June 2019).';
    wprsCaption.style.cssText = `
        font-size: 14px; font-style: italic; color: #777;
        line-height: 1.7; margin: 10px 0 0;
    `;
    wprsBlock.appendChild(wprsImg);
    wprsBlock.appendChild(wprsCaption);
    frag.appendChild(wprsBlock);

    // ── STELLENBOSCH WATER PIPE NETWORK ───────────────────────────────────────
    frag.appendChild(_sectionMulti('STELLENBOSCH WATER PIPE NETWORK', [
        'No publicly available GIS data exists for the Stellenbosch municipal pipe network. ' +
        'The pipe routes visible in this viewer were derived by georeferencing <em>GLS\'s Water Distribution ' +
        'System - Pipe Replacement Study</em> (June 2019) in <strong>QGIS</strong>, then digitised, attributed with diameter ' +
        'and material, reprojected to UTM\u00a034S, and exported as GeoJSON. A custom Three.js renderer ' +
        'parses the coordinates, aligns them to a DEM-derived terrain mesh, and renders animated pipe ' +
        'flow in real time. The elevation model and satellite tiles were also sourced and processed ' +
        'entirely in <strong>QGIS</strong> before being handed off to the web renderer.',
    ]));

    // ── QGIS screenshot ───────────────────────────────────────────────────────
    const qgisScreenBlock = document.createElement('div');
    qgisScreenBlock.style.cssText = 'margin-bottom: 36px;';
    const qgisScreenImg = document.createElement('img');
    qgisScreenImg.src = 'qgis_screenshot.png';
    qgisScreenImg.alt = 'QGIS — Stellenbosch water pipe network';
    qgisScreenImg.style.cssText = 'width: 100%; border: 1px solid #1e1e1e; display: block;';
    const qgisScreenCaption = document.createElement('p');
    qgisScreenCaption.innerHTML = 'Georeferencing the pipeline network, as published in the Pipe Replacement Study document, in <strong>QGIS</strong>.';
    qgisScreenCaption.style.cssText = `
        font-size: 14px; font-style: italic; color: #777;
        line-height: 1.7; margin: 10px 0 0;
    `;
    qgisScreenBlock.appendChild(qgisScreenImg);
    qgisScreenBlock.appendChild(qgisScreenCaption);
    frag.appendChild(qgisScreenBlock);

    // ── QGIS logo ─────────────────────────────────────────────────────────────
    const qgisBlock = document.createElement('div');
    qgisBlock.style.cssText = 'display: flex; align-items: center; gap: 20px; margin-bottom: 36px;';
    const qgisImg = document.createElement('img');
    qgisImg.src = 'qgis_logo.png';
    qgisImg.alt = 'QGIS';
    qgisImg.style.cssText = 'width: 120px; height: 120px; opacity: 0.85; flex-shrink: 0;';
    const qgisCaption = document.createElement('span');
    qgisCaption.innerHTML = 'All spatial data — DEM, satellite tiles, pipe network, infrastructure — was sourced, cleaned, and exported using <strong>QGIS</strong>.';
    qgisCaption.style.cssText = 'font-size: 15px; font-style: italic; color: #777; line-height: 1.7;';
    qgisBlock.appendChild(qgisImg);
    qgisBlock.appendChild(qgisCaption);
    frag.appendChild(qgisBlock);

    // ── SKILLS AND EXPERIENCE ─────────────────────────────────────────────────
    frag.appendChild(_sectionMulti('SKILLS AND EXPERIENCE', [
        'Spatial data wrangling (<strong>QGIS</strong>, Python, PostGIS), web-based 3D visualisation (Three.js, WebGL GLSL). ' +
        'I am a seasoned developer with a wide variety of development experiences, and I take initiative.',
        'I have been using <strong>QGIS</strong> for personal projects for many years and was a contributor to the open-source ' +
        'GEEST and GEEST2 projects (Kartoza\u00a0/\u00a0World Bank), but I would like to turn my hobby into a source of income.',
        'Previously in my career I have also developed simulation software, among others, for the SAAF ' +
        '(Rooivalk Attack Helicopter), Sightlines\u00a0/\u00a0Phambili (waste management services) for a project at SASOL, ' +
        'and for an automated adaptation of the Peinemann IBC-5 bundle cleaning machine.',
    ]));

    // ── RELEVANT QUALIFICATIONS ───────────────────────────────────────────────
    const qualWrap = document.createElement('div');
    qualWrap.style.cssText = 'margin-bottom: 36px;';
    const qualLabel = document.createElement('div');
    qualLabel.textContent = 'RELEVANT QUALIFICATIONS';
    qualLabel.style.cssText = `
        font-size: 14px; font-weight: 600;
        letter-spacing: 0.14em; text-transform: uppercase;
        color: #888; margin-bottom: 10px;
    `;
    const qualBody = document.createElement('p');
    qualBody.style.cssText = 'font-size: 17px; color: #b0b0b0; line-height: 1.8; margin: 0;';
    qualBody.innerHTML =
        'I obtained a certificate from the Centre for Geographical Analysis (University of Stellenbosch) ' +
        'in 2018 after completing the <em>Introduction to GIS</em> short course. The course was designed ' +
        'for ArcGIS but I performed all of the activities using <strong>QGIS</strong> (together with GDAL and SCP).';
    qualWrap.appendChild(qualLabel);
    qualWrap.appendChild(qualBody);
    frag.appendChild(qualWrap);

    // ── AVAILABILITY ──────────────────────────────────────────────────────────
    const availWrap = document.createElement('div');
    availWrap.style.cssText = 'margin-bottom: 36px;';
    const availLabel = document.createElement('div');
    availLabel.textContent = 'AVAILABILITY';
    availLabel.style.cssText = `
        font-size: 14px; font-weight: 600;
        letter-spacing: 0.14em; text-transform: uppercase;
        color: #888; margin-bottom: 10px;
    `;
    const availItems = [
        'Available for once-off project work, contract work, or a permanent position.',
        'I prefer remote work due to (hopefully temporary) transport constraints, but I can make a plan when needed. I live in Onder-Papegaaiberg, Stellenbosch.',
        'Available to start immediately.',
    ];
    const availList = document.createElement('ul');
    availList.style.cssText = 'margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px;';
    for (const text of availItems) {
        const li = document.createElement('li');
        li.textContent = text;
        li.style.cssText = 'font-size: 17px; color: #b0b0b0; line-height: 1.7;';
        availList.appendChild(li);
    }
    availWrap.appendChild(availLabel);
    availWrap.appendChild(availList);
    frag.appendChild(availWrap);

    // ── CONTACT ───────────────────────────────────────────────────────────────
    const contact = document.createElement('div');
    contact.style.cssText = 'margin-bottom: 48px;';
    const contactLabel = document.createElement('div');
    contactLabel.textContent = 'CONTACT';
    contactLabel.style.cssText = `
        font-size: 14px; font-weight: 600;
        letter-spacing: 0.14em; text-transform: uppercase;
        color: #888; margin-bottom: 10px;
    `;
    const contactBody = document.createElement('div');
    contactBody.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
    contactBody.innerHTML = `
        <span style="font-size:20px; color:#ccc; font-weight:300;">Hennie Kotze</span>
        <span style="font-size:17px; color:#b0b0b0;">
            <a href="mailto:javaftw@gmail.com"
               style="color:#00ccff; text-decoration:none;">javaftw@gmail.com</a>
        </span>
        <span style="font-size:17px; color:#b0b0b0;">079 352 4417</span>
    `;
    contact.appendChild(contactLabel);
    contact.appendChild(contactBody);
    frag.appendChild(contact);

    // ── Claude Code credit ────────────────────────────────────────────────────
    const claudeNote = document.createElement('p');
    claudeNote.textContent = 'This viewer was developed with the assistance of Claude Code by Anthropic.';
    claudeNote.style.cssText = 'font-size: 13px; color: #444; line-height: 1.6; margin-bottom: 48px; font-style: italic;';
    frag.appendChild(claudeNote);

    return frag;
}

// Renders a section with a label and one or more body paragraphs.
function _sectionMulti(labelText, paragraphs) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 36px;';
    if (labelText) {
        const label = document.createElement('div');
        label.textContent = labelText;
        label.style.cssText = `
            font-size: 14px; font-weight: 600;
            letter-spacing: 0.14em; text-transform: uppercase;
            color: #888; margin-bottom: 10px;
        `;
        wrap.appendChild(label);
    }
    for (const text of paragraphs) {
        const p = document.createElement('p');
        p.style.cssText = 'font-size: 17px; color: #b0b0b0; line-height: 1.8; margin: 0 0 12px;';
        p.innerHTML = text;
        wrap.appendChild(p);
    }
    return wrap;
}
