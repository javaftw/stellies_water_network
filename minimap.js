// ─── minimap.js ──────────────────────────────────────────────────────────────
// Leaflet minimap — bottom-left, collapseable.
// Map centres on the x-ray cone ground intersection (where you're looking).
// Camera dot shows actual camera position.
// Cone centre marker rotates to show view direction.
//
// USAGE:
//   import { initMinimap, updateMinimap } from './minimap.js';
//   initMinimap();
//   // In animate loop:
//   updateMinimap(camera, cameraState, coneState);
// ─────────────────────────────────────────────────────────────────────────────

import { ORIGIN_X, ORIGIN_Y, DEM_E_MIN, DEM_E_MAX, DEM_N_MIN, DEM_N_MAX } from './constants.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_MIN_ZOOM    = 12;
const MAP_MAX_ZOOM    = 17;
const MAP_INIT_ZOOM   = 14;
const MAP_W           = 400;
const MAP_H           = 400;
const FOV_MAX_DIST    = 4000;
const CONE_MAX_RADIUS = 2000;
const CAM_FOV_DEG     = 60;

// ─── UTM 34S → WGS84 linear approximation ────────────────────────────────────
const UTM_TO_LAT_A =  0.000009017;
const UTM_TO_LAT_B = -33.996856 - (0.000009017 * 6236232.9034);
const UTM_TO_LON_A =  0.000010695;
const UTM_TO_LON_B =  18.807270 - (0.000010695 * 297236.0239);

function utmToLatLon(e, n) {
    return [
        UTM_TO_LAT_A * n + UTM_TO_LAT_B,
        UTM_TO_LON_A * e + UTM_TO_LON_B,
    ];
}

function sceneToLatLon(x, z) {
    return utmToLatLon(x + ORIGIN_X, -z + ORIGIN_Y);
}

function sceneToLeaflet(x, z) {
    const [lat, lon] = sceneToLatLon(x, z);
    return L.latLng(lat, lon);
}

// ─── DEM bounds ───────────────────────────────────────────────────────────────
const DEM_SW = utmToLatLon(DEM_E_MIN, DEM_N_MIN);
const DEM_NW = utmToLatLon(DEM_E_MIN, DEM_N_MAX);
const DEM_NE = utmToLatLon(DEM_E_MAX, DEM_N_MAX);
const DEM_SE = utmToLatLon(DEM_E_MAX, DEM_N_MIN);

const DEM_BOUNDS = L.latLngBounds(
    [DEM_SW[0], DEM_SW[1]],
    [DEM_NE[0], DEM_NE[1]]
);

const SCENE_CENTRE = utmToLatLon(ORIGIN_X, ORIGIN_Y);

// ─── State ────────────────────────────────────────────────────────────────────
let _map              = null;
let _cameraMarker     = null;
let _fovPolygon       = null;
let _conePolygon      = null;
let _coneCentreMarker = null;
let _collapsed        = false;
let _lastUpdate       = 0;
const UPDATE_INTERVAL = 1000 / 15;

let _isDragging      = false;
let _dragPrevCenter  = null;
let _prevXrayEnabled = null;  // null forces first-call sync

// Tracks the full expanded height; updated when addMinimapLayers inserts the toolbar
let _openHeight = MAP_H + 28;

// Highlight layer — replaced each time a feature is selected, removed on clear
let _highlightLayer = null;

// ─── Public API ───────────────────────────────────────────────────────────────
export function initMinimap() {
    _buildDOM();
    _buildMap();
}

