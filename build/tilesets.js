'use strict';
// REDUX tileset resolver. Redux ships the XML Ja2Set.dat.xml (per-tileset list of STI filenames indexed
// by tile TYPE) PLUS loose per-tileset STI dirs in Tilesets/<id>/ (88 of them, 0..87 — more than the
// base SLF's 70). We parse the XML (webmap's parseJa2Set), then resolve a (tilesetId, type) to a decoded
// STI by searching, in VFS priority: this tileset's loose dir -> base Tilesets.slf (this tileset) ->
// generic (0) loose -> base Tilesets.slf (generic). The loose-dir resolution is ported from
// webmap-aimnas/build/tilesets.js (which does the same but parses a BINARY JA2SET); here we keep the
// XML parser and use the single Redux table ALONE (no merge — see config.js).
const fs = require('fs');
const path = require('path');
const { openSlf } = require('./slf');
const { decodeSti } = require('./sti');
const { parseJsd, buildZStripsForSti } = require('./structure');

const GENERIC_TILESET = 0;

// Parse a paired .jsd structure buffer into the per-subimage ZStripInfo array for an STI (the data that
// drives the wall Z-occlusion in renderSector, mirroring the game's AddZStripInfoToVObject). Returns null
// for a missing/empty buffer or an STI with no multi-tile wall structures. Redux pairs .jsd with STIs in
// the loose Data-DMK/Tilesets/<id>/ dirs and in the base JA2/Data/Tilesets.slf.
function zstripsFromBuf(jbuf, sti) {
  if (!jbuf) return null;
  let jsd;
  try { jsd = parseJsd(jbuf); } catch (e) { jsd = null; }
  if (!jsd) return null;
  try { return buildZStripsForSti(jsd, sti.subimages); } catch (e) { return null; }
}

// --- webmap's XML JA2SET parser (Ja2Set.dat.xml): tilesets[idx] = { name, files[type] = filename } ---
function parseJa2Set(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const tilesets = [];
  const tsRe = /<Tileset\s+index="(\d+)"\s*>([\s\S]*?)<\/Tileset>/g;
  let m;
  while ((m = tsRe.exec(xml))) {
    const idx = parseInt(m[1], 10);
    const body = m[2];
    const nameM = /<Name>([\s\S]*?)<\/Name>/.exec(body);
    const files = [];
    const fileRe = /<file\s+index="(\d+)"\s*>([\s\S]*?)<\/file>/g;
    let fm;
    while ((fm = fileRe.exec(body))) {
      files[parseInt(fm[1], 10)] = fm[2].trim();
    }
    tilesets[idx] = { name: nameM ? nameM[1].trim() : '', files };
  }
  return tilesets;
}

// Index every loose .sti under Tilesets/<id>/ (recursive, includes any /T/) by lowercase basename.
// (Ported from webmap-aimnas.) Non-numeric subdirs (e.g. "AdditionalProperties") are skipped.
function indexLooseTilesets(tilesetsDir) {
  const byId = new Map(); // id -> Map(lowerBasename -> fullPath)
  let dirs;
  try { dirs = fs.readdirSync(tilesetsDir); } catch (e) { return byId; }
  for (const d of dirs) {
    const id = parseInt(d, 10);
    if (!Number.isInteger(id) || String(id) !== d) continue;
    const m = new Map();
    (function walk(dir) {
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      // Index this dir's own .sti FIRST, then recurse, so a tileset's main tiles win over a /T/ subdir
      // (trimmed/alternate variants). First file found for a name wins.
      for (const e of ents) if (!e.isDirectory() && /\.sti$/i.test(e.name)) { const k = e.name.toLowerCase(); if (!m.has(k)) m.set(k, path.join(dir, e.name)); }
      for (const e of ents) if (e.isDirectory()) walk(path.join(dir, e.name));
    })(path.join(tilesetsDir, d));
    byId.set(id, m);
  }
  return byId;
}

