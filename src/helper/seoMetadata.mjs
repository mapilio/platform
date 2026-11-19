export const publicOrigin = 'https://mapilio.com';
export const defaultImage = `${publicOrigin}/assets/mapilio-thumb.png`;

export function canonicalUrl(path = '/') {
  let pathname;
  try { pathname = new URL(path, publicOrigin).pathname; } catch { pathname = '/'; }
  if (pathname === '/home' || pathname === '/home/') pathname = '/';
  return publicOrigin + (pathname.replace(/\/+$/, '') || '/');
}

export function socialImageUrl(image = defaultImage) {
  try {
    const url = new URL(image || defaultImage, publicOrigin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : defaultImage;
  } catch { return defaultImage; }
}

export function isPrivatePage(path = '/') {
  const pathname = new URL(canonicalUrl(path)).pathname;
  return /^\/(dashboard(?:\/|$)|login$|signup$|forgot-password$|reset-password$|osm-login$|payment-(success|error)$|embed$|blog\/(new|edit)$|app\/(image-request|marketplace)(?:\/|$))/.test(pathname)
    || pathname.endsWith('-webview');
}

export const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${publicOrigin}/#website`,
  url: `${publicOrigin}/`,
  name: 'Mapilio',
  description: 'Street-level imagery and open-source tools for collaborative mapping.',
  inLanguage: 'en',
};
