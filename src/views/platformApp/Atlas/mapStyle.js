// "Daylight" basemap for the Atlas map: a quiet Mapbox Streets v8 style in the
// homepage palette so Mapilio coverage carries the colour.
// Coverage tiles: z2-5 `world_img_cache` (sampled photo points), z6+ `map_roads_line`.

export const C = {
  sky: '#e8edf1',
  water: '#cddae5',
  green: '#d9e6dc',
  building: '#e4e9ee',
  buildingLine: '#cbd5dd',
  road: '#ffffff',
  roadMinor: '#f6f8fa',
  rail: '#c9d2da',
  boundary: '#9aa6b2',
  ink: '#0b1220',
  ink2: '#3d4757',
  ink3: '#6f7a8a',
  waterInk: '#7890a6',
  blue: '#0056f1',
  violet: '#7a1ff2',
  signal: '#ffb81c',
};

const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name']];
const FONT_M = ['DIN Pro Medium', 'Arial Unicode MS Regular'];
const FONT_R = ['DIN Pro Regular', 'Arial Unicode MS Regular'];
const FONT_I = ['DIN Pro Italic', 'Arial Unicode MS Regular'];
const IS_PANO = ['==', ['to-string', ['get', 'fov']], '360'];

// beyond zoom 16 a road keeps its real width in metres (it doubles with every zoom level),
// so the street the camera lands on is as wide as the street in the photo
const realWidth = (z8, z12, metres) => ['interpolate', ['exponential', 2], ['zoom'], 8, z8, 12, z12, 16, metres / 0.82, 24, (metres / 0.82) * 256];

