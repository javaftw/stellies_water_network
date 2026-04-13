import * as THREE from 'three';
import { initTerrain, getTerrainMesh, sampleTerrainElevation } from './terrain.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { initMinimap, updateMinimap, addMinimapLayers, highlightMinimapFeature, clearMinimapHighlight, highlightFilterFeatures, clearFilterHighlight } from './minimap.js';
import { ORIGIN_X, ORIGIN_Y } from './constants.js';
import { initLoadingScreen, taskProgress, taskDone, taskSubDone } from './loadingScreen.js';

const ELEVATION_OFFSET = -5;

initLoadingScreen();

window.addEventListener('loading-complete', () => {
    console.log('[Main] Loading overlay dismissed.');
}, { once: true });

// 1. Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 4000, 7000);

// 2. Camera setup
const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    1,
    6000
);

// 3. Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// 4. Custom camera controller
const cameraState = {
    theta:      0,
    phi:        Math.PI / 4,
    radius:     1200,
    target:     new THREE.Vector3(0, 0, 0),
    isDragging: false,
    isPanning:  false,
    lastX: 0,
    lastY: 0,
};

const CAM_ROTATE_SPEED = 0.005;
const CAM_PAN_SPEED    = 1.0;
const CAM_ZOOM_SPEED   = 50;
const CAM_MIN_RADIUS   = 50;    // minimum orbit radius — keeps camera off the target point
const CAM_MAX_RADIUS   = 4000;  // maximum orbit radius
const CAM_MIN_PHI        = 0.05;
const CAM_MAX_PHI        = Math.PI / 2 - 0.01;
const CAM_MIN_CLEARANCE  = 30;   // hard floor: metres above terrain
const CAM_SOFT_ZONE      = 150;  // metres above floor where rotation decelerates

function updateCamera() {
    let sinPhi   = Math.sin(cameraState.phi);
    let cosPhi   = Math.cos(cameraState.phi);
    const sinTheta = Math.sin(cameraState.theta);
    const cosTheta = Math.cos(cameraState.theta);

    let camX = cameraState.target.x + cameraState.radius * sinPhi * sinTheta;
    let camY = cameraState.target.y + cameraState.radius * cosPhi;
    let camZ = cameraState.target.z + cameraState.radius * sinPhi * cosTheta;

    // Hard floor: keep camera at least CAM_MIN_CLEARANCE metres above terrain
    const terrainElev = sampleTerrainElevation(camX + ORIGIN_X, -camZ + ORIGIN_Y);
    const minCamY     = terrainElev + CAM_MIN_CLEARANCE;
    if (camY < minCamY) {
        const newCosPhi   = Math.max(-1, Math.min(1, (minCamY - cameraState.target.y) / cameraState.radius));
        cameraState.phi   = Math.acos(newCosPhi);
        sinPhi = Math.sin(cameraState.phi);
        cosPhi = newCosPhi;
        camX = cameraState.target.x + cameraState.radius * sinPhi * sinTheta;
        camY = cameraState.target.y + cameraState.radius * cosPhi;
        camZ = cameraState.target.z + cameraState.radius * sinPhi * cosTheta;
    }

    camera.position.set(camX, camY, camZ);
    camera.lookAt(cameraState.target);
}

// Minimap click — teleport camera target to clicked location
window.addEventListener('minimap-click', (e) => {
    const { x, z } = e.detail;
    // Keep current Y (terrain height approximation — use current target Y)
    cameraState.target.set(x, cameraState.target.y, z);
    updateCamera();
});

// Minimap drag — pan camera target by the map drag delta
window.addEventListener('minimap-pan', (e) => {
    const { dx, dz } = e.detail;
    cameraState.target.x += dx;
    cameraState.target.z += dz;
    updateCamera();
});

updateCamera();

const domEl = renderer.domElement;

let _mouseClickStart = { x: 0, y: 0 };

domEl.addEventListener('mousedown', (e) => {
    _mouseClickStart = { x: e.clientX, y: e.clientY };
    if (e.button === 0) { cameraState.isPanning  = true; }
    if (e.button === 2) { cameraState.isDragging = true; }
    cameraState.lastX = e.clientX;
    cameraState.lastY = e.clientY;
});

domEl.addEventListener('mouseup', () => {
    cameraState.isDragging = false;
    cameraState.isPanning  = false;
});

domEl.addEventListener('mouseleave', () => {
    cameraState.isDragging = false;
    cameraState.isPanning  = false;
});

domEl.addEventListener('mousemove', (e) => {
    const dx = e.clientX - cameraState.lastX;
    const dy = e.clientY - cameraState.lastY;
    cameraState.lastX = e.clientX;
    cameraState.lastY = e.clientY;

    if (cameraState.isDragging) {
        cameraState.theta -= dx * CAM_ROTATE_SPEED;

        let dphi = dy * CAM_ROTATE_SPEED;
        // Soft stop: scale down downward pitch as camera nears the terrain floor
        if (dphi > 0) {
            const terrainElev = sampleTerrainElevation(
                camera.position.x + ORIGIN_X,
                -camera.position.z + ORIGIN_Y
            );
            const clearance = camera.position.y - terrainElev;
            const t = Math.max(0, Math.min(1, (clearance - CAM_MIN_CLEARANCE) / CAM_SOFT_ZONE));
            dphi *= t * t; // quadratic ease — feels natural
        }

        cameraState.phi = Math.max(CAM_MIN_PHI,
                          Math.min(CAM_MAX_PHI,
                          cameraState.phi + dphi));
        updateCamera();
    }

    if (cameraState.isPanning) {
        const forward = new THREE.Vector3(
            Math.sin(cameraState.theta),
            0,
            Math.cos(cameraState.theta)
        );
        const right = new THREE.Vector3(
            Math.cos(cameraState.theta),
            0,
            -Math.sin(cameraState.theta)
        );
        const panScale = cameraState.radius * CAM_PAN_SPEED * 0.001;
        cameraState.target.addScaledVector(right,   -dx * panScale);
        cameraState.target.addScaledVector(forward, -dy * panScale);
        updateCamera();
    }
});

domEl.addEventListener('wheel', (e) => {
    const delta = e.deltaY > 0 ? 1 : -1;
    cameraState.radius = Math.max(CAM_MIN_RADIUS,
                         Math.min(CAM_MAX_RADIUS,
                         cameraState.radius + delta * CAM_ZOOM_SPEED));
    updateCamera();
}, { passive: true });

domEl.addEventListener('contextmenu', (e) => e.preventDefault());

