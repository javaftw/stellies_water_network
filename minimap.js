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

// ─── WGS84 → UTM 34S (forward Transverse Mercator, Snyder 1987) ──────────────
// Used for minimap click/drag → scene coordinate conversion.
function wgs84ToUtm(latDeg, lonDeg) {
    const a   = 6378137.0;
    const f   = 1 / 298.257223563;
    const e2  = 2*f - f*f;
    const ep2 = e2 / (1 - e2);
    const k0  = 0.9996;
    const l0  = 21.0 * Math.PI / 180;

    const phi = latDeg * Math.PI / 180;
    const lam = lonDeg * Math.PI / 180;

    const sp = Math.sin(phi), cp = Math.cos(phi), tp = sp / cp;
    const N  = a / Math.sqrt(1 - e2*sp*sp);
    const T  = tp*tp;
    const C  = ep2*cp*cp;
    const A  = cp*(lam - l0);
    const A2 = A*A, A3 = A2*A, A4 = A2*A2, A5 = A4*A, A6 = A4*A2;

    const M = a*(
          (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * phi
        - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024)  * Math.sin(2*phi)
        + (15*e2*e2/256 + 45*e2*e2*e2/1024)           * Math.sin(4*phi)
        - (35*e2*e2*e2/3072)                           * Math.sin(6*phi)
    );

    const utmE = 500000 + k0*N*(
        A + (1-T+C)*A3/6 + (5-18*T+T*T+72*C-58*ep2)*A5/120
    );
    const utmN = 10000000 + k0*(
        M + N*tp*(A2/2 + (5-T+9*C+4*C*C)*A4/24 + (61-58*T+T*T+600*C-330*ep2)*A6/720)
    );
    return [utmE, utmN];
}

// ─── UTM 34S → WGS84 (inverse Transverse Mercator, Snyder 1987) ──────────────
// Replaces the old linear approximation that had ~500 m systematic offset.
// Accuracy: better than 0.1 m anywhere inside UTM Zone 34.
function utmToLatLon(e, n) {
    const a   = 6378137.0;              // WGS84 semi-major axis (m)
    const f   = 1 / 298.257223563;      // WGS84 flattening
    const e2  = 2*f - f*f;              // first eccentricity squared
    const ep2 = e2 / (1 - e2);          // second eccentricity squared
    const k0  = 0.9996;                 // UTM scale factor
    const l0  = 21.0 * Math.PI / 180;  // central meridian — UTM Zone 34

    const x = e - 500000.0;            // remove false easting
    const y = n - 10000000.0;          // remove false northing (southern hemisphere)

    // Rectifying latitude μ
    const M  = y / k0;
    const mu = M / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));

    // Footprint latitude φ₁ via series
    const e1   = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const phi1 = mu
        + (3*e1/2    - 27*Math.pow(e1,3)/32) * Math.sin(2*mu)
        + (21*e1*e1/16 - 55*Math.pow(e1,4)/32) * Math.sin(4*mu)
        + (151*Math.pow(e1,3)/96)             * Math.sin(6*mu)
        + (1097*Math.pow(e1,4)/512)           * Math.sin(8*mu);

    // Auxiliary values at φ₁
    const sp1 = Math.sin(phi1), cp1 = Math.cos(phi1);
    const T1  = sp1*sp1 / (cp1*cp1);
    const C1  = ep2 * cp1*cp1;
    const N1  = a / Math.sqrt(1 - e2*sp1*sp1);
    const R1  = a*(1-e2) / Math.pow(1 - e2*sp1*sp1, 1.5);
    const D   = x / (N1*k0);

    // Latitude
    const lat = phi1 - (N1*sp1/cp1/R1) * (
          D*D/2
        - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*ep2)                        * Math.pow(D,4)/24
        + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*ep2 - 3*C1*C1)        * Math.pow(D,6)/720
    );

    // Longitude
    const lon = l0 + (
          D
        - (1 + 2*T1 + C1)                                               * Math.pow(D,3)/6
        + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*ep2 + 24*T1*T1)             * Math.pow(D,5)/120
    ) / cp1;

    return [lat * (180/Math.PI), lon * (180/Math.PI)];
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
let _collapsed        = true;
let _lastUpdate       = 0;
const UPDATE_INTERVAL = 1000 / 15;

let _isDragging      = false;
let _dragPrevCenter  = null;
let _prevXrayEnabled = null;  // null forces first-call sync

// Tracks the full expanded height; updated when addMinimapLayers inserts the toolbar
let _openHeight = MAP_H + 28;

// Toolbar reference — stored so addSuburbsLayer can append to it later
let _toolbar = null;

// Highlight layer — replaced each time a feature is selected, removed on clear
let _highlightLayer = null;

// Filter highlight layer — all pipe features matching the active filter
let _filterHighlightLayer = null;

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