export function atlasStyle() {
  return {
    version: 8,
    name: 'Mapilio Daylight',
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
    // soft overhead daylight: walls stay pale paper rather than grey
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.22, position: [1.5, 200, 55] },
    sources: {
      streets: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
      coverage: {
        type: 'vector',
        tiles: ['https://geo.mapilio.com/map/{x}/{y}/{z}'],
        minzoom: 2,
        maxzoom: 14,
        attribution: 'Imagery © Mapilio contributors, CC BY-SA',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.sky } },
      {
        id: 'green', type: 'fill', source: 'streets', 'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['park', 'pitch', 'cemetery', 'wood', 'grass', 'scrub', 'agriculture'], true, false],
        paint: { 'fill-color': C.green, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 8, 0.55, 14, 0.8] },
      },
      { id: 'water', type: 'fill', source: 'streets', 'source-layer': 'water', paint: { 'fill-color': C.water } },
      {
        id: 'waterway', type: 'line', source: 'streets', 'source-layer': 'waterway', minzoom: 9,
        paint: { 'line-color': C.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 16, 3] },
      },
      // paper-white blocks: flat from above, a quiet city model when the camera comes down to the street
      {
        id: 'building', type: 'fill-extrusion', source: 'streets', 'source-layer': 'building', minzoom: 14.5,
        filter: ['!=', ['get', 'underground'], 'true'],
        paint: {
          'fill-extrusion-color': C.building,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, ['coalesce', ['get', 'height'], 6]],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, ['coalesce', ['get', 'min_height'], 0]],
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 0.94],
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-ambient-occlusion-intensity': 0.28,
          'fill-extrusion-ambient-occlusion-radius': 4,
        },
      },
      {
        id: 'rail', type: 'line', source: 'streets', 'source-layer': 'road', minzoom: 11,
        filter: ['match', ['get', 'class'], ['major_rail', 'minor_rail'], true, false],
        paint: { 'line-color': C.rail, 'line-width': 1, 'line-dasharray': [4, 2] },
      },
      {
        id: 'road-path', type: 'line', source: 'streets', 'source-layer': 'road', minzoom: 14,
        filter: ['match', ['get', 'class'], ['path', 'pedestrian', 'track'], true, false],
        paint: { 'line-color': C.road, 'line-width': realWidth(0.3, 0.5, 2.2), 'line-dasharray': [2, 1.2] },
      },
      {
        id: 'road-minor', type: 'line', source: 'streets', 'source-layer': 'road', minzoom: 11,
        filter: ['match', ['get', 'class'], ['street', 'street_limited', 'service', 'tertiary', 'secondary_link', 'tertiary_link'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.roadMinor, 'line-width': realWidth(0.2, 0.7, 7.5) },
      },
      {
        id: 'road-major', type: 'line', source: 'streets', 'source-layer': 'road', minzoom: 5,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.road, 'line-width': realWidth(0.6, 1.6, 12), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 1] },
      },
      {
        id: 'admin-1', type: 'line', source: 'streets', 'source-layer': 'admin', minzoom: 4,
        filter: ['all', ['==', ['get', 'admin_level'], 1], ['==', ['get', 'maritime'], 'false']],
        paint: { 'line-color': C.boundary, 'line-width': 0.6, 'line-dasharray': [2, 2], 'line-opacity': 0.6 },
      },
      {
        id: 'admin-0', type: 'line', source: 'streets', 'source-layer': 'admin',
        filter: ['all', ['==', ['get', 'admin_level'], 0], ['==', ['get', 'maritime'], 'false']],
        paint: { 'line-color': C.boundary, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 8, 1.4] },
      },

      // ---- Mapilio coverage
      {
        id: 'cov-dots', type: 'circle', source: 'coverage', 'source-layer': 'world_img_cache', maxzoom: 6,
        paint: {
          'circle-color': ['case', IS_PANO, C.violet, C.blue],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.3, 5, 2.4],
          'circle-opacity': 0.72,
        },
      },
      {
        id: 'cov-line', type: 'line', source: 'coverage', 'source-layer': 'map_roads_line', minzoom: 5.5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', IS_PANO, C.violet, C.blue],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 6, 0.7, 11, 1.3, 15, 2.6, 20, 8, 24, 96],
          'line-opacity': 0.88,
        },
      },
      // invisible and never filtered: what the year histogram counts
      { id: 'cov-all', type: 'line', source: 'coverage', 'source-layer': 'map_roads_line', minzoom: 5.5, paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 1 } },
      {
        id: 'cov-pick', type: 'line', source: 'coverage', 'source-layer': 'map_roads_line', minzoom: 5.5,
        filter: ['==', ['get', 'sequence_uuid'], ''],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.ink, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 6, 1.6, 15, 4, 20, 9] },
      },
      {
        id: 'cov-hover', type: 'line', source: 'coverage', 'source-layer': 'map_roads_line', minzoom: 5.5,
        filter: ['==', ['get', 'sequence_uuid'], ''],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.ink, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 6, 2, 15, 5, 20, 11] },
      },
      {
        id: 'cov-hit', type: 'line', source: 'coverage', 'source-layer': 'map_roads_line', minzoom: 5.5,
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 },
      },

      // ---- labels
      {
        id: 'label-water', type: 'symbol', source: 'streets', 'source-layer': 'natural_label',
        filter: ['match', ['get', 'class'], ['ocean', 'sea', 'water', 'bay'], true, false],
        layout: { 'text-field': NAME, 'text-font': FONT_I, 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 8, 14], 'text-letter-spacing': 0.18, 'text-max-width': 7 },
        paint: { 'text-color': C.waterInk, 'text-halo-color': C.water, 'text-halo-width': 1 },
      },
      {
        id: 'label-road', type: 'symbol', source: 'streets', 'source-layer': 'road', minzoom: 14.5,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street'], true, false],
        layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT_R, 'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 10, 19, 14], 'text-letter-spacing': 0.03 },
        paint: { 'text-color': C.ink3, 'text-halo-color': C.sky, 'text-halo-width': 1.4 },
      },
      {
        id: 'label-place', type: 'symbol', source: 'streets', 'source-layer': 'place_label', minzoom: 3.2,
        filter: ['match', ['get', 'class'], ['settlement', 'settlement_subdivision'], true, false],
        layout: {
          'text-field': NAME,
          'text-font': FONT_M,
          'symbol-sort-key': ['get', 'symbolrank'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, ['step', ['get', 'symbolrank'], 12, 9, 10], 10, ['step', ['get', 'symbolrank'], 20, 9, 15, 13, 12], 16, 15],
          'text-max-width': 8,
          'text-letter-spacing': 0.01,
        },
        paint: { 'text-color': C.ink, 'text-halo-color': C.sky, 'text-halo-width': 1.6, 'text-opacity': ['step', ['zoom'], ['step', ['get', 'symbolrank'], 1, 8, 0], 6, ['step', ['get', 'symbolrank'], 1, 12, 0], 9, 1] },
      },
      {
        id: 'label-state', type: 'symbol', source: 'streets', 'source-layer': 'place_label', minzoom: 3.6, maxzoom: 7.5,
        filter: ['==', ['get', 'class'], 'state'],
        layout: { 'text-field': NAME, 'text-font': FONT_R, 'text-size': 10.5, 'text-transform': 'uppercase', 'text-letter-spacing': 0.14, 'text-max-width': 7 },
        paint: { 'text-color': C.ink3, 'text-halo-color': C.sky, 'text-halo-width': 1.2 },
      },
      {
        id: 'label-country', type: 'symbol', source: 'streets', 'source-layer': 'place_label', maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': NAME, 'text-font': FONT_M, 'text-transform': 'uppercase', 'text-letter-spacing': 0.16, 'text-max-width': 6,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, ['step', ['get', 'symbolrank'], 10.5, 3, 9], 6, ['step', ['get', 'symbolrank'], 15, 3, 12]],
        },
        paint: { 'text-color': C.ink2, 'text-halo-color': C.sky, 'text-halo-width': 1.4 },
      },
    ],
  };
}