// Inspect-mode click — only fires when mouse hasn't moved more than 4 px (i.e. not a drag)
domEl.addEventListener('click', (e) => {
    if (!inspectState.active) return;
    const dx = e.clientX - _mouseClickStart.x;
    const dy = e.clientY - _mouseClickStart.y;
    if (dx * dx + dy * dy > 16) return;

    const ndcX =  (e.clientX / window.innerWidth)  * 2 - 1;
    const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
    _raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);

    // Hit-test solid meshes (reservoirs / pump stations) and pipes separately
    const meshHits = _inspectMeshes.length > 0
        ? _raycaster.intersectObjects(_inspectMeshes) : [];
    const pipeHits = pipeNetwork.mesh
        ? _raycaster.intersectObject(pipeNetwork.mesh) : [];

    // Nothing hit — clear selection
    if (meshHits.length === 0 && pipeHits.length === 0) { _clearInspect(); return; }

    // Pick closest hit across both sets
    const meshDist = meshHits.length > 0 ? meshHits[0].distance : Infinity;
    const pipeDist = pipeHits.length  > 0 ? pipeHits[0].distance  : Infinity;

    if (meshDist <= pipeDist) {
        // --- Solid mesh selected ---
        const hitMesh = meshHits[0].object;
        _clearInspect();
        _highlightSceneMesh(hitMesh);
        _showFeatureInfo(hitMesh.userData.type, hitMesh.userData);
    } else {
        // --- Pipe segment selected ---
        const vi      = pipeHits[0].index;
        const feature = pipeNetwork.featureIndex.find(
            f => vi >= f.vertexStart && vi < f.vertexStart + f.vertexCount
        );
        if (!feature) { _clearInspect(); return; }
        _clearInspect();
        _highlightPipe(feature);
        inspectState.selectedFeature = feature;
        _showFeatureInfo('pipeline', feature);
    }
});

// 5. Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x222222, 0.4);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width  = 8192;
sunLight.shadow.mapSize.height = 8192;
// Shadow frustum covers the full DEM extent (~10 km × 11 km, origin-centred).
// Sun is placed at a fixed world position so the frustum never moves with the camera.
// 4096 px over 12 000 units ≈ 2.9 m/texel — acceptable at city scale.
sunLight.shadow.camera.near   = 1;
sunLight.shadow.camera.far    = 14000;
sunLight.shadow.camera.left   = -6000;
sunLight.shadow.camera.right  =  6000;
sunLight.shadow.camera.top    =  6000;
sunLight.shadow.camera.bottom = -6000;
sunLight.shadow.camera.updateProjectionMatrix();
sunLight.shadow.bias = -0.001;
scene.add(sunLight);
scene.add(sunLight.target);

const sunDirection = new THREE.Vector3();

function updateSun(t) {
    const angle     = t * Math.PI;
    const elevation = Math.sin(angle);

    sunDirection.set(
        -Math.cos(angle),
         Math.sin(angle),
        -0.2
    ).normalize();

    // Three-stop colour model:
    //   horizon  (elevation ~0)   : deep orange-red
    //   low      (elevation ~0.15): warm golden
    //   mid-noon (elevation >0.3) : cool bright white-yellow
    // smoothstep gives a narrow warm band near the horizon only.
    const horizonColor = new THREE.Color(0xff4400);  // deep orange-red
    const goldenColor  = new THREE.Color(0xffcc66);  // warm gold
    const noonColor    = new THREE.Color(0xfff8ee);  // bright cool white

    // t1: 0→1 as elevation crosses the horizon band (0 to 0.18)
    const t1 = Math.min(1.0, elevation / 0.18);
    const t1s = t1 * t1 * (3 - 2 * t1);          // smoothstep

    // t2: 0→1 as elevation crosses into full daylight (0.18 to 0.40)
    const t2 = Math.max(0.0, Math.min(1.0, (elevation - 0.18) / 0.22));
    const t2s = t2 * t2 * (3 - 2 * t2);          // smoothstep

    const blended = horizonColor.clone().lerp(goldenColor, t1s).lerp(noonColor, t2s);
    sunLight.color.copy(blended);
    sunLight.intensity     = 0.3 + elevation * 1.8;
    ambientLight.intensity = 0.05 + elevation * 0.2;
    hemiLight.intensity    = 0.05 + elevation * 0.2;

    // Tint ambient/hemi to match the horizon colour during early/late periods
    const ambientHorizon = new THREE.Color(0xcc4400);  // warm red-orange
    const ambientGolden  = new THREE.Color(0xcc8833);  // amber
    const ambientNoon    = new THREE.Color(0xaabbcc);  // bright sky-blue tinted white

    const ambientBlended = ambientHorizon.clone().lerp(ambientGolden, t1s).lerp(ambientNoon, t2s);
    ambientLight.color.copy(ambientBlended);
    hemiLight.color.copy(ambientBlended);

    // Sky stays black regardless of time of day
    scene.background = new THREE.Color(0x000000);
    scene.fog.color.set(0x000000);
}

updateSun(0.5);

//initialize the mini-map
initMinimap();

// GeoJSON data collected as it loads — addMinimapLayers called once all three are ready
const _minimapGeoJSON = { pipelines: null, reservoirs: null, pumpStations: null };
function _tryAddMinimapLayers() {
    const { pipelines, reservoirs, pumpStations } = _minimapGeoJSON;
    if (pipelines && reservoirs && pumpStations) {
        addMinimapLayers(pipelines, reservoirs, pumpStations);
    }
}


// 6. UI — collapsible panel stack (right side)
const panelStack = document.createElement('div');
panelStack.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 400px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 50;
    font-family: Arial, sans-serif;
    font-size: 14px;
    color: white;
    pointer-events: none;
`;
document.body.appendChild(panelStack);

// --- Reticule overlay ---
const reticule = document.createElement('div');
reticule.style.cssText = `
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 20px; height: 20px;
    pointer-events: none;
    z-index: 100;
`;
reticule.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20">
        <line x1="10" y1="2" x2="10" y2="8"  stroke="#ff3333" stroke-width="1.5"/>
        <line x1="10" y1="12" x2="10" y2="18" stroke="#ff3333" stroke-width="1.5"/>
        <line x1="2"  y1="10" x2="8"  y2="10" stroke="#ff3333" stroke-width="1.5"/>
        <line x1="12" y1="10" x2="18" y2="10" stroke="#ff3333" stroke-width="1.5"/>
    </svg>`;
document.body.appendChild(reticule);