// Highlight all pipeline features matching the active filter (array of GeoJSON features).
export function highlightFilterFeatures(geoJsonFeatures) {
    if (!_map) return;
    if (_filterHighlightLayer) { _map.removeLayer(_filterHighlightLayer); _filterHighlightLayer = null; }
    if (!geoJsonFeatures || geoJsonFeatures.length === 0) return;

    const toLatLng = (coords) => {
        const [lat, lon] = utmToLatLon(coords[0], coords[1]);
        return L.latLng(lat, lon);
    };

    const fc = { type: 'FeatureCollection', features: geoJsonFeatures };
    _filterHighlightLayer = L.geoJSON(fc, {
        coordsToLatLng: toLatLng,
        style:          { color: '#ff2222', weight: 3, opacity: 0.9 },
        interactive:    false,
    }).addTo(_map);
}

// Remove the filter highlight layer.
export function clearFilterHighlight() {
    if (!_map || !_filterHighlightLayer) return;
    _map.removeLayer(_filterHighlightLayer);
    _filterHighlightLayer = null;
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
    _toolbar = document.createElement('div');
    const toolbar = _toolbar;
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

// Adds suburb outlines to the minimap toolbar + Leaflet layer.
// colorMap: { suburbName: '#rrggbb' } — generated in main.js so 3D and 2D share colours.
// Dispatches window CustomEvent 'suburbs-3d-toggle' { detail: { visible: bool } } on change.
export function addSuburbsLayer(data, colorMap) {
    if (!_map || !_toolbar) return;

    // Pre-convert UTM 34S → WGS84 [lon, lat] so Leaflet's default handler works.
    // The suburbs.geojson carries a "crs" field that Leaflet respects, which
    // overrides our coordsToLatLng option and causes misalignment. Stripping
    // the crs field and pre-converting coordinates avoids this entirely.
    const wgs84Data = {
        type: 'FeatureCollection',
        features: data.features.map(feat => ({
            type: 'Feature',
            properties: feat.properties,
            geometry: {
                type: feat.geometry.type,
                coordinates: feat.geometry.coordinates.map(([e, n]) => {
                    const [lat, lon] = utmToLatLon(e, n);
                    return [lon, lat];   // GeoJSON convention: [longitude, latitude]
                }),
            },
        })),
    };

    const suburbLayer = L.geoJSON(wgs84Data, {
        style: feat => ({
            color:   colorMap[feat.properties.SUBURB] || '#ffffff',
            weight:  2,
            opacity: 0.85,
        }),
        interactive: false,
    });
    // NOT added to map yet — checkbox starts unchecked

    const lbl = document.createElement('label');
    lbl.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:5px;font-size:11px;color:#aaa;';
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = true;
    cb.style.cssText = 'cursor:pointer;accent-color:#00ccff;';
    suburbLayer.addTo(_map);
    window.dispatchEvent(new CustomEvent('suburbs-3d-toggle', { detail: { visible: true } }));
    cb.addEventListener('change', () => {
        if (cb.checked) suburbLayer.addTo(_map); else _map.removeLayer(suburbLayer);
        window.dispatchEvent(new CustomEvent('suburbs-3d-toggle', { detail: { visible: cb.checked } }));
    });
    const txt = document.createElement('span');
    txt.textContent = 'Suburbs';
    lbl.appendChild(cb);
    lbl.appendChild(txt);
    _toolbar.appendChild(lbl);
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
        height: 28px;
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
        const [prevE, prevN] = wgs84ToUtm(_dragPrevCenter.lat, _dragPrevCenter.lng);
        const [curE,  curN]  = wgs84ToUtm(center.lat, center.lng);
        _dragPrevCenter = center;

        window.dispatchEvent(new CustomEvent('minimap-pan', {
            detail: { dx: curE - prevE, dz: -(curN - prevN) },
        }));
    });

    _map.on('dragend', () => {
        _isDragging     = false;
        _dragPrevCenter = null;
    });

    // Click on minimap → move camera target to that location
    _map.on('click', (e) => {
        const [utmE, utmN] = wgs84ToUtm(e.latlng.lat, e.latlng.lng);
        window.dispatchEvent(new CustomEvent('minimap-click', {
            detail: { x: utmE - ORIGIN_X, z: -(utmN - ORIGIN_Y) },
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

// Programmatically expand the minimap (used by the intro sequence in main.js).
export function expandMinimap() {
    if (!_collapsed) return;
    _collapsed = false;
    const container = document.getElementById('minimap-container');
    const toggle    = document.getElementById('minimap-toggle');
    if (container) container.style.height = `${_openHeight}px`;
    if (toggle)    toggle.textContent = '▼';
    setTimeout(() => { if (_map) _map.invalidateSize(); }, 310);
}