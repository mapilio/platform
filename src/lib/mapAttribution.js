// Small maps fold the credit away only after the user moves the map or after 5 s.
export function addAttribution(mapboxgl, map, position) {
  const narrow = map.getContainer().clientWidth <= 640;
  map.addControl(new mapboxgl.AttributionControl({ compact: narrow }), position);
  if (!narrow) return;
  const el = map.getContainer().querySelector('.mapboxgl-ctrl-attrib');
  if (!el) return;
  const button = el.querySelector('.mapboxgl-ctrl-attrib-button');
  el.classList.add('mapboxgl-compact-show');
  if (button) button.setAttribute('aria-expanded', 'true');
  let timer = 0;
  const fold = (e) => {
    if (e && !e.originalEvent) return;
    clearTimeout(timer);
    map.off('movestart', fold);
    el.classList.remove('mapboxgl-compact-show');
    if (button) button.setAttribute('aria-expanded', 'false');
  };
  timer = setTimeout(fold, 5000);
  map.on('movestart', fold);
}
