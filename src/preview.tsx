// `agentshot preview <recipe.json>`: the scene at any frame with a scrubber, served by
// lib/preview.mjs. Reloads the recipe when the file changes and the page when src/ does.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadCapture, metadata } from './composition';
import { Scene } from './Scene';
import { timeMap, videoFrameAt } from './lib/timeline';
import type { Capture, Recipe } from './lib/types';
import { FrameProvider, type VideoConfig } from './runtime';

type Loaded = { recipe: Recipe; cap: Capture; config: VideoConfig };
type State = { recipe: number; bundle: string; file: string };

async function load(): Promise<Loaded> {
  const res = await fetch('/api/recipe');
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  let recipe: Recipe = body.recipe;
  const cap = await loadCapture(recipe);
  const config = metadata(recipe, cap);
  if (body.video) {
    // same frame plan as a render, so the preview extracts only what the recipe shows
    const map = timeMap(recipe, cap);
    const need = new Set<number>();
    for (let f = 0; f < config.durationInFrames; f++) need.add(videoFrameAt(map, f, config.fps, body.video));
    const ex = await fetch('/api/extract', { method: 'POST', body: JSON.stringify({ indices: [...need] }) });
    if (!ex.ok) throw new Error((await ex.json()).error);
    recipe = { ...recipe, videoFrames: { base: `/frames/${body.video.key}/`, times: body.video.times } };
  }
  return { recipe, cap, config };
}

class Boundary extends React.Component<{ children: React.ReactNode; reset: unknown }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { reset: unknown }) {
    if (prev.reset !== this.props.reset && this.state.error) this.setState({ error: null });
  }
  render() {
    return this.state.error ? <div style={css.error}>{this.state.error.message}</div> : this.props.children;
  }
}

const fmt = (frame: number, fps: number) => `${(frame / fps).toFixed(2)}s`;

const App: React.FC = () => {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight });
  const stamp = useRef<State | null>(null);

  const reload = () =>
    load()
      .then((d) => {
        setData(d);
        setError(null);
        setFrame((f) => Math.min(f, d.config.durationInFrames - 1));
      })
      .catch((e) => setError(String(e.message ?? e)));

  useEffect(() => {
    reload();
    const onResize = () => setBox({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    const poll = setInterval(async () => {
      const s: State = await fetch('/api/state').then((r) => r.json()).catch(() => null);
      if (!s) return;
      const prev = stamp.current;
      stamp.current = s;
      if (prev && prev.bundle !== s.bundle) location.reload();
      else if (prev && prev.recipe !== s.recipe) reload();
    }, 800);
    return () => {
      clearInterval(poll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const total = data?.config.durationInFrames ?? 1;
  const fps = data?.config.fps ?? 30;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now();
    const f0 = frame >= total - 1 ? 0 : frame;
    const tick = (now: number) => {
      setFrame(Math.min(total - 1, f0 + Math.floor(((now - t0) / 1000) * fps)));
      if (f0 + ((now - t0) / 1000) * fps >= total - 1) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, fps]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.key !== ' ') return;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') setFrame((f) => Math.min(total - 1, f + (e.shiftKey ? fps : 1)));
      else if (e.key === 'ArrowLeft') setFrame((f) => Math.max(0, f - (e.shiftKey ? fps : 1)));
      else if (e.key === 'Home') setFrame(0);
      else if (e.key === 'End') setFrame(total - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total, fps]);

  if (!data) return <div style={css.page}>{error ? <div style={css.error}>{error}</div> : <div style={css.hint}>Loading…</div>}</div>;

  const { recipe, cap, config } = data;
  const video = !recipe.shot;
  const barH = video ? 76 : 40;
  const k = Math.min((box.w - 48) / config.width, (box.h - barH - 48) / config.height);
  const map = timeMap(recipe, cap);

  return (
    <div style={css.page}>
      <div style={{ ...css.top }}>
        <b>{recipe.product}/{recipe.name}</b>
        <span>
          {config.width}×{config.height} · {video ? `${fps} fps · ${fmt(total, fps)}` : 'still'}
        </span>
        {error && <span style={{ color: '#ff8a80' }}>{error}</span>}
      </div>
      <div style={{ ...css.stage, height: box.h - barH }}>
        <div style={{ width: config.width * k, height: config.height * k, position: 'relative', boxShadow: '0 10px 40px rgba(0,0,0,.45)' }}>
          {/* outside the scaled canvas, so a scene error reads at normal size */}
          <Boundary reset={`${frame}|${JSON.stringify(recipe)}`}>
            <div style={{ width: config.width, height: config.height, position: 'absolute', overflow: 'hidden', transform: `scale(${k})`, transformOrigin: '0 0' }}>
              <FrameProvider frame={frame} config={config}>
                <Scene {...recipe} cap={cap} />
              </FrameProvider>
            </div>
          </Boundary>
        </div>
      </div>
      {video && (
        <div style={css.bar}>
          <button style={css.button} onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="range"
              min={0}
              max={total - 1}
              value={frame}
              onChange={(e) => {
                setPlaying(false);
                setFrame(Number(e.target.value));
              }}
              style={{ width: '100%' }}
            />
            {/* cut boundaries and names, in output time */}
            {map.cuts.map((c, i) => (
              <div key={i} style={{ ...css.cut, left: `${((c.outStart * fps) / Math.max(1, total - 1)) * 100}%` }}>
                {c.name ?? ''}
              </div>
            ))}
          </div>
          <span style={css.time}>
            {frame} / {total - 1} · {fmt(frame, fps)}
          </span>
        </div>
      )}
    </div>
  );
};

const css: Record<string, React.CSSProperties> = {
  page: { position: 'fixed', inset: 0, background: '#1d1c21', color: '#e9e7ee', font: '13px system-ui, sans-serif', overflow: 'hidden' },
  top: { height: 40, display: 'flex', gap: 16, alignItems: 'center', padding: '0 16px', boxSizing: 'border-box' },
  stage: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 36, display: 'flex', gap: 12, alignItems: 'center', padding: '0 16px 8px' },
  button: { width: 64, background: '#3a3843', color: '#fff', border: 0, borderRadius: 6, padding: '5px 0', cursor: 'pointer' },
  time: { width: 150, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  cut: { position: 'absolute', top: -14, borderLeft: '1px solid #8b88a0', paddingLeft: 3, fontSize: 10, color: '#a7a4b8', whiteSpace: 'nowrap', pointerEvents: 'none' },
  error: { position: 'absolute', inset: 0, padding: 24, color: '#ff8a80', background: 'rgba(20,18,24,.85)', font: '14px ui-monospace, monospace', whiteSpace: 'pre-wrap' },
  hint: { padding: 24, color: '#a7a4b8' },
};

createRoot(document.getElementById('root')!).render(<App />);
