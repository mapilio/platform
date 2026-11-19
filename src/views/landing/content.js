import publicStatistics from 'Configs/publicStatistics.json';

const metric = (label) => publicStatistics.metrics.find((m) => m.label === label);

export const STATS = {
  // Production snapshot, src/Configs/publicStatistics.json
  checkedAt: publicStatistics.checkedAt,
  images: metric('Image records')?.value,
  countries: metric('Countries & territories')?.value,
  uploaders: metric('Uploading accounts')?.value,
  accounts: metric('Registered accounts')?.value,
  objectClasses: metric('Object classes')?.value,
  note: publicStatistics.note,
};

export const LINKS = {
  app: '/app',
  walk: '/app/walk',
  play: '/app/play',
  appStore: process.env.APP_STORE_LINK || 'https://apps.apple.com/app/mapilio/id1609035791',
  googlePlay: process.env.GOOGLE_PLAY_LINK || 'https://play.google.com/store/apps/details?id=com.mapilio.app',
  osm: '/openstreetmap',
  licenses: '/licenses',
  terms: '/terms',
  uploader: '/uploader',
  iD: 'https://www.openstreetmap.org/edit?editor=id',
  mobileRepo: 'https://github.com/mapilio/mobile-apps',
  kitRepo: 'https://github.com/mapilio/mapilio-kit',
  syncerRepo: 'https://github.com/mapilio/MapSyncer',
  iDFork: 'https://github.com/mapilio/iD',
  discussions: 'https://github.com/mapilio/mobile-apps/discussions',
  droneRoadmap: 'https://github.com/mapilio/mobile-apps/blob/main/ROADMAP.md',
  webRepo: 'https://github.com/mapilio/platform',
};