// daylight haze; at street level the sky above the horizon turns a soft blue
export const FOG = {
  range: [1.2, 9],
  color: '#e8edf1',
  'high-color': '#b4c9e0',
  'horizon-blend': ['interpolate', ['linear'], ['zoom'], 4, 0.06, 15, 0.08, 20, 0.16],
  'space-color': '#e8edf1',
  'star-intensity': 0,
};

/** Layers for a drone survey; inserted under the labels. */
export const DRONE_2D = ['drone-ortho', 'drone-foot-case', 'drone-foot', 'drone-foot-fill', 'drone-path', 'drone-shots'];
export function droneLayers() {
  return [
    { id: 'drone-ortho', type: 'raster', source: 'drone-ortho', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
    {
      id: 'drone-foot-case', type: 'line', source: 'drone-foot',
      paint: { 'line-color': C.ink, 'line-width': 5, 'line-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 0.9, 0] },
    },
    {
      id: 'drone-foot', type: 'line', source: 'drone-foot',
      paint: { 'line-color': C.signal, 'line-width': 2.5, 'line-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 1, 0] },
    },
    {
      id: 'drone-foot-fill', type: 'fill', source: 'drone-foot',
      paint: { 'fill-color': C.signal, 'fill-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 0.14, 0] },
    },
    {
      id: 'drone-path', type: 'line', source: 'drone-path',
      paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-dasharray': [1.5, 2], 'line-opacity': 0.9, 'line-opacity-transition': { duration: 350, delay: 0 } },
    },
    {
      id: 'drone-shots', type: 'circle', source: 'drone-shots',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 18, 6, 21, 9],
        'circle-color': ['case', ['boolean', ['feature-state', 'active'], false], C.signal, '#ffffff'],
        'circle-stroke-color': C.ink,
        'circle-stroke-width': 1.6,
        'circle-opacity': 1,
        'circle-stroke-opacity': 1,
        'circle-opacity-transition': { duration: 350, delay: 0 },
        'circle-stroke-opacity-transition': { duration: 350, delay: 0 },
      },
    },
  ];
}

// a 1 x 1 transparent PNG: image sources need a picture before the first photo is chosen
export const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * A drone photo laid on the map where it was taken: two image sources so one
 * photo can dissolve into the next, a shade over everything around it, and a
 * thin white edge. Inserted just above the orthophoto.
 */
export function photoSources(footprint) {
  const empty = { type: 'FeatureCollection', features: [] };
  return {
    'drone-photo-a': { type: 'image', url: BLANK_PNG, coordinates: footprint },
    'drone-photo-b': { type: 'image', url: BLANK_PNG, coordinates: footprint },
    'drone-dim': { type: 'geojson', data: empty },
    'drone-frame': { type: 'geojson', data: empty },
  };
}
export function photoLayers() {
  const fade = { duration: 420, delay: 0 };
  return [
    { id: 'drone-dim', type: 'fill', source: 'drone-dim', paint: { 'fill-color': C.ink, 'fill-opacity': 0, 'fill-opacity-transition': { duration: 600, delay: 0 } } },
    { id: 'drone-photo-a', type: 'raster', source: 'drone-photo-a', paint: { 'raster-opacity': 0, 'raster-opacity-transition': fade, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
    { id: 'drone-photo-b', type: 'raster', source: 'drone-photo-b', paint: { 'raster-opacity': 0, 'raster-opacity-transition': fade, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
    {
      id: 'drone-frame', type: 'line', source: 'drone-frame',
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0, 'line-opacity-transition': fade },
    },
  ];
}
