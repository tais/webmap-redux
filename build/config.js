'use strict';
const path = require('path');

// JA2 1.13 REDUX (internally "DMK") instance — an Arulco overhaul. The mod ships a full standalone set
// (255 loose 160x160 maps, 88 loose tileset dirs 0..87 — MORE than vanilla's 70, the XML JA2SET, and
// Arulco TableData overlays) layered on top of a base 1.13 install. VFS priority, highest first:
//   Data-DMK  >  Data-1.13  >  Data (+ base Data/*.slf)
// Redux overrides almost everything; the base install (at .../JA2) is only a fallback.
const EDIT_ROOT = path.resolve(__dirname, '..', '..');                 // .../edit113
const REDUX = path.join(EDIT_ROOT, 'JA2_113-REDUX Beta3', 'Data-DMK'); // the mod's data root
const BASE = path.join(EDIT_ROOT, 'JA2');                              // base 1.13 install
const DATA = path.join(BASE, 'Data');                                 // base/vanilla SLFs + loose dirs
const V113 = path.join(BASE, 'Data-1.13');                            // the 1.13 layer

module.exports = {
  EDIT_ROOT,
  REDUX,
  // Maps: Redux's loose Data-DMK/Maps win; loose 1.13 maps and the base Maps.slf fill any sector Redux
  // doesn't ship. First dir wins; Maps.slf is the last fallback. (createMapSource in build.js.)
  MAPS_DIRS: [path.join(REDUX, 'Maps'), path.join(V113, 'Maps'), path.join(DATA, 'Maps')],
  MAPS_DIR: path.join(REDUX, 'Maps'),                   // primary (overlays' loot reader)
  BASE_MAPS_SLF: path.join(DATA, 'Maps.slf'),           // last-resort fallback for the few sectors nobody ships loose
  // JA2SET: Redux ships a COMPLETE 88-tileset XML table (indices 0..87). Use it ALONE — no merge with
  // the base 70-tileset table (a merge would only ever fill Redux's deliberately-blank slots with the
  // wrong, lower-priority vanilla filenames; the engine falls those to Redux's generic tileset 0).
  JA2SET_XML: path.join(REDUX, 'Ja2Set.dat.xml'),
  // Tilesets: Redux's 88 loose dirs (Data-DMK/Tilesets/<id>/) are the override and carry the custom
  // tilesets the base SLF lacks (e.g. 70..87). The base Tilesets.slf is the fallback for shared/common
  // tiles a Redux dir doesn't ship and for any tileset dir Redux omits (e.g. 15). Resolution per
  // (tilesetId,type): this tileset's loose dir -> base Tilesets.slf -> generic (0) loose -> generic SLF.
  TILESET_DIRS: [path.join(REDUX, 'Tilesets')],
  BASE_TILESETS_SLF: [path.join(DATA, 'Tilesets.slf')],
  // Overlays read Redux's Arulco TableData / Scripts / Mod_Settings; reads are tolerant (missing -> empty).
  TABLEDATA_MAP: path.join(REDUX, 'TableData', 'Map'),
  REDUX_ROOT: REDUX,                                    // overlays' Scripts/ + Mod_Settings.ini root
  DIST: path.resolve(__dirname, '..', 'dist'),
  RENDER_SCALE: 1.0,
};
