import React, { useEffect, useState } from 'react';
import s from './landing.module.css';
import { PROGRESS } from './content';
import { Stamp, RARITY } from './marks';
import { BADGES, LEVELS, levelFor, loadProgress } from 'lib/game/progress.mjs';

function monthRange(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m + 1)}-01`;
  const endDate = new Date(y, m + 1, 0);
  const end = `${y}-${pad(m + 1)}-${pad(endDate.getDate())}`;
  return { start, end, label: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
}

export function useLeaderboard(limit = 5) {
  const [data, setData] = useState({ status: 'loading', rows: [], label: '' });
  useEffect(() => {
    let cancelled = false;
    const { start, end, label } = monthRange();
    const run = async () => {
      try {
        let res = await fetch(`${process.env.REACT_APP_API_URL}/api/leaderboard?start_at=${start}&finish_at=${end}`, { credentials: 'omit' });
        let json = res.ok ? await res.json() : null;
        let rows = json?.data?.leaderboard || json?.leaderboard || [];
        let period = label;
        if (!rows.length) {
          res = await fetch(`${process.env.REACT_APP_API_URL}/api/leaderboard`, { credentials: 'omit' });
          json = res.ok ? await res.json() : null;
          rows = json?.data?.leaderboard || json?.leaderboard || [];
          period = 'All time';
        }
        // skip deleted accounts; all-time lengths contain known outliers
        rows = rows.filter((r) => !/^deleteduser/i.test(String(r.username || '')));
        if (!cancelled) setData({ status: rows.length ? 'ready' : 'empty', rows: rows.slice(0, limit), label: period, showKm: period !== 'All time' });
      } catch (e) {
        if (!cancelled) setData({ status: 'error', rows: [], label });
      }
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return data;
}

export default function Progress() {
  const lb = useLeaderboard();
  const [me, setMe] = useState(null);
  useEffect(() => {
    try {
      const st = loadProgress(window.localStorage);
      if (st.xp > 0) setMe({ ...levelFor(st.xp), badges: st.badges });
    } catch (e) { /* ignore */ }
  }, []);
  const maxXp = LEVELS[LEVELS.length - 1].xp;
  const pos = (xp) => Math.sqrt(xp / maxXp);

  return (
    <div className={s.progressGrid}>
      <div className={s.ladder}>
        <h3 className={s.colTitle}>Explorer levels</h3>
        <ol className={s.ladderScale} aria-label="Explorer levels">
          {[...LEVELS].reverse().map((l) => (
            <li key={l.name} style={{ '--y': 1 - pos(l.xp) }} data-current={me && me.name === l.name ? 'true' : undefined}>
              <span>{l.name}</span>
              <small>{l.xp.toLocaleString('en-US')} XP</small>
            </li>
          ))}
        </ol>
        <p className={s.ladderNote}>
          {me ? <>You are a <b>{me.name}</b> with {me.xp.toLocaleString('en-US')} XP{me.nextName ? `, ${me.next - me.xp} XP from ${me.nextName}` : ''}.</> : 'XP comes from walking streets in the viewer and playing Where am I?. It lives in your browser until accounts sync it.'}
        </p>
      </div>

      <div className={s.stamps}>
        <h3 className={s.colTitle}>Badges</h3>
        <ul>
          {BADGES.map((b) => (
            <li key={b.id} data-earned={me && me.badges && me.badges[b.id] ? 'true' : undefined} data-soon={b.comingSoon ? 'true' : undefined}>
              <Stamp id={b.id} glyph={b.glyph} ring={b.name} rarity={b.rarity} earned={!!(me && me.badges && me.badges[b.id])} />
              <b>{b.name}</b>
              <span>{b.criterion}</span>
              <small style={{ color: RARITY[b.rarity].color }}>{RARITY[b.rarity].label} · {b.track === 'explorer' ? 'Explorer' : 'Contributor'}{b.comingSoon ? ' · soon' : ''}</small>
            </li>
          ))}
        </ul>
      </div>

      <div className={s.board}>
        <h3 className={s.colTitle}>Contributors · {lb.label || 'this month'}</h3>
        {lb.status === 'loading' && <p className={s.boardNote}>Loading the leaderboard…</p>}
        {lb.status === 'error' && <p className={s.boardNote}>The leaderboard is not reachable right now.</p>}
        {lb.status === 'empty' && <p className={s.boardNote}>No uploads counted yet this month.</p>}
        {lb.status === 'ready' && (
          <ol className={s.boardList}>
            {lb.rows.map((r, i) => (
              <li key={r.id || r.username}>
                <span className={s.rank}>{String(i + 1).padStart(2, '0')}</span>
                <span className={s.who}>{r.display_name || r.username}</span>
                {lb.showKm && <span className={s.stat}>{Math.round(parseFloat(r.total_length) || 0).toLocaleString('en-US')} km</span>}
                <span className={s.stat}>{(r.total_images || 0).toLocaleString('en-US')} photos</span>
                <span className={s.pts}>{(parseInt(r.point, 10) || 0).toLocaleString('en-US')}</span>
              </li>
            ))}
          </ol>
        )}
        <p className={s.boardNote}>Contribution points measure imagery you upload. They are not OpenStreetMap edits and not a promise of payment.</p>
        <a className={s.inlineLinkDark} href="/app?board=contributors">Open the leaderboard in the app →</a>
      </div>
      <p className={s.fairPlay}>{PROGRESS.fairPlay}</p>
    </div>
  );
}