// Highlight a single GeoJSON feature (passed from inspect mode in main.js).
// type: 'pipeline' | 'reservoir' | 'pump_station'
export function highlightMinimapFeature(geoJsonFeature, type) {
    if (!_map) return;
    if (_highlightLayer) { _map.removeLayer(_highlightLayer); _highlightLayer = null; }

    const toLatLng = (coords) => {
        const [lat, lon] = utmToLatLon(coords[0], coords[1]);
        return L.latLng(lat, lon);
    };

    if (type === 'pipeline') {
        _highlightLayer = L.geoJSON(geoJsonFeature, {
            coordsToLatLng: toLatLng,
            style: { color: '#ff2222', weight: 4, opacity: 1 },
            interactive: false,
        });
    } else if (type === 'reservoir') {
        _highlightLayer = L.geoJSON(geoJsonFeature, {
            coordsToLatLng: toLatLng,
            pointToLayer: (_feat, latlng) => L.circleMarker(latlng, {
                radius: 9, fillColor: '#ff2222', fillOpacity: 0.95,
                color: '#000', weight: 1.5, interactive: false,
            }),
            interactive: false,
        });
    } else if (type === 'pump_station') {
        _highlightLayer = L.geoJSON(geoJsonFeature, {
            coordsToLatLng: toLatLng,
            pointToLayer: (_feat, latlng) => L.marker(latlng, {
                icon: L.divIcon({
                    className: '',
                    html: `<div style="
                        width:10px;height:10px;
                        background:#ff2222;border:1.5px solid #000;
                        position:relative;top:-5px;left:-5px;
                    "></div>`,
                    iconSize: [0, 0], iconAnchor: [0, 0],
                }),
                interactive: false,
                zIndexOffset: 500,
            }),
            interactive: false,
        });
    }

    if (_highlightLayer) _highlightLayer.addTo(_map);
}

// Remove any active highlight from the minimap.
export function clearMinimapHighlight() {
    if (!_map || !_highlightLayer) return;
    _map.removeLayer(_highlightLayer);
    _highlightLayer = null;
}

