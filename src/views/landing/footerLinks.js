export const footerLinks = [
  {
    main: 'About',
    children: [
      { to: '/about', name: 'About Mapilio' },
      { to: '/blog', name: 'Blog' },
      { to: 'https://github.com/mapilio/mobile-apps/discussions', name: 'Community discussions', target: '_blank' },
      { to: '/contact', name: 'Contact' },
    ],
  },
  {
    main: 'Solutions',
    children: [
      { to: '/solutions/mapfeature', name: 'Map Feature' },
      { to: '/solutions/autonomous', name: 'Autonomous' },
      { to: '/solutions/taxmanagement', name: 'Tax Management' },
      { to: '/solutions/energy', name: 'Energy' },
      { to: '/solutions/digitaltwin', name: 'Digital Twin' },
    ],
  },
  {
    main: 'Apps',
    children: [
      { to: process.env.GOOGLE_PLAY_LINK, name: 'Android App', target: '_blank' },
      { to: process.env.APP_STORE_LINK, name: 'iOS App', target: '_blank' },
      { to: '/uploader', name: 'Desktop Installer' },
      { to: '/app', name: 'Web Platform' },
      { to: '/award', name: 'Rewards and challenges' },
    ],
  },
  {
    main: 'Developers',
    children: [
      { to: '/developer', name: 'For Developers' },
      { to: 'https://github.com/mapilio/mapilio-kit/blob/main/docs/CLI.md', name: 'Uploader documentation', target: '_blank' },
      { to: 'https://mapilio.statuspage.io', name: 'System Status', target: '_blank' },
      { to: 'https://github.com/mapilio/platform', name: 'Website source code', target: '_blank' },
      { to: 'https://github.com/mapilio/mobile-apps', name: 'Mobile source code', target: '_blank' },
      { to: 'https://discord.gg/St5z2sUZ7H', name: 'Discord', target: '_blank' },
    ],
  },
];