// Dates in the place manifest are local calendar days (YYYY-MM-DD).
const day = (iso) => new Date(`${iso}T12:00:00Z`);
export const fmtDay = (iso) => day(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// ['2023-05-19', '2023-05-21'] -> '19 and 21 May 2023'
export const fmtDays = (days) => {
  const d = days.map(day);
  const sameMonth = d.every((x) => x.getUTCFullYear() === d[0].getUTCFullYear() && x.getUTCMonth() === d[0].getUTCMonth());
  const parts = sameMonth ? d.map((x, i) => (i === d.length - 1 ? fmtDay(days[i]) : String(x.getUTCDate()))) : days.map(fmtDay);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
};

// Numbers in the story copy come from the place manifest in ./data.
export const HERO = {
  titleTop: 'Map the world',
  titleBottom: 'from the ground up.',
  lede: 'Mapilio is street-level imagery captured by people with phones, action cameras and 360° rigs. Mappers use it to see what is on the ground for OpenStreetMap.',
  hint: 'Drag the planet · Scroll to step inside',
  place: (m) => `${m.place.name}, ${m.place.park}, ${m.place.country}`,
};

export const STREET = [
  {
    key: 'inside',
    title: 'Step inside.',
    body: (m) => `This is the ${m.place.name}, a boardwalk above the rainforest canopy in ${m.place.park}, ${m.place.region}, on ${fmtDay(m.credit.date)}. Drag to look around.`,
  },
  {
    key: 'frames',
    title: 'A photo every few metres.',
    body: (m, walk) => `${walk.count} panoramas, ${walk.metres} metres. Scroll and you walk out to the lookout, one panorama at a time.`,
  },
  {
    key: 'someone',
    title: 'Every frame is someone’s.',
    body: (m) => `This sequence holds ${m.sequenceLength} panoramas over ${(m.routeLengthM / 1000).toFixed(1)} km, contributed by ${m.credit.username} and shared under ${m.credit.licence}.`,
  },
];

export const LIFT = {
  title: 'Now rise.',
  body: 'A photo becomes a point. Points become a path.',
};

export const DRONE = {
  tag: 'In development',
  title: 'Above every street, a second view.',
  body: 'We are bringing drone capture to Mapilio: nadir, oblique and 360° aerial photos placed on the same map as street-level imagery, so you can rise above any street and drop back down.',
  formLabel: 'Get notified when drone uploads open',
  cta: 'Notify me',
  // a public OpenDroneMap sample survey shown in the map; not Mapilio imagery
  demoLabel: 'See a demo survey on the map (sample data)',
  demoHref: '/app?drone=brighton-beach',
};

export const CITY = {
  title: 'Walks become a map.',
  // every sequence in the area is a 360° walk (see the manifest's `area`)
  body: (m) => `The rainforest tracks around the ${m.place.name}, drawn by the ${m.area.sequences} walks captured here on ${fmtDays(m.area.days)} between ${m.area.start} and ${m.area.end}, in the order they were taken. Every photo in them is a 360° panorama.`,
  legend: [
    { key: '360', label: '360° sequence' },
    { key: 'park', label: 'National park boundary' },
    { key: 'osm', label: 'Roads, tracks and streams' },
  ],
  attribution: { text: 'Map data ©', link: 'OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
};

export const WORLD = {
  title: 'A world map drawn by the people in it.',
  snapshot: 'Production snapshot',
};

export const PLAY = {
  title: 'Where am I?',
  body: 'Real photos from Mapilio contributors. One map. Guess where each was taken: the closer you are, the more you score.',
  appCta: 'Play the daily five',
  appNote: 'Daily challenge, streaks and badges are in the web app.',
};

export const PROGRESS = {
  title: 'Earn your place on the map.',
  body: 'Two tracks, kept apart on purpose. Explorer progress comes from walking streets and playing. Contributor standing comes only from what you capture.',
  fairPlay: 'Coming next: contributor points for new and fresh coverage, never for speed, night driving or risk. Always capture hands-free.',
};

// Explorer levels (client-side, see lib/game/progress.mjs)
export const LEVELS = [
  { name: 'Wanderer', xp: 0 },
  { name: 'Scout', xp: 100 },
  { name: 'Pathfinder', xp: 300 },
  { name: 'Navigator', xp: 700 },
  { name: 'Cartographer', xp: 1500 },
  { name: 'Surveyor', xp: 3000 },
  { name: 'Atlas', xp: 6000 },
];

export const OPEN = {
  title: 'Made with OpenStreetMap. Built in the open.',
  intro: 'We want to complement OpenStreetMap, not replace it with a proprietary version. Mapilio is an independent imagery provider and is not part of the OpenStreetMap Foundation.',
  rows: [
    {
      key: 'id',
      tag: 'iD editor',
      title: 'A photo layer inside OpenStreetMap’s editor',
      body: 'Mapilio imagery has been a built-in street-level layer in iD, OpenStreetMap’s web editor, since version 2.27 in August 2023. Open any photo from our map straight in iD.',
      href: 'https://www.openstreetmap.org/edit?editor=id',
      linkLabel: 'Open iD',
    },
    {
      key: 'licence',
      tag: 'CC BY-SA',
      title: 'Imagery you can map from',
      body: 'Imagery is shared under CC BY-SA, and our terms explicitly allow deriving information from it for OpenStreetMap under the OSM contributor terms.',
      href: '/licenses',
      linkLabel: 'Licences',
    },
    {
      key: 'login',
      tag: 'OAuth',
      title: 'Sign in with OpenStreetMap',
      body: 'Use your OpenStreetMap account to sign in. We only ask to read your account details and preferences, and we never edit OpenStreetMap on your behalf.',
      href: '/login',
      linkLabel: 'Sign in',
    },
    {
      key: 'mobile',
      tag: 'Apache-2.0',
      title: 'An open-source capture app',
      body: 'The iOS and Android app is public on GitHub and translated into more than a dozen languages. Code, translations and bug reports are welcome.',
      href: 'https://github.com/mapilio/mobile-apps',
      linkLabel: 'mobile-apps',
    },
    {
      key: 'web',
      tag: 'MIT',
      title: 'This website is open source',
      body: 'The homepage, the map, the street viewer and the daily game are on GitHub. Report bugs and suggest ideas in its issues.',
      href: 'https://github.com/mapilio/platform',
      linkLabel: 'platform',
    },
    {
      key: 'kit',
      tag: 'MIT',
      title: 'Upload from action and 360° cameras',
      body: 'Mapilio Kit prepares and uploads geotagged imagery from the command line.',
      code: 'pip install mapilio-kit',
      href: 'https://github.com/mapilio/mapilio-kit',
      linkLabel: 'mapilio-kit',
    },
    {
      key: 'syncer',
      tag: 'MIT',
      title: 'Bring your KartaView imagery',
      body: 'MapSyncer moves your own KartaView sequences to Mapilio.',
      href: 'https://github.com/mapilio/MapSyncer',
      linkLabel: 'MapSyncer',
    },
  ],
};

export const CTA = {
  title: 'Your street is missing.',
  body: 'Capture it with your phone. It takes one walk.',
};

export const NAV = [
  { label: 'Explore', href: '/app' },
  { label: 'Play', href: '#play' },
  { label: 'Drones', href: '#drones' },
  { label: 'OpenStreetMap', href: '/openstreetmap' },
  { label: 'Solutions', href: '/solutions/mapfeature' },
  { label: 'Blog', href: '/blog' },
  { label: 'About', href: '/about' },
];

export const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
