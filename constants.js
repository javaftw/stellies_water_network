// ─── constants.js ─────────────────────────────────────────────────────────────
// Single source of truth for geographic constants shared across modules.
// ─────────────────────────────────────────────────────────────────────────────

// Scene origin in UTM 34S (EPSG:32734).
// Conversion: sceneX = utmE − ORIGIN_X,  sceneZ = −(utmN − ORIGIN_Y)
export const ORIGIN_X = 302335.0;
export const ORIGIN_Y = 6241833.0;

// DEM raster extent in UTM 34S (from QGIS export dialog)
export const DEM_E_MIN = 297236.0239;
export const DEM_E_MAX = 307426.5723;
export const DEM_N_MIN = 6236232.9034;
export const DEM_N_MAX = 6247436.8766;