// Called from main.js once pipelines, reservoirs, and pump-stations GeoJSON are loaded.
// Adds Leaflet overlays + a checkbox toolbar above the map.
export function addMinimapLayers(pipelines, reservoirs, pumpStations) {
    if (!_map) return;

    // Coordinate conversion: UTM [E, N] → Leaflet LatLng
    const toLatLng = (coords) => {
        const [lat, lon] = utmToLatLon(coords[0], coords[1]);
        return L.latLng(lat, lon);
    };

    // ── Pipe network (lines) ──────────────────────────────────────────────────
    const pipeLayer = L.geoJSON(pipelines, {
        coordsToLatLng: toLatLng,
        style:          { color: '#0077aa', weight: 2.5, opacity: 0.85 },
        interactive:    false,
    }).addTo(_map);

    // ── Reservoirs (filled circles) ───────────────────────────────────────────
    const reservoirLayer = L.geoJSON(reservoirs, {
        coordsToLatLng: toLatLng,
        pointToLayer:   (_feat, latlng) => L.circleMarker(latlng, {
            radius: 5, fillColor: '#00ccff', fillOpacity: 0.95,
            color: '#000', weight: 1.5, interactive: false,
        }),
        interactive: false,
    }).addTo(_map);

    // ── Pump stations (squares) ───────────────────────────────────────────────
    const pumpLayer = L.geoJSON(pumpStations, {
        coordsToLatLng: toLatLng,
        pointToLayer:   (_feat, latlng) => L.marker(latlng, {
            icon: L.divIcon({
                className: '',
                html: `<div style="
                    width:8px;height:8px;
                    background:#00ccff;border:1.5px solid #000;
                    position:relative;top:-4px;left:-4px;
                "></div>`,
                iconSize: [0, 0], iconAnchor: [0, 0],
            }),
            interactive:   false,
            zIndexOffset: -500,  // keep below camera / cone markers
        }),
        interactive: false,
    }).addTo(_map);

    // ── Toolbar ───────────────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        min-height: 28px;
        background: #161616;
        display: flex; align-items: center;
        padding: 0 10px; gap: 16px;
        border-bottom: 1px solid #333;
        user-select: none;
    `;

    function makeCheckbox(label, layer) {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:5px;font-size:11px;color:#aaa;';
        const cb = document.createElement('input');
        cb.type    = 'checkbox';
        cb.checked = true;
        cb.style.cssText = 'cursor:pointer;accent-color:#00ccff;';
        cb.addEventListener('change', () => {
            if (cb.checked) layer.addTo(_map); else _map.removeLayer(layer);
        });
        const txt = document.createElement('span');
        txt.textContent = label;
        lbl.appendChild(cb);
        lbl.appendChild(txt);
        return lbl;
    }

    toolbar.appendChild(makeCheckbox('Pipelines',     pipeLayer));
    toolbar.appendChild(makeCheckbox('Reservoirs',    reservoirLayer));
    toolbar.appendChild(makeCheckbox('Pump Stations', pumpLayer));

    // Insert toolbar between header (child 0) and map div (child 1)
    const container = document.getElementById('minimap-container');
    container.insertBefore(toolbar, container.children[1]);

    // Grow open height to include the 28 px toolbar row
    _openHeight = MAP_H + 28 + 28;
    if (!_collapsed) container.style.height = `${_openHeight}px`;
}

export function updateMinimap(camera, cameraState, coneState) {
    if (_collapsed || !_map || !_cameraMarker) return;

    const now = performance.now();
    if (now - _lastUpdate < UPDATE_INTERVAL) return;
    _lastUpdate = now;

    const cp = camera.position;

    // ── Camera marker (actual camera position) ────────────────────────────────
    const [camLat, camLon] = sceneToLatLon(cp.x, cp.z);
    _cameraMarker.setLatLng(L.latLng(camLat, camLon));

    // ── True 3D forward vector: camera → orbit target ─────────────────────────
    const tx = cameraState.target.x - cp.x;
    const ty = cameraState.target.y - cp.y;
    const tz = cameraState.target.z - cp.z;
    const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
    const fwd3x = tx / tLen;
    const fwd3y = ty / tLen;
    const fwd3z = tz / tLen;

    // phi = angle from straight down (0=down, PI/2=horizontal)
    const phi = Math.acos(Math.max(-1, Math.min(1, -fwd3y)));

    // Ground-plane forward — fallback to theta when looking near-straight-down
    const xzLen = Math.sqrt(fwd3x*fwd3x + fwd3z*fwd3z);
    let fwdX, fwdZ;
    if (xzLen > 0.01) {
        fwdX = fwd3x / xzLen;
        fwdZ = fwd3z / xzLen;
    } else {
        fwdX = -Math.sin(cameraState.theta);
        fwdZ = -Math.cos(cameraState.theta);
    }

    // Height above terrain
    const h       = Math.max(cp.y - cameraState.target.y, 1);
    const groundY = cameraState.target.y;

    // ── Cone centre on ground ─────────────────────────────────────────────────
    const alpha  = coneState.halfAngleDeg * Math.PI / 180;
    const phiMax = Math.PI / 2 - alpha - 0.02;
    const phiC   = Math.min(phi, phiMax);
    const dAxis  = h * Math.tan(phiC);

    const coneCentreX = cp.x + fwdX * dAxis;
    const coneCentreZ = cp.z + fwdZ * dAxis;

    // Clamp cone centre to DEM bounds for map setView
    const [ccLat, ccLon] = sceneToLatLon(coneCentreX, coneCentreZ);
    const centreLatLng = L.latLng(
        Math.max(DEM_BOUNDS.getSouth(), Math.min(DEM_BOUNDS.getNorth(), ccLat)),
        Math.max(DEM_BOUNDS.getWest(),  Math.min(DEM_BOUNDS.getEast(),  ccLon))
    );

    // ── Cone centre marker — position + rotation ──────────────────────────────
    _coneCentreMarker.setLatLng(centreLatLng);

    // Bearing: clockwise from north.
    // Leaflet is north-up. Scene: +X = east, -Z = north.
    // atan2(fwdX, -fwdZ) gives clockwise angle from north.
    const bearingDeg = Math.atan2(fwdX, -fwdZ) * 180 / Math.PI;
    const reticuleEl = document.getElementById('minimap-reticule');
    if (reticuleEl) {
        reticuleEl.style.transform = `rotate(${bearingDeg}deg)`;
    }

    // Map centres on cone intersection — suppressed while user is panning
    if (!_isDragging) {
        _map.setView(centreLatLng, _map.getZoom(), { animate: false });
    }

    // ── Overlays ──────────────────────────────────────────────────────────────
    _updateFOV(cp.x, cp.z, cp.y, groundY, fwd3x, fwd3y, fwd3z, fwdX, fwdZ);

    if (coneState.xrayEnabled !== _prevXrayEnabled) {
        _prevXrayEnabled = coneState.xrayEnabled;
        _conePolygon.setStyle({ opacity: coneState.xrayEnabled ? 0.85 : 0 });
    }
    if (coneState.xrayEnabled) {
        _updateCone(cp.x, cp.z, h, fwdX, fwdZ, phiC, alpha, coneCentreX, coneCentreZ);
    }
}

// ─── FOV footprint ────────────────────────────────────────────────────────────
function _updateFOV(cx, cz, camY, groundY, fwd3x, fwd3y, fwd3z, fwdX, fwdZ) {
    const vFovHalf = (CAM_FOV_DEG / 2) * Math.PI / 180;
    const aspect   = window.innerWidth / window.innerHeight;
    const hFovHalf = Math.atan(Math.tan(vFovHalf) * aspect);

    // Camera right = forward × world-up, normalised in XZ
    let rx = fwd3z, rz = -fwd3x;
    const rLen = Math.sqrt(rx*rx + rz*rz) || 1;
    rx /= rLen; rz /= rLen;
    const ry = 0;

    // Camera up = right × forward
    const ux = ry * fwd3z - rz * fwd3y;
    const uy = rz * fwd3x - rx * fwd3z;
    const uz = rx * fwd3y - ry * fwd3x;

    const corners = [
        [-1, -1], [ 1, -1],
        [ 1,  1], [-1,  1],
    ];

    const points = [];

    for (const [sh, sv] of corners) {
        const tanH = Math.tan(hFovHalf) * sh;
        const tanV = Math.tan(vFovHalf) * sv;

        let rdx = fwd3x + tanH * rx + tanV * ux;
        let rdy = fwd3y + tanH * ry + tanV * uy;
        let rdz = fwd3z + tanH * rz + tanV * uz;
        const rdLen = Math.sqrt(rdx*rdx + rdy*rdy + rdz*rdz) || 1;
        rdx /= rdLen; rdy /= rdLen; rdz /= rdLen;

        if (rdy >= -0.001) {
            points.push(sceneToLeaflet(cx + fwdX * FOV_MAX_DIST,
                                       cz + fwdZ * FOV_MAX_DIST));
            continue;
        }

        let t = (groundY - camY) / rdy;
        const gx = rdx * t, gz = rdz * t;
        const groundDist = Math.sqrt(gx*gx + gz*gz);
        if (groundDist > FOV_MAX_DIST) t *= FOV_MAX_DIST / groundDist;

        points.push(sceneToLeaflet(cx + rdx * t, cz + rdz * t));
    }

    _fovPolygon.setLatLngs(points);
}

// ─── X-ray cone ground intersection ──────────────────────────────────────────
function _updateCone(cx, cz, h, fwdX, fwdZ, phiC, alpha, ecx, ecz) {
    const semiA = Math.min((h * Math.tan(phiC + alpha) - h * Math.tan(phiC - alpha)) / 2, CONE_MAX_RADIUS);
    const semiB = Math.min(h * Math.tan(alpha) / Math.cos(phiC), CONE_MAX_RADIUS);

    const rightX =  fwdZ;
    const rightZ = -fwdX;

    const N      = 64;
    const points = [];
    for (let i = 0; i < N; i++) {
        const a  = (i / N) * Math.PI * 2;
        const px = ecx + fwdX  * semiA * Math.cos(a)
                       + rightX * semiB * Math.sin(a);
        const pz = ecz + fwdZ  * semiA * Math.cos(a)
                       + rightZ * semiB * Math.sin(a);
        points.push(sceneToLeaflet(px, pz));
    }

    _conePolygon.setLatLngs(points);
}

// ─── DOM ──────────────────────────────────────────────────────────────────────
function _buildDOM() {
    const container = document.createElement('div');
    container.id = 'minimap-container';
    container.style.cssText = `
        position: fixed;
        bottom: 0; left: 0;
        width: ${MAP_W}px;
        background: #111;
        border-top: 1px solid #333;
        border-right: 1px solid #333;
        border-radius: 0 8px 0 0;
        overflow: hidden;
        z-index: 200;
        transition: height 0.3s ease;
        height: ${_openHeight}px;
        display: flex;
        flex-direction: column;
        font-family: Arial, sans-serif;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        height: 28px; min-height: 28px;
        background: #1a1a1a;
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 8px; cursor: pointer; user-select: none;
        border-bottom: 1px solid #333;
    `;

    const title = document.createElement('span');
    title.textContent = '📍 Minimap';
    title.style.cssText = 'color:#aaa; font-size:12px; letter-spacing:0.05em;';

    const toggle = document.createElement('span');
    toggle.id = 'minimap-toggle';
    toggle.textContent = '▼';
    toggle.style.cssText = 'color:#666; font-size:10px;';

    header.appendChild(title);
    header.appendChild(toggle);
    header.addEventListener('click', _toggleCollapse);

    const mapDiv = document.createElement('div');
    mapDiv.id = 'minimap-leaflet';
    mapDiv.style.cssText = `width:${MAP_W}px; height:${MAP_H}px; flex:1;`;

    container.appendChild(header);
    container.appendChild(mapDiv);
    document.body.appendChild(container);
}

// ─── Leaflet ──────────────────────────────────────────────────────────────────
function _buildMap() {
    _map = L.map('minimap-leaflet', {
        center:             SCENE_CENTRE,
        zoom:               MAP_INIT_ZOOM,
        zoomControl:        false,
        attributionControl: false,
        dragging:           true,
        scrollWheelZoom:    true,
        doubleClickZoom:    false,
        boxZoom:            false,
        keyboard:           false,
        minZoom:            MAP_MIN_ZOOM,
        maxZoom:            MAP_MAX_ZOOM,
        maxBounds:          DEM_BOUNDS.pad(0.1),
        maxBoundsViscosity: 1.0,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: MAP_MAX_ZOOM,
    }).addTo(_map);

    // Dark mask outside DEM extent
    const worldRing = [[-90,-180],[-90,180],[90,180],[90,-180],[-90,-180]];
    const demHole   = [
        [DEM_SW[0],DEM_SW[1]], [DEM_NW[0],DEM_NW[1]],
        [DEM_NE[0],DEM_NE[1]], [DEM_SE[0],DEM_SE[1]],
        [DEM_SW[0],DEM_SW[1]],
    ];

    L.polygon([worldRing, demHole], {
        color: 'none', fillColor: '#000', fillOpacity: 0.55, interactive: false,
    }).addTo(_map);

    L.polygon([demHole], {
        color: '#444', weight: 1, fill: false, interactive: false,
    }).addTo(_map);

    // FOV — black outline, thicker
    _fovPolygon = L.polygon([[0,0],[0,0],[0,0],[0,0]], {
        color: '#000000', weight: 2.5, opacity: 0.9,
        fill: false, interactive: false,
    }).addTo(_map);

    // X-ray cone — red outline
    _conePolygon = L.polygon([[0,0]], {
        color: '#ff3333', weight: 1.5, opacity: 0.85,
        fill: false, interactive: false,
    }).addTo(_map);

    // Camera dot
    const camIcon = L.divIcon({
        className: '',
        html: `<div style="
            width:10px; height:10px;
            background:#00ccff; border:2px solid #fff;
            border-radius:50%; box-shadow:0 0 6px #00ccff;
            position:relative; top:-5px; left:-5px;
        "></div>`,
        iconSize: [0,0], iconAnchor: [0,0],
    });

    _cameraMarker = L.marker(SCENE_CENTRE, {
        icon: camIcon, interactive: false, zIndexOffset: 1000,
    }).addTo(_map);

    // Cone centre directional reticule — rotates to show view direction.
    // Arrow tip (filled triangle) points in the look direction.
    // transform-origin centred on the crosshair centre (10,10).
    const coneIcon = L.divIcon({
        className: '',
        html: `<div id="minimap-reticule" style="
            position: relative;
            top: -10px; left: -10px;
            width: 20px; height: 20px;
            transform-origin: 10px 10px;
        ">
            <svg width="20" height="20" viewBox="0 0 20 20">
                <!-- Arrow pointing up = forward direction -->
                <polygon points="10,1 7,7 13,7" fill="#ff3333"/>
                <line x1="10" y1="7"  x2="10" y2="19" stroke="#ff3333" stroke-width="1.5"/>
                <!-- Horizontal arm -->
                <line x1="1"  y1="10" x2="19" y2="10" stroke="#ff3333" stroke-width="1.5"/>
                <!-- Small centre dot -->
                <circle cx="10" cy="10" r="1.5" fill="#ff3333"/>
            </svg>
        </div>`,
        iconSize:   [0, 0],
        iconAnchor: [0, 0],
    });

    _coneCentreMarker = L.marker(SCENE_CENTRE, {
        icon:         coneIcon,
        interactive:  false,
        zIndexOffset: 999,
    }).addTo(_map);
	
    // Drag on minimap → pan camera target
    _map.on('dragstart', () => {
        _isDragging     = true;
        _dragPrevCenter = _map.getCenter();
    });

    _map.on('drag', () => {
        const center = _map.getCenter();
        const dLat   = center.lat - _dragPrevCenter.lat;
        const dLon   = center.lng - _dragPrevCenter.lng;
        _dragPrevCenter = center;

        // Invert the UTM linear approximation to get scene deltas
        const dUtmE = dLon / UTM_TO_LON_A;
        const dUtmN = dLat / UTM_TO_LAT_A;
        // scene x = utmE − ORIGIN_X  →  dx = dUtmE
        // scene z = −(utmN − ORIGIN_Y) →  dz = −dUtmN
        window.dispatchEvent(new CustomEvent('minimap-pan', {
            detail: { dx: dUtmE, dz: -dUtmN },
        }));
    });

    _map.on('dragend', () => {
        _isDragging     = false;
        _dragPrevCenter = null;
    });

	// Click on minimap → move camera target to that location
