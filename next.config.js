// three.js ships modern syntax (class static blocks), so it has to be transpiled
const withTM = require('next-transpile-modules')(['three']);

const SITE_URL = process.env.SITE_URL || 'https://mapilio.com';
const CLASSIC_MAP_URL = process.env.CLASSIC_MAP_URL || `${SITE_URL}/app`;

// pages that still live on the main site
const SITE_PAGES = [
  'about', 'award', 'blog', 'contact', 'cookie-policy', 'data-processing', 'developer', 'gdpr',
  'licenses', 'login', 'openstreetmap', 'price', 'privacy', 'signup', 'terms', 'uploader',
];

module.exports = withTM({
  reactStrictMode: true,
  swcMinify: true,
  env: {
    REACT_APP_API_URL: process.env.REACT_APP_API_URL || 'https://end.mapilio.com',
    REACT_APP_API_IMAGE_URL: process.env.REACT_APP_API_IMAGE_URL || 'https://cdn.mapilio.com/im',
    REACT_APP_GEOSERVER_WFS_URL: process.env.REACT_APP_GEOSERVER_WFS_URL
      || 'https://geo.mapilio.com/mapilio/ows?service=WFS&version=1.0.0&outputFormat=application%2Fjson&request=GetFeature&typeName=mapilio:',
    APP_STORE_LINK: process.env.APP_STORE_LINK || 'https://apps.apple.com/app/mapilio/id1609035791',
    GOOGLE_PLAY_LINK: process.env.GOOGLE_PLAY_LINK || 'https://play.google.com/store/apps/details?id=com.mapilio.app',
  },
  async redirects() {
    return [
      { source: '/app/classic', destination: CLASSIC_MAP_URL, permanent: false },
      { source: '/solutions/:path*', destination: `${SITE_URL}/solutions/:path*`, permanent: false },
      ...SITE_PAGES.map((page) => ({ source: `/${page}`, destination: `${SITE_URL}/${page}`, permanent: false })),
    ];
  },
});