// Keyframe for inspect-panel border breathing
(() => {
    const s = document.createElement('style');
    s.textContent = `
        @keyframes inspect-breathe {
            0%, 100% { border-color: #004455; box-shadow: none; }
            50%       { border-color: #00ccff; box-shadow: 0 0 10px rgba(0,204,255,0.25); }
        }`;
    document.head.appendChild(s);
})();

function makePanel(title, initiallyOpen = true) {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: rgba(0,0,0,0.75);
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        overflow: hidden;
        pointer-events: all;
    `;
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 9px 14px;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        user-select: none;
        border-bottom: 1px solid #1a1a1a;
    `;
    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    titleEl.style.cssText = 'font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#999;';
    const chevron = document.createElement('span');
    chevron.textContent = initiallyOpen ? '▲' : '▼';
    chevron.style.cssText = 'font-size:9px; color:#444;';
    header.appendChild(titleEl);
    header.appendChild(chevron);
    const body = document.createElement('div');
    body.style.cssText = `padding: 12px 14px 14px; display: ${initiallyOpen ? 'block' : 'none'};`;
    header.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        chevron.textContent = open ? '▼' : '▲';
    });
    panel.appendChild(header);
    panel.appendChild(body);
    panelStack.appendChild(panel);
    return body;
}

function makeSliderRow(labelText, min, max, value, onInput) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:10px;';

    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.cssText = 'min-width:110px; color:#ccc; font-size:13px; flex-shrink:0;';

    const input = document.createElement('input');
    input.type  = 'range';
    input.min   = String(min);
    input.max   = String(max);
    input.value = String(value);
    input.style.cssText = 'flex:1; cursor:pointer;';

    const readout = document.createElement('span');
    readout.style.cssText = 'min-width:48px; text-align:right; color:#aaa; font-size:13px;';

    input.addEventListener('input', () => onInput(input, readout));

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(readout);

    return { input, readout, row };
}

// --- Panel 1: Time of Day ---
const todBody = makePanel('☀  Time of Day');

