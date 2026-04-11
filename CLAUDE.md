# GLS Demo — Web Viewer

**Project:** GLS Infrastructure Planning Portfolio — "Living CV"

Real-time 3D visualisation of Stellenbosch's municipal water infrastructure, built as an unsolicited portfolio piece targeting GLS, a consulting company based in Stellenbosch. All GIS data was processed in QGIS by the author; the renderer was built from scratch in Three.js.

**Author:** Hennie Kotze — developer / GIS enthusiast, Stellenbosch.

No build step — plain ES6 modules served statically (open `index.html` directly or via a local HTTP server).

---

## File map

| File | Role |
|---|---|
| `index.html` | Entry point. Loads CDN deps, importmap, `main.js` |
| `constants.js` | Single source of truth for shared geographic constants |
| `main.js` | Scene, camera, lighting, asset loading, UI controls |
| `terrain.js` | DEM parsing, satellite tile fetch, terrain mesh + x-ray shader |
| `minimap.js` | Leaflet 2D minimap — camera sync, click-to-teleport, drag-to-pan |
| `geometry_simplifier/` | Offline Python utilities — not part of the web app |

---

## Dependencies (all CDN, no install needed)

| Library | Version | How loaded |
|---|---|---|
| Three.js | 0.160.0 | importmap → `unpkg` |
| Leaflet | 1.9.4 | `<script>` + `<link>` → `unpkg` |
| GeoTIFF.js | 2.1.3 | `<script>` → `jsdelivr` |

---

## Coordinate system

- GIS data: **UTM Zone 34S (EPSG:32734)**
- Scene origin: `ORIGIN_X = 302335.0`, `ORIGIN_Y = 6241833.0` (defined at top of `main.js`)
- Conversion: `sceneX = utmE − ORIGIN_X`, `sceneZ = −(utmN − ORIGIN_Y)`
- `ELEVATION_OFFSET = -5` applied to building/pipe geometry to align with terrain mesh

---

## Camera controls

| Input | Action |
|---|---|
| Left drag | Pan (shift orbit target) |
| Right drag | Rotate (orbit) |
| Scroll | Zoom (radius) |
| Minimap click | Teleport target |
| Minimap drag | Pan (syncs 3D camera) |

### Terrain clearance
- Hard floor: camera never goes below **terrain + 30 m** (`CAM_MIN_CLEARANCE`)
- Soft stop: downward pitch decelerates over the last **150 m** above the floor (`CAM_SOFT_ZONE`) via quadratic ease
- Both enforced in `updateCamera()` via `sampleTerrainElevation`

---

## Key state objects

```js
cameraState = { theta, phi, radius, target: Vector3, isDragging, isPanning }
coneState   = { halfAngleDeg, xrayEnabled }
```

---

## X-Ray cone (terrain shader)

The terrain material uses `onBeforeCompile` to inject custom GLSL into Three.js's MeshStandardMaterial.

**Uniforms updated every frame** via `_terrainShader` (cached on first compile, avoids scene traversal):

| Uniform | Type | Purpose |
|---|---|---|
| `camPos` | `vec3` | Camera world position |
| `camDir` | `vec3` | Camera forward direction |
| `coneCosCutoff` | `float` | `cos(halfAngleDeg)` — cone boundary |
| `coneSoftness` | `float` | Edge feather width (fixed at 0.05) |
| `xrayEnabled` | `float` | 1.0 = cone dimming active, 0.0 = fully opaque |

**Alpha formula:**
```glsl
float t = smoothstep(coneCosCutoff + coneSoftness, coneCosCutoff - coneSoftness, cosAngle);
gl_FragColor.a = mix(1.0, mix(0.15, 1.0, t), xrayEnabled);
```

---

## Minimap (minimap.js)

- Leaflet map, 400×400 px, bottom-left, collapsible
- Coordinate conversion: linear UTM↔WGS84 approximation (valid within DEM extent)
- **Updates from 3D scene** via `updateMinimap(camera, cameraState, coneState)` called every frame (throttled to 15 fps)
- **Updates to 3D scene** via custom window events:
  - `minimap-click` → teleport `cameraState.target`
  - `minimap-pan` → shift `cameraState.target` by drag delta
- Map `setView` is suppressed while the user is dragging (`_isDragging` flag) to avoid fighting user input
- Cone polygon and reticule marker: cone polygon hidden when `coneState.xrayEnabled` is false; reticule always visible

### Minimap overlays

| Element | Description |
|---|---|
| Blue dot | Camera position |
| Red reticule (crosshair + arrow) | Cone centre on ground; arrow points in view direction |
| Black polygon | Camera FOV footprint |
| Red polygon | X-ray cone ground intersection (hidden when x-ray off) |

---

## UI controls panel

Bottom-centre, built entirely in JS (no HTML). Uses `makeSliderRow(label, min, max, value, onInput)` which returns `{ input, readout, row }`.

| Control | Range | Notes |
|---|---|---|
| Time of Day | 6:00–18:00 | Drives sun position, building/street light fade |
| X-Ray View Cone Angle | 15°–35° | Disabled (greyed) when x-ray toggle is off |
| X-Ray toggle | on/off | Disables cone shader, hides minimap cone polygon, disables angle slider |

---

## Data assets

All co-located in the web root. Loaded at runtime via `fetch` / `GLTFLoader`.

| File | Size | Content |
|---|---|---|
| `dem.tif` | 565 KB | Digital Elevation Model, 362×398 px, UTM 34S |
| `terrain.glb` | 1.4 MB | Pre-computed terrain mesh |
| `buildings.glb` | 22 MB | 3D building models |
| `building_centroids.geojson` | 6.1 MB | Point lights per building |
| `pipelines_exported.geojson` | 1.4 MB | Water network lines |
| `pipe_network.gltf` | 2.6 MB | Pipe network 3D model |
| `stellenbosch_water_pipes.glb` | 133 KB | Water pipe geometry |
| `street_lights.geojson` | 3.0 MB | Street light positions |
| `highway_lights.geojson` | 275 KB | Highway light positions |
| `reservoirs.geojson` | 4.3 KB | Reservoir locations |
| `pump_stations.geojson` | 2.8 KB | Pump station locations |

DEM extent: E 297236–307426, N 6236232–6247436 (UTM 34S)