_map.on('click', (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    // Convert LatLon back to scene coordinates
    // Inverse of utmToLatLon:
    //   lat = UTM_TO_LAT_A * n + UTM_TO_LAT_B  →  n = (lat - UTM_TO_LAT_B) / UTM_TO_LAT_A
    //   lon = UTM_TO_LON_A * e + UTM_TO_LON_B  →  e = (lon - UTM_TO_LON_B) / UTM_TO_LON_A
    const utmE = (lon - UTM_TO_LON_B) / UTM_TO_LON_A;
    const utmN = (lat - UTM_TO_LAT_B) / UTM_TO_LAT_A;

    const sceneX =  utmE - ORIGIN_X;
    const sceneZ = -(utmN - ORIGIN_Y);

    // Fire a custom event so main.js can update cameraState.target
    window.dispatchEvent(new CustomEvent('minimap-click', {
        detail: { x: sceneX, z: sceneZ }
    }));
});

    L.control.zoom({ position: 'topright' }).addTo(_map);
}

// ─── Collapse ─────────────────────────────────────────────────────────────────
function _toggleCollapse() {
    _collapsed = !_collapsed;
    const container = document.getElementById('minimap-container');
    const toggle    = document.getElementById('minimap-toggle');
    if (_collapsed) {
        container.style.height = '28px';
        toggle.textContent = '▲';
    } else {
        container.style.height = `${_openHeight}px`;
        toggle.textContent = '▼';
        setTimeout(() => _map.invalidateSize(), 310);
    }
}