function sliderToTimeString(val) {
    const totalMinutes = 6 * 60 + (Number(val) / 100) * 12 * 60;
    const hours   = Math.floor(totalMinutes / 60);
    const minutes = Math.floor(totalMinutes % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const { readout: timeReadout, row: timeRow } = makeSliderRow(
    'Time of Day',
    0, 100, 50,
    (input, readout) => {
        readout.textContent = sliderToTimeString(input.value);
        const t = Number(input.value) / 100;
        updateSun(t);
        updateBuildingLights(t);
    }
);
timeReadout.textContent = sliderToTimeString(50);
todBody.appendChild(timeRow);

// --- Panel 2: X-Ray View ---
const xrayBody = makePanel('🔭  X-Ray View');
const coneState = { halfAngleDeg: 25, xrayEnabled: true };

const { input: coneSlider, readout: coneReadout, row: coneRow } = makeSliderRow(
    'Cone Angle',
    15, 35, 25,
    (input, readout) => {
        coneState.halfAngleDeg = Number(input.value);
        readout.textContent    = `${input.value}°`;
    }
);
coneReadout.textContent = '25°';
xrayBody.appendChild(coneRow);

// X-Ray toggle row
const xrayToggleRow = document.createElement('div');
xrayToggleRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-top:10px;';

const xrayToggleLabel = document.createElement('span');
xrayToggleLabel.textContent = 'X-Ray';
xrayToggleLabel.style.cssText = 'min-width:110px; color:#ccc; font-size:13px;';

const toggleWrap = document.createElement('label');
toggleWrap.title = 'Toggle X-Ray';
toggleWrap.style.cssText = `
    position: relative; display: inline-block;
    width: 36px; height: 20px; cursor: pointer; flex-shrink: 0;
`;
const toggleInput = document.createElement('input');
toggleInput.type    = 'checkbox';
toggleInput.checked = true;
toggleInput.style.cssText = 'opacity:0; width:0; height:0; position:absolute;';

const toggleTrack = document.createElement('span');
toggleTrack.style.cssText = `
    position: absolute; inset: 0;
    background: #0055ff; border-radius: 20px;
    transition: background 0.2s;
`;
const toggleThumb = document.createElement('span');
toggleThumb.style.cssText = `
    position: absolute; width: 14px; height: 14px;
    background: white; border-radius: 50%;
    top: 3px; left: 3px;
    transition: transform 0.2s;
    transform: translateX(16px);
`;
toggleTrack.appendChild(toggleThumb);
toggleWrap.appendChild(toggleInput);
toggleWrap.appendChild(toggleTrack);
xrayToggleRow.appendChild(xrayToggleLabel);
xrayToggleRow.appendChild(toggleWrap);
xrayBody.appendChild(xrayToggleRow);

function applyXrayToggle(enabled) {
    coneState.xrayEnabled            = enabled;
    toggleTrack.style.background     = enabled ? '#0055ff' : '#444';
    toggleThumb.style.transform      = `translateX(${enabled ? 16 : 0}px)`;
    coneSlider.disabled              = !enabled;
    coneSlider.style.opacity         = enabled ? '1' : '0.35';
    coneSlider.style.cursor          = enabled ? 'pointer' : 'not-allowed';
}

toggleInput.addEventListener('change', () => applyXrayToggle(toggleInput.checked));

// --- Panel 3: Inspect Feature ---
const inspectState = { active: false, selectedFeature: null, selectedMesh: null };

const inspectBody = makePanel('🔍  Inspect Feature');
inspectBody.style.height   = '255px';
inspectBody.style.overflow = 'hidden';
inspectBody.style.paddingBottom = '0';

const inspectToggleRow = document.createElement('div');
inspectToggleRow.style.cssText = 'display:flex; align-items:center; gap:10px;';

const inspectToggleLbl = document.createElement('span');
inspectToggleLbl.textContent = 'Inspect Mode';
inspectToggleLbl.style.cssText = 'min-width:110px; color:#ccc; font-size:13px;';

const inspectToggleWrap = document.createElement('label');
inspectToggleWrap.style.cssText = `
    position: relative; display: inline-block;
    width: 36px; height: 20px; cursor: pointer; flex-shrink: 0;
`;
const inspectToggleInput = document.createElement('input');
inspectToggleInput.type    = 'checkbox';
inspectToggleInput.checked = false;
inspectToggleInput.style.cssText = 'opacity:0; width:0; height:0; position:absolute;';

const inspectToggleTrack = document.createElement('span');
inspectToggleTrack.style.cssText = `
    position: absolute; inset: 0;
    background: #444; border-radius: 20px;
    transition: background 0.2s;
`;
const inspectToggleThumb = document.createElement('span');
inspectToggleThumb.style.cssText = `
    position: absolute; width: 14px; height: 14px;
    background: white; border-radius: 50%;
    top: 3px; left: 3px;
    transition: transform 0.2s;
    transform: translateX(0px);
`;
inspectToggleTrack.appendChild(inspectToggleThumb);
inspectToggleWrap.appendChild(inspectToggleInput);
inspectToggleWrap.appendChild(inspectToggleTrack);
inspectToggleRow.appendChild(inspectToggleLbl);
inspectToggleRow.appendChild(inspectToggleWrap);

const inspectInfo = document.createElement('div');
inspectInfo.style.cssText = `
    margin-top: 10px;
    padding: 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid #1a1a1a;
    border-radius: 4px;
    height: calc(100% - 44px);
    overflow-y: auto;
    font-size: 13px;
    color: #555;
    line-height: 1.7;
`;
inspectInfo.textContent = 'Click a pipeline, reservoir, or pump station to inspect.';

// Tracks whether x-ray was already on before inspect mode forced it on
let _xrayBeforeInspect = false;

inspectToggleInput.addEventListener('change', () => {
    const on = inspectToggleInput.checked;
    inspectState.active                  = on;
    inspectToggleTrack.style.background  = on ? '#00aaff' : '#444';
    inspectToggleThumb.style.transform   = `translateX(${on ? 16 : 0}px)`;
    renderer.domElement.style.cursor     = on ? 'pointer' : 'default';
    const panel = inspectBody.parentElement;
    if (on) {
        panel.style.borderWidth = '2px';
        panel.style.animation   = 'inspect-breathe 5s ease-in-out infinite';
        panel.style.background  = 'rgba(0,40,50,0.85)';
        // Force x-ray on; remember whether it was already on so we can restore later
        _xrayBeforeInspect = coneState.xrayEnabled;
        if (!coneState.xrayEnabled) {
            toggleInput.checked = true;
            applyXrayToggle(true);
        }
    } else {
        panel.style.animation   = '';
        panel.style.borderColor = '#2a2a2a';
        panel.style.borderWidth = '1px';
        panel.style.background  = 'rgba(0,0,0,0.75)';
        // Restore x-ray to its pre-inspect state only if we forced it on
        if (!_xrayBeforeInspect) {
            toggleInput.checked = false;
            applyXrayToggle(false);
        }
        _clearInspect();
    }
});

inspectBody.appendChild(inspectToggleRow);
inspectBody.appendChild(inspectInfo);

// Collapsing the inspect panel while active turns inspect mode off.
// makePanel's header listener fires first and hides the body, so by the
// time this listener runs display is already 'none' when collapsing.
inspectBody.previousElementSibling.addEventListener('click', () => {
    if (inspectBody.style.display === 'none' && inspectState.active) {
        inspectToggleInput.checked = false;
        inspectToggleInput.dispatchEvent(new Event('change'));
    }
});

// --- Panel 4: Filter Pipelines ---
const _filterActive = { materials: new Set(), diameters: new Set() };
let _filterCheckboxes = [];   // { type, value, input } for bulk-uncheck on collapse

const filterBody = makePanel('⚗  Filter Pipelines', false);
filterBody.style.maxHeight    = '300px';
filterBody.style.overflowY    = 'auto';
filterBody.style.paddingBottom = '8px';

// Placeholder until pipes finish loading
const _filterPlaceholder = document.createElement('div');
_filterPlaceholder.textContent = 'Loading pipeline data…';
_filterPlaceholder.style.cssText = 'color:#555; font-size:12px; font-style:italic;';
filterBody.appendChild(_filterPlaceholder);

function _filterSectionHeader(label) {
    const h = document.createElement('div');
    h.textContent = label;
    h.style.cssText = 'font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#555; margin: 10px 0 4px;';
    return h;
}

function _filterCheckboxRow(label, type, value) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex; align-items:center; gap:7px; cursor:pointer; padding:2px 0;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.cssText = 'cursor:pointer; accent-color:#ff2222; flex-shrink:0;';
    const txt = document.createElement('span');
    txt.textContent = label;
    txt.style.cssText = 'font-size:12px; color:#bbb;';
    row.appendChild(cb);
    row.appendChild(txt);
    cb.addEventListener('change', () => {
        if (cb.checked) _filterActive[type].add(value);
        else            _filterActive[type].delete(value);
        _applyFilter();
    });
    _filterCheckboxes.push({ type, value, input: cb });
    return row;
}

function _buildFilterUI() {
    _filterPlaceholder.remove();
    const feats = pipeNetwork.featureIndex;

    const materials = [...new Set(feats.map(f => f.material).filter(v => v != null))].sort();
    const diameters = [...new Set(feats.map(f => f.diam_mm).filter(v => v != null))].sort((a, b) => a - b);

    filterBody.appendChild(_filterSectionHeader('Material'));
    for (const m of materials) filterBody.appendChild(_filterCheckboxRow(m, 'materials', m));

    filterBody.appendChild(_filterSectionHeader('Diameter (mm)'));
    for (const d of diameters) filterBody.appendChild(_filterCheckboxRow(`${d} mm`, 'diameters', d));
}

function _clearFilter() {
    _filterActive.materials.clear();
    _filterActive.diameters.clear();
    for (const { input } of _filterCheckboxes) input.checked = false;
    _filterHighlightMesh.visible = false;
    clearFilterHighlight();
}

function _applyFilter() {
    const hasMat = _filterActive.materials.size > 0;
    const hasDia = _filterActive.diameters.size > 0;

    if (!hasMat && !hasDia) {
        _filterHighlightMesh.visible = false;
        clearFilterHighlight();
        return;
    }

    const matched = pipeNetwork.featureIndex.filter(f => {
        const matOk = !hasMat || _filterActive.materials.has(f.material);
        const diaOk = !hasDia || _filterActive.diameters.has(f.diam_mm);
        return matOk && diaOk;
    });

    if (matched.length === 0) {
        _filterHighlightMesh.visible = false;
        clearFilterHighlight();
        return;
    }

    const srcPos  = pipeNetwork.geometry.getAttribute('position');
    const total   = matched.reduce((s, f) => s + f.vertexCount, 0);
    const arr     = new Float32Array(total * 3);
    let cursor = 0;
    for (const f of matched) {
        for (let i = 0; i < f.vertexCount; i++) {
            arr[cursor * 3 + 0] = srcPos.getX(f.vertexStart + i);
            arr[cursor * 3 + 1] = srcPos.getY(f.vertexStart + i);
            arr[cursor * 3 + 2] = srcPos.getZ(f.vertexStart + i);
            cursor++;
        }
    }
    _filterHighlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    _filterHighlightMesh.visible = true;

    highlightFilterFeatures(matched.map(f => f.geoJsonFeature));
}

// Collapsing the filter panel clears all selections
filterBody.previousElementSibling.addEventListener('click', () => {
    if (filterBody.style.display === 'none') _clearFilter();
});

// Clock for animations
const clock = new THREE.Clock();

// Loading manager — GLB assets only.
// Note: onProgress gives item counts (1 of 1) for a single file, not bytes —
// the buildings bar will hold at 0% then snap to 100% on onLoad.
const loadingManager = new THREE.LoadingManager();
loadingManager.onProgress = (_url, loaded, total) => taskProgress('buildings', loaded, total);
loadingManager.onLoad     = () => { taskDone('buildings'); console.log('All GLB models loaded.'); };

const loader = new GLTFLoader(loadingManager);

// --- Pipe network state ---
const pipeNetwork = {
    mesh:         null,
    featureIndex: [],
    geometry:     null,
};

// Inspectable 3-D meshes (reservoirs + pump stations) — populated as assets load
const _inspectMeshes = [];

// Coordinate origin and DEM bounds imported from constants.js

function qgisToThree(x, y, z) {
    return new THREE.Vector3(
         x - ORIGIN_X,
         z + ELEVATION_OFFSET,
        -(y - ORIGIN_Y)
    );
}

// --- Animated pipe material ---
function createPipeMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            time:          { value: 0.0 },
            colorA:        { value: new THREE.Color(0x0055ff) },
            colorB:        { value: new THREE.Color(0x00ccff) },
            bandFrequency: { value: 0.3 },
            speed:         { value: 4.0 },
        },
        vertexShader: `
            attribute float lineArcLen;
            varying float vArcLen;
            void main() {
                vArcLen = lineArcLen;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform vec3 colorA;
            uniform vec3 colorB;
            uniform float bandFrequency;
            uniform float speed;
            varying float vArcLen;
            void main() {
                float band = sin((vArcLen * bandFrequency) - (time * speed));
                float t = band * 0.5 + 0.5;
                vec3 color = mix(colorA, colorB, t);
                gl_FragColor = vec4(color, 1.0);
            }
        `,
    });
}