// tilesetDirs / baseSlfPaths may each be a single value or an ORDERED LIST (highest VFS priority first).
function createTilesetResolver(ja2setXmlPath, tilesetDirs, baseSlfPaths) {
  const dirs = (Array.isArray(tilesetDirs) ? tilesetDirs : [tilesetDirs]).filter(Boolean);
  const slfPaths = (Array.isArray(baseSlfPaths) ? baseSlfPaths : [baseSlfPaths]).filter(Boolean);
  const tilesets = parseJa2Set(ja2setXmlPath); // single Redux XML table — NO merge.
  // Merge the loose dirs in priority order (first dir to provide a given file wins).
  const loose = new Map(); // id -> Map(lowerName -> fullPath)
  for (const dir of dirs) {
    for (const [id, m] of indexLooseTilesets(dir)) {
      let dst = loose.get(id); if (!dst) { dst = new Map(); loose.set(id, dst); }
      for (const [k, v] of m) if (!dst.has(k)) dst.set(k, v);
    }
  }
  const baseSlfs = slfPaths.map((p) => (fs.existsSync(p) ? openSlf(p) : null)).filter(Boolean);
  const stiCache = new Map(); // cache key -> decoded STI | null
  const stats = { resolved: 0, fromLoose: 0, fromSlf: 0, generic: 0, missing: 0, missingFiles: new Set() };

  function decode(buf) { if (!buf) return null; try { return decodeSti(buf); } catch (e) { return null; } }
  // Read the sibling .jsd next to a loose .sti path (loose files vary in case, so try both .jsd and .JSD).
  function looseJsdBuf(fp) {
    for (const ext of ['.jsd', '.JSD']) {
      const jp = fp.replace(/\.sti$/i, ext);
      try { if (fs.existsSync(jp)) return fs.readFileSync(jp); } catch (e) {}
    }
    return null;
  }
  function loadLoose(id, fnameLower) {
    const m = loose.get(id); if (!m) return null;
    const fp = m.get(fnameLower); if (!fp) return null;
    const key = 'L:' + fp;
    if (stiCache.has(key)) return stiCache.get(key);
    let sti = null; try { sti = decode(fs.readFileSync(fp)); } catch (e) {}
    if (sti) sti.zstrips = zstripsFromBuf(looseJsdBuf(fp), sti); // per-subimage wall Z-strips (or null)
    stiCache.set(key, sti); return sti;
  }
  function loadSlf(id, fname) {
    if (!baseSlfs.length) return null;
    const key = 'S:' + id + '\\' + fname;
    if (stiCache.has(key)) return stiCache.get(key);
    let sti = null, srcSlf = null;
    for (const slf of baseSlfs) { const buf = slf.get(id + '\\' + fname); if (buf) { sti = decode(buf); if (sti) { srcSlf = slf; break; } } }
    // Fetch the paired .JSD from the SAME slf the STI came from (`id\name` with .STI -> .JSD).
    if (sti && srcSlf) sti.zstrips = zstripsFromBuf(srcSlf.get(id + '\\' + fname.replace(/\.sti$/i, '.JSD')), sti);
    stiCache.set(key, sti); return sti;
  }

  // Returns a decoded STI (with .subimages) for this (tilesetId, type) or null.
  function resolve(tilesetId, type) {
    let fname = tilesets[tilesetId] && tilesets[tilesetId].files[type];
    let viaGeneric = false;
    if (!fname) { fname = tilesets[GENERIC_TILESET] && tilesets[GENERIC_TILESET].files[type]; viaGeneric = true; }
    if (!fname) { stats.missing++; return null; }
    const lower = fname.toLowerCase();
    let sti = loadLoose(tilesetId, lower);
    if (sti) { stats.resolved++; stats.fromLoose++; if (viaGeneric) stats.generic++; return sti; }
    sti = loadSlf(tilesetId, fname);
    if (sti) { stats.resolved++; stats.fromSlf++; if (viaGeneric) stats.generic++; return sti; }
    sti = loadLoose(GENERIC_TILESET, lower);
    if (sti) { stats.resolved++; stats.fromLoose++; stats.generic++; return sti; }
    sti = loadSlf(GENERIC_TILESET, fname);
    if (sti) { stats.resolved++; stats.fromSlf++; stats.generic++; return sti; }
    stats.missing++; if (stats.missingFiles.size < 40) stats.missingFiles.add(tilesetId + ':' + fname); return null;
  }

  return { tilesets, loose, baseSlfs, resolve, stats };
}

module.exports = { parseJa2Set, indexLooseTilesets, createTilesetResolver, GENERIC_TILESET };
