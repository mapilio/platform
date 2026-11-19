import React from 'react';

// The pin from the Mapilio wordmark (src/svg/logos/MapilioLogo.js, Path_423).
const PIN_D = 'M432.39,416.728c-4.538-4.031-12.447-10.6-14.238-16.476h.013a14.956,14.956,0,1,1,28.45,0h.013c-1.791,5.881-9.7,12.445-14.238,16.476Zm.027-13.041a5.81,5.81,0,0,0,2.688-.636,7.094,7.094,0,0,0,2.2-1.763,8.687,8.687,0,0,0,1.5-2.6,9.133,9.133,0,0,0,.549-3.209,8.8,8.8,0,0,0-.549-3.092,7.95,7.95,0,0,0-1.5-2.544,7.505,7.505,0,0,0-2.2-1.7,5.812,5.812,0,0,0-2.688-.636,5.988,5.988,0,0,0-2.717.636,7.387,7.387,0,0,0-2.226,1.7,7.953,7.953,0,0,0-1.5,2.544,8.79,8.79,0,0,0-.549,3.092,9.128,9.128,0,0,0,.549,3.209,8.691,8.691,0,0,0,1.5,2.6,6.99,6.99,0,0,0,2.226,1.763A5.986,5.986,0,0,0,432.417,403.687Z';

export function PinMark({ size = 120, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <g transform="translate(60 61) scale(2.05) translate(-432.4 -398.7)">
        <path d={PIN_D} fill={color} fillRule="evenodd" />
      </g>
    </svg>
  );
}

const G = {
  firstlight: (
    <g>
      <path d="M-15 6 H15" />
      <path d="M-9 6 A9 9 0 0 1 9 6" />
      <path d="M0 -10 V-6 M-10 -5 l2.6 2.6 M10 -5 l-2.6 2.6" />
    </g>
  ),
  fullcircle: (
    <g>
      <circle r="11" />
      <path d="M0 -15 l3 4 h-6 z" fill="currentColor" stroke="none" />
      <circle r="2.2" fill="currentColor" stroke="none" />
    </g>
  ),
  pathfinder: (
    <g>
      <path d="M-14 12 C-6 6 -10 -2 -2 -4 S8 -6 10 -12" strokeDasharray="2.4 2.6" />
      <path d="M10 -12 V-2 M10 -12 h7 l-2 2.5 2 2.5 h-7" />
    </g>
  ),
  century: (
    <g stroke="none" fill="currentColor">
      <text x="0" y="5" textAnchor="middle" fontSize="15" fontWeight="700" fontFamily="'Martian Mono', ui-monospace, monospace">100</text>
      <text x="0" y="15" textAnchor="middle" fontSize="6" fontFamily="'Martian Mono', ui-monospace, monospace">KM</text>
    </g>
  ),
  bullseye: (
    <g>
      <circle r="13" />
      <circle r="8" />
      <circle r="3" fill="currentColor" stroke="none" />
    </g>
  ),
  globetrotter: (
    <g>
      <circle r="13" />
      <ellipse rx="5.5" ry="13" />
      <path d="M-13 0 H13 M-11 -6.5 H11 M-11 6.5 H11" />
    </g>
  ),
  groundtruth: (
    <g>
      <rect x="-11" y="-11" width="22" height="22" rx="1" />
      <path d="M-5 0 l3.6 3.8 L6 -5" />
    </g>
  ),
  liftoff: (
    <g>
      <path d="M-7 -7 L7 7 M7 -7 L-7 7" />
      <circle cx="-9" cy="-9" r="4" />
      <circle cx="9" cy="-9" r="4" />
      <circle cx="-9" cy="9" r="4" />
      <circle cx="9" cy="9" r="4" />
    </g>
  ),
  streak: (
    <g>
      {[-12, -8, -4, 0, 4, 8].map((x) => <path key={x} d={`M${x} 6 V-6`} />)}
      <rect x="10.5" y="-7.5" width="3" height="15" fill="currentColor" stroke="none" />
    </g>
  ),
  secondopinion: (
    <g>
      <circle cx="-4" r="9" />
      <circle cx="5" r="9" />
      <path d="M-1 1 l2.6 2.8 L7 -3" />
    </g>
  ),
};

export const RARITY = {
  common: { label: 'Common', color: '#7b8696' },
  rare: { label: 'Rare', color: '#0056f1' },
  epic: { label: 'Epic', color: '#7a1ff2' },
  legendary: { label: 'Legendary', color: '#e8a400' },
};

export function Stamp({ id, glyph, ring, rarity = 'common', earned = false, size = 132 }) {
  const r = RARITY[rarity] || RARITY.common;
  const pathId = `stamp-ring-${id}`;
  return (
    <svg width={size} height={size} viewBox="-60 -60 120 120" role="img" aria-label={`${ring}, ${r.label}${earned ? ', earned' : ''}`}>
      <defs>
        <path id={pathId} d="M -44,0 a 44,44 0 1,1 88,0 a 44,44 0 1,1 -88,0" />
      </defs>
      <circle r="56" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle r="35" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <text fontSize="8.4" letterSpacing="1.6" fill="currentColor" fontFamily="'Martian Mono', ui-monospace, monospace">
        <textPath href={`#${pathId}`} startOffset="0">{`${ring.toUpperCase()} · MAPILIO · ${r.label.toUpperCase()} ·`}</textPath>
      </text>
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {G[glyph] || G.bullseye}
      </g>
      <circle cx="0" cy="-56" r="5" fill={r.color} stroke="none" />
    </svg>
  );
}

export function StoreBadge({ store }) {
  // Plain typographic store buttons (official badge artwork is in src/svg/logos when needed)
  return store === 'ios' ? (
    <span><small>Download on the</small>App Store</span>
  ) : (
    <span><small>Get it on</small>Google Play</span>
  );
}