// Cached reference to the compiled terrain shader — set in onBeforeCompile,
// used in the animate loop to avoid a full scene.traverse every frame.
let _terrainShader = null;

// --- Load Terrain ---
initTerrain(scene, {
    onDEMLoaded:    () => taskDone('dem'),
    onTileProgress: (n, total) => taskProgress('tiles', n, total),
}).then((terrainMesh) => {
    taskDone('tiles'); // idempotent — ensures 100% if final onTileProgress already fired
    const terrainMaterial = terrainMesh.material;



    terrainMaterial.transparent = true;

    terrainMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.camPos        = { value: camera.position.clone() };
        shader.uniforms.camDir        = { value: new THREE.Vector3() };
        shader.uniforms.coneCosCutoff = { value: Math.cos(THREE.MathUtils.degToRad(25)) };
        shader.uniforms.coneSoftness  = { value: 0.05 };
        shader.uniforms.xrayEnabled   = { value: 1.0 };

        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldPos;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec3  camPos;
            uniform vec3  camDir;
            uniform float coneCosCutoff;
            uniform float coneSoftness;
            uniform float xrayEnabled;
            varying vec3  vWorldPos;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            vec3  toFrag   = normalize(vWorldPos - camPos);
            float cosAngle = dot(toFrag, camDir);
            float t = smoothstep(coneCosCutoff + coneSoftness,
                                 coneCosCutoff - coneSoftness,
                                 cosAngle);
            gl_FragColor.a = mix(1.0, mix(0.15, 1.0, t), xrayEnabled);`
        );
        terrainMaterial.userData.shader = shader;
        _terrainShader = shader;
    };

    terrainMaterial.needsUpdate = true;

    // --- Street Lights (nested here so DEM is guaranteed loaded) ---
    fetch('street_lights.geojson')
        .then(r => r.json())
        .then(geojson => {
            const HEIGHT   = 7;
            const features = geojson.features;
            const count    = features.length;
            const positions = new Float32Array(count * 3);
            const colors    = new Float32Array(count * 3);
            const c = new THREE.Color(0xddeeff);
            for (let i = 0; i < count; i++) {
                const [ex, ny] = features[i].geometry.coordinates;
                const elev = sampleTerrainElevation(ex, ny);
                positions[i*3+0] =  ex - ORIGIN_X;
                positions[i*3+1] =  elev + HEIGHT;
                positions[i*3+2] = -(ny - ORIGIN_Y);
                const vary = 0.9 + Math.random() * 0.1;
                colors[i*3+0] = c.r * vary;
                colors[i*3+1] = c.g * vary;
                colors[i*3+2] = c.b * vary;
            }
            _shufflePointBuffers(positions, colors, count);
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geom.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
            geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 99999);
            const mat = new THREE.PointsMaterial({
                size: 16, map: _makeLightSprite(), vertexColors: true,
                transparent: true, opacity: 1.0, depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const points = new THREE.Points(geom, mat);
            points.frustumCulled = false;
            points.renderOrder   = 1; // render after terrain (transparent sort fix)
            scene.add(points);
            _streetLights = points;
            _streetCount  = count;
            updateBuildingLights(_currentTimeT);
            console.log(`Street lights loaded — ${count} points`);
            taskSubDone('lighting');
        })
        .catch(err => { console.error('Street lights load error:', err); taskSubDone('lighting'); });

    // --- Highway Lights (nested here so DEM is guaranteed loaded) ---
    fetch('highway_lights.geojson')
        .then(r => r.json())
        .then(geojson => {
            const HEIGHT   = 10;
            const features = geojson.features;
            const count    = features.length;
            const positions = new Float32Array(count * 3);
            const colors    = new Float32Array(count * 3);
            const c = new THREE.Color(0xffaa44);
            for (let i = 0; i < count; i++) {
                const [ex, ny] = features[i].geometry.coordinates;
                const elev = sampleTerrainElevation(ex, ny);
                positions[i*3+0] =  ex - ORIGIN_X;
                positions[i*3+1] =  elev + HEIGHT;
                positions[i*3+2] = -(ny - ORIGIN_Y);
                const vary = 0.88 + Math.random() * 0.12;
                colors[i*3+0] = Math.min(1, c.r * vary * 1.5);
                colors[i*3+1] = Math.min(1, c.g * vary * 1.5);
                colors[i*3+2] = Math.min(1, c.b * vary * 1.5);
            }
            _shufflePointBuffers(positions, colors, count);
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geom.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
            geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 99999);
            const mat = new THREE.PointsMaterial({
                size: 30, map: _makeLightSprite(), vertexColors: true,
                transparent: true, opacity: 1.0, depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const points = new THREE.Points(geom, mat);
            points.frustumCulled = false;
            points.renderOrder   = 1; // render after terrain (transparent sort fix)
            scene.add(points);
            _highwayLights = points;
            _highwayCount  = count;
            updateBuildingLights(_currentTimeT);
            console.log(`Highway lights loaded — ${count} points`);
            taskSubDone('lighting');
        })
        .catch(err => { console.error('Highway lights load error:', err); taskSubDone('lighting'); });
});

// --- Load Buildings ---
loader.load(
    'buildings.glb',
    (gltf) => {
        const buildings = gltf.scene;
        const buildingMaterial = new THREE.MeshLambertMaterial({
            color: 0xb0b0b0,
        });
        buildings.traverse((child) => {
            if (child.isMesh) {
                child.castShadow    = true;
                child.receiveShadow = true;
                child.material      = buildingMaterial;
                // Shift buildings down by 2 units
                child.position.y   -= 2;
            }
        });
		
        scene.add(buildings);
        console.log('Buildings loaded');
    },
    undefined,
    (error) => console.error('Buildings error:', error)
);

// --- Pipe inspect: raycaster, highlight mesh, helpers ---
const _raycaster = new THREE.Raycaster();
_raycaster.params.Line = { threshold: 15 }; // world-unit pick radius for line segments

const _highlightGeo  = new THREE.BufferGeometry();
const _highlightMesh = new THREE.LineSegments(
    _highlightGeo,
    new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: false })
);
_highlightMesh.renderOrder  = 1;
_highlightMesh.frustumCulled = false;
_highlightMesh.visible       = false;
scene.add(_highlightMesh);

// Filter highlight — multiple features, same red, rendered on top
const _filterHighlightGeo  = new THREE.BufferGeometry();
const _filterHighlightMesh = new THREE.LineSegments(
    _filterHighlightGeo,
    new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: false })
);
_filterHighlightMesh.renderOrder   = 1;
_filterHighlightMesh.frustumCulled = false;
_filterHighlightMesh.visible       = false;
scene.add(_filterHighlightMesh);

function _clearInspect() {
    // Restore pipe highlight
    _highlightMesh.visible = false;
    // Restore 3-D mesh colour
    if (inspectState.selectedMesh) {
        inspectState.selectedMesh.material.color.setHex(
            inspectState.selectedMesh.userData._origColor
        );
        inspectState.selectedMesh = null;
    }
    inspectState.selectedFeature = null;
    inspectInfo.style.color      = '#555';
    inspectInfo.textContent      = 'Click a pipeline, reservoir, or pump station to inspect.';
    clearMinimapHighlight();
}

function _highlightPipe(feature) {
    const srcPos = pipeNetwork.geometry.getAttribute('position');
    const count  = feature.vertexCount;
    const arr    = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        arr[i * 3 + 0] = srcPos.getX(feature.vertexStart + i);
        arr[i * 3 + 1] = srcPos.getY(feature.vertexStart + i);
        arr[i * 3 + 2] = srcPos.getZ(feature.vertexStart + i);
    }
    _highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    _highlightMesh.visible = true;
    highlightMinimapFeature(feature.geoJsonFeature, 'pipeline');
}

function _highlightSceneMesh(mesh) {
    if (inspectState.selectedMesh && inspectState.selectedMesh !== mesh) {
        inspectState.selectedMesh.material.color.setHex(
            inspectState.selectedMesh.userData._origColor
        );
    }
    mesh.material.color.setHex(0xff2222);
    inspectState.selectedMesh = mesh;
    highlightMinimapFeature(mesh.userData.geoJsonFeature, mesh.userData.type);
}

function _showFeatureInfo(type, data) {
    const headings = {
        pipeline:     'PIPELINE',
        reservoir:    'RESERVOIR',
        pump_station: 'PUMP STATION',
    };
    const heading = headings[type] ?? type.toUpperCase();

    const rows =
        type === 'pipeline'
        ? [
            ['FID',      data.fid      != null ? String(data.fid)      : '—'],
            ['Material', data.material != null ? String(data.material) : '—'],
            ['Diameter', data.diam_mm  != null ? `${data.diam_mm} mm`  : '—'],
          ]
        : type === 'reservoir'
        ? [
            ['FID',      data.fid          != null ? String(data.fid)              : '—'],
            ['Name',     data.name         != null ? String(data.name)             : '—'],
            ['TWL',      data.twl_m        != null ? `${data.twl_m} m`             : '—'],
            ['Capacity', data.capacity_kl  != null ? `${data.capacity_kl} kL`      : '—'],
          ]
        : /* pump_station */ [
            ['FID',          data.fid            != null ? String(data.fid)            : '—'],
            ['Name',         data.name           != null ? String(data.name)           : '—'],
            ['Flow',         data.flow_ls        != null ? `${data.flow_ls} L/s`       : '—'],
            ['Head',         data.head_m         != null ? `${data.head_m} m`          : '—'],
            ['Suction Res',  data.suction_res_id != null ? String(data.suction_res_id) : '—'],
            ['Delivery Res', data.delivery_rs_id != null ? String(data.delivery_rs_id) : '—'],
          ];

    inspectInfo.style.color = '#e0e0e0';
    inspectInfo.innerHTML =
        `<div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#00ccff;
                     margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #333;">
            ${heading}
         </div>` +
        rows.map(([k, v]) =>
            `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e1e1e;">
                <span style="color:#00ccff;font-weight:700;">${k}</span>
                <span style="color:#ffffff;font-weight:400;">${v}</span>
             </div>`
        ).join('');
}

// --- Load Water Pipes from GeoJSON ---
fetch('pipelines_exported.geojson')
    .then(r => r.json())
    .then(geojson => {
        const positions  = [];
        const arcLengths = [];  // per-vertex cumulative arc length along each feature
        let vertexCursor = 0;

        geojson.features.forEach(feature => {
            const props       = feature.properties;
            const geom        = feature.geometry;
            const vertexStart = vertexCursor;

            const lines = geom.type === 'MultiLineString'
                ? geom.coordinates
                : [geom.coordinates];

            lines.forEach(line => {
                let cumLen = 0;
                for (let i = 0; i < line.length - 1; i++) {
                    const [ax, ay, az = 0] = line[i];
                    const [bx, by, bz = 0] = line[i + 1];

                    const a = qgisToThree(ax, ay, az);
                    const b = qgisToThree(bx, by, bz);

                    // Arc-length at start vertex, then advance and record end vertex
                    arcLengths.push(cumLen);
                    cumLen += a.distanceTo(b);
                    arcLengths.push(cumLen);

                    positions.push(a.x, a.y, a.z);
                    positions.push(b.x, b.y, b.z);
                    vertexCursor += 2;
                }
            });

            const vertexCount = vertexCursor - vertexStart;

            pipeNetwork.featureIndex.push({
                fid:          props.fid      ?? null,
                material:     props.material ?? null,
                diam_mm:      props.diam_mm  ?? null,
                vertexStart,
                vertexCount,
                geoJsonFeature: feature,
            });
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        );
        geometry.setAttribute(
            'lineArcLen',
            new THREE.Float32BufferAttribute(arcLengths, 1)
        );

        const material = createPipeMaterial();
        const mesh     = new THREE.LineSegments(geometry, material);
        mesh.castShadow    = false;
        mesh.receiveShadow = false;

        pipeNetwork.mesh     = mesh;
        pipeNetwork.geometry = geometry;

        scene.add(mesh);
        _buildFilterUI();

        console.log(`Pipes loaded — ${pipeNetwork.featureIndex.length} features`);
        console.log('Sample feature:', pipeNetwork.featureIndex[0]);
        _minimapGeoJSON.pipelines = geojson;
        _tryAddMinimapLayers();
        taskDone('pipelines');
    })
    .catch(err => { console.error('GeoJSON load error:', err); taskDone('pipelines'); });

// --- Load Reservoirs from GeoJSON ---
fetch('reservoirs.geojson')
    .then(r => r.json())
    .then(geojson => {
        const RESERVOIR_RADIUS   = 15;   // metres  (30 m diameter)
        const RESERVOIR_HEIGHT   = 5;    // metres
        const RESERVOIR_SEGMENTS = 32;

        const reservoirGeom = new THREE.CylinderGeometry(
            RESERVOIR_RADIUS,
            RESERVOIR_RADIUS,
            RESERVOIR_HEIGHT,
            RESERVOIR_SEGMENTS
        );

        const RESERVOIR_COLOR = 0x00ccff;  // pipe animation bright blue

        geojson.features.forEach(feature => {
            const [ex, ny, ez = 0] = feature.geometry.coordinates;

            const sceneX =  ex - ORIGIN_X;
            const sceneZ = -(ny - ORIGIN_Y);
            // ez is the DEM surface elevation — no ELEVATION_OFFSET, these are above ground.
            // Cylinder origin is at its centre, so raise by half-height so base sits on terrain.
            const sceneY = ez + RESERVOIR_HEIGHT / 2;

            // Clone material per mesh so inspect highlighting doesn't affect all instances
            const mesh = new THREE.Mesh(
                reservoirGeom,
                new THREE.MeshBasicMaterial({ color: RESERVOIR_COLOR })
            );
            mesh.position.set(sceneX, sceneY, sceneZ);
            mesh.castShadow    = true;
            mesh.receiveShadow = true;

            mesh.userData = {
                type:           'reservoir',
                fid:            feature.properties.fid,
                name:           feature.properties.name,
                twl_m:          feature.properties.twl_m,
                capacity_kl:    feature.properties.capacity_kl,
                _origColor:     RESERVOIR_COLOR,
                geoJsonFeature: feature,
            };

            _inspectMeshes.push(mesh);
            scene.add(mesh);
        });

        console.log(`Reservoirs loaded — ${geojson.features.length} features`);
        _minimapGeoJSON.reservoirs = geojson;
        _tryAddMinimapLayers();
        taskSubDone('infrastructure');
    })
    .catch(err => { console.error('Reservoir GeoJSON load error:', err); taskSubDone('infrastructure'); });

// --- Load Pump Stations from GeoJSON ---
fetch('pump_stations.geojson')
    .then(r => r.json())
    .then(geojson => {
        const PS_LENGTH   = 6;    // metres (X)
        const PS_WIDTH    = 4.5;  // metres (Z)
        const PS_HEIGHT   = 3;    // metres (Y)

        const pumpGeom = new THREE.BoxGeometry(PS_LENGTH, PS_HEIGHT, PS_WIDTH);

        const PUMP_COLOR = 0x00ccff;  // pipe animation bright blue

        geojson.features.forEach(feature => {
            const [ex, ny, ez = 0] = feature.geometry.coordinates;

            const sceneX =  ex - ORIGIN_X;
            const sceneZ = -(ny - ORIGIN_Y);
            // Base sits on terrain surface — no ELEVATION_OFFSET, lift by half-height
            const sceneY = ez + PS_HEIGHT / 2;

            // Clone material per mesh so inspect highlighting doesn't affect all instances
            const mesh = new THREE.Mesh(
                pumpGeom,
                new THREE.MeshBasicMaterial({ color: PUMP_COLOR })
            );
            mesh.position.set(sceneX, sceneY, sceneZ);
            mesh.castShadow    = true;
            mesh.receiveShadow = true;

            mesh.userData = {
                type:           'pump_station',
                fid:            feature.properties.fid,
                name:           feature.properties.name,
                flow_ls:        feature.properties.flow_ls,
                head_m:         feature.properties.head_m,
                suction_res_id: feature.properties.suction_res_id,
                delivery_rs_id: feature.properties.delivery_rs_id,
                _origColor:     PUMP_COLOR,
                geoJsonFeature: feature,
            };

            _inspectMeshes.push(mesh);
            scene.add(mesh);
        });

        console.log(`Pump stations loaded — ${geojson.features.length} features`);
        _minimapGeoJSON.pumpStations = geojson;
        _tryAddMinimapLayers();
        taskSubDone('infrastructure');
    })
    .catch(err => { console.error('Pump station GeoJSON load error:', err); taskSubDone('infrastructure'); });

// --- Shared time state (read by animate loop) ---
let _currentTimeT = 0.5;

// --- Building lights ---
// Returns fraction of lights that should be ON (0→1).
// Building lights ramp gradually; street/highway lights use this too but
// treated as a binary threshold (any value > 0 = all on).
function _lightsFraction(t) {
    // Morning ramp-down
    if (t <= 0.028) return 1.0;
    if (t <= 0.056) return 1.0 - 0.5  * ((t - 0.028) / 0.028);   // 1.0 → 0.5
    if (t <= 0.083) return 0.5 - 0.4  * ((t - 0.056) / 0.027);   // 0.5 → 0.1
    if (t <= 0.097) return 0.1 - 0.1  * ((t - 0.083) / 0.014);   // 0.1 → 0.0
    // Daytime
    if (t < 0.903)  return 0.0;
    // Evening ramp-up
    if (t <= 0.917) return 0.1  * ((t - 0.903) / 0.014);          // 0.0 → 0.1
    if (t <= 0.944) return 0.1  + 0.4 * ((t - 0.917) / 0.027);   // 0.1 → 0.5
    if (t <= 0.972) return 0.5  + 0.5 * ((t - 0.944) / 0.028);   // 0.5 → 1.0
    return 1.0;
}

// Fisher-Yates shuffle of paired position+color entries in Float32Arrays
function _shufflePointBuffers(positions, colors, count) {
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        // Swap position
        for (let k = 0; k < 3; k++) {
            const tmp = positions[i*3+k];
            positions[i*3+k] = positions[j*3+k];
            positions[j*3+k] = tmp;
        }
        // Swap color
        for (let k = 0; k < 3; k++) {
            const tmp = colors[i*3+k];
            colors[i*3+k] = colors[j*3+k];
            colors[j*3+k] = tmp;
        }
    }
}

const buildingLights = { points: null, count: 0 };
let _streetLights  = null;
let _streetCount   = 0;
let _highwayLights = null;
let _highwayCount  = 0;

function updateBuildingLights(t) {
    _currentTimeT = t;
    const fraction = _lightsFraction(t);

    // Building lights — gradual draw range
    if (buildingLights.points) {
        const n = Math.round(fraction * buildingLights.count);
        buildingLights.points.geometry.setDrawRange(0, n);
    }

    // Street lights — all or nothing
    if (_streetLights) {
        _streetLights.geometry.setDrawRange(0, fraction > 0 ? _streetCount : 0);
    }

    // Highway lights — all or nothing
    if (_highwayLights) {
        _highwayLights.geometry.setDrawRange(0, fraction > 0 ? _highwayCount : 0);
    }
}

fetch('building_centroids.geojson')
    .then(r => r.json())
    .then(geojson => {
        const features = geojson.features;
        const count    = features.length;

        const positions = new Float32Array(count * 3);
        const colors    = new Float32Array(count * 3);

        // Colour palette — cool white through warm white to candlelight
        const palette = [
            new THREE.Color(0xddeeff),  // cool blue-white
            new THREE.Color(0xf0f4ff),  // neutral white
            new THREE.Color(0xfff8e8),  // warm white
            new THREE.Color(0xffeecc),  // soft yellow
            new THREE.Color(0xffdd99),  // warm yellow
            new THREE.Color(0xffcc77),  // amber
            new THREE.Color(0xffbb55),  // candlelight orange
        ];

        for (let i = 0; i < count; i++) {
            const [ex, ny, ez = 0] = features[i].geometry.coordinates;

            const jitterX = (Math.random() - 0.5) * 6;
            const jitterZ = (Math.random() - 0.5) * 6;

            positions[i * 3 + 0] =  (ex - ORIGIN_X) + jitterX;
            positions[i * 3 + 1] =  ez + 4.0;
            positions[i * 3 + 2] = -(ny - ORIGIN_Y) + jitterZ;

            const base = palette[Math.floor(Math.random() * palette.length)].clone();
            const vary = 0.85 + Math.random() * 0.15;
            base.multiplyScalar(vary);
            colors[i * 3 + 0] = base.r;
            colors[i * 3 + 1] = base.g;
            colors[i * 3 + 2] = base.b;
        }

        // Shuffle so draw range fills in randomly across the city
        _shufflePointBuffers(positions, colors, count);

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
        geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 99999);

        const mat = new THREE.PointsMaterial({
            size:         20,
            map:          _makeLightSprite(),
            vertexColors: true,
            transparent:  true,
            opacity:      1.0,
            depthWrite:   false,
            blending:     THREE.AdditiveBlending,
        });

        buildingLights.points = new THREE.Points(geom, mat);
        buildingLights.points.frustumCulled = false;
        buildingLights.points.renderOrder   = 1; // render after terrain (transparent sort fix)
        buildingLights.count  = count;
        scene.add(buildingLights.points);

        updateBuildingLights(_currentTimeT);
        console.log(`Building lights loaded — ${count} points`);
        taskDone('centroids');
    })
    .catch(err => { console.error('Building centroids load error:', err); taskDone('centroids'); });

function _makeLightSprite() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0.0,  'rgba(255,255,255,1.0)');
    grad.addColorStop(0.12, 'rgba(240,248,255,0.9)');
    grad.addColorStop(0.28, 'rgba(200,225,255,0.4)');
    grad.addColorStop(0.5,  'rgba(180,210,255,0.08)');
    grad.addColorStop(1.0,  'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

// Handle resize
window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Reusable vector for camera forward direction
const camForward = new THREE.Vector3();

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const elapsed = clock.getElapsedTime();

    // Sun at a fixed world position — never follows the camera, so shadows stay still.
    // Target remains at the world origin (default); only direction changes with TOD slider.
    sunLight.position.copy(sunDirection).multiplyScalar(7000);
    sunLight.target.updateMatrixWorld();

    // Compute camera forward direction
    camera.getWorldDirection(camForward);

	//update mini-map
	updateMinimap(camera, cameraState, coneState);

    // Update terrain shader uniforms
    if (_terrainShader) {
        const u = _terrainShader.uniforms;
        u.camPos.value.copy(camera.position);
        u.camDir.value.copy(camForward);
        u.coneCosCutoff.value = Math.cos(THREE.MathUtils.degToRad(coneState.halfAngleDeg));
        u.xrayEnabled.value   = coneState.xrayEnabled ? 1.0 : 0.0;
    }

    // Animate pipes
    if (pipeNetwork.mesh) {
        pipeNetwork.mesh.material.uniforms.time.value = elapsed;
    }

    // Keep building lights in sync with current time slider value
    updateBuildingLights(_currentTimeT);

    renderer.render(scene, camera);
}

animate();