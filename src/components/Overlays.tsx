import React from 'react';
import { boxToCanvas, resolveBox, resolvePoint, toCanvas, type Layout } from '../lib/geometry';
import { clamp01, easeInOut, pointerAt } from '../lib/timeline';
import type { Annotation, Box, Capture, Recipe } from '../lib/types';
import { ScreenCrop, type Ctx } from './Source';
import { font } from '../fonts';

type Common = { L: Layout; ctx: Ctx; S: number; accent: string; elements: Record<string, Box>; labelFont?: string };

// Fade in/out for things with start/end in capture time; stills are always fully shown.
export function presence(ctx: Ctx, start?: number, end?: number, fade = 0.25): number {
  if (ctx.still) return 1;
  const a = start == null ? 1 : easeInOut((ctx.tc - start) / fade);
  const b = end == null ? 1 : 1 - easeInOut((ctx.tc - end) / fade);
  return Math.min(a, b);
}

export const Lift: React.FC<Common & { spec: NonNullable<Recipe['lift']>; device: string }> = ({ L, ctx, S, accent, elements, spec, device, labelFont }) => {
  const p = presence(ctx, spec.start, undefined, 0.6);
  if (p <= 0) return null;
  // pad (points) gives rows that are bare text on the screen some margin as a card
  const raw = boxToCanvas(L, resolveBox(spec.target, elements));
  const pad = (spec.pad ?? 8) * L.k;
  const from = { x: raw.x - pad, y: raw.y - pad, w: raw.w + 2 * pad, h: raw.h + 2 * pad };
  // On a phone the row floats wider than the device with even margins; elsewhere it grows a bit.
  const toW = spec.scale ? from.w * spec.scale : device.startsWith('iphone') ? L.outer.w * 1.1 : from.w * 1.12;
  const f = 1 + (toW / from.w - 1) * p;
  const w = from.w * f;
  const h = from.h * f;
  const toCx = device.startsWith('iphone') ? L.outer.x + L.outer.w / 2 : from.x + from.w / 2;
  const x = from.x + from.w / 2 + (toCx - from.x - from.w / 2) * p - w / 2;
  const y = from.y + from.h / 2 - h / 2;
  const labelP = clamp01((p - 0.55) / 0.45);
  return (
    <>
      <ScreenCrop
        ctx={ctx}
        screen={L.screen}
        box={{ x, y, w, h }}
        f={f}
        focus={{ x: from.x + from.w / 2, y: from.y + from.h / 2 }}
        radius={(spec.radius ?? 12) * L.k * f}
        style={{
          boxShadow: `0 ${S * 0.03 * p}px ${S * 0.06}px rgba(30,20,60,${0.3 * p}), 0 ${S * 0.006}px ${S * 0.014}px rgba(30,20,60,${0.14 * p})`,
        }}
      />
      {spec.label && labelP > 0 && (
        <Pill S={S} accent={accent} family={font(labelFont)} style={{ left: x + w - S * 0.01, top: y + h + S * 0.022, transform: `translate(-100%, ${(1 - labelP) * S * 0.015}px)`, opacity: labelP }}>
          {spec.label}
        </Pill>
      )}
    </>
  );
};

const Pill: React.FC<{ S: number; accent: string; family: string; style: React.CSSProperties; children: React.ReactNode }> = ({ S, accent, family, style, children }) => (
  <div
    style={{
      position: 'absolute',
      background: accent,
      color: '#fff',
      fontFamily: family,
      fontWeight: 600,
      fontSize: S * 0.021,
      padding: `${S * 0.009}px ${S * 0.018}px`,
      borderRadius: S,
      whiteSpace: 'nowrap',
      boxShadow: `0 ${S * 0.01}px ${S * 0.025}px rgba(40,30,90,.3)`,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Loupe: React.FC<Common & { spec: NonNullable<Recipe['loupe']> }> = ({ L, ctx, S, elements, spec }) => {
  const p = presence(ctx, spec.start, spec.end, 0.4);
  if (p <= 0) return null;
  const z = spec.zoom ?? 2.4;
  const r = S * (spec.size ?? 0.12) * (0.6 + 0.4 * p);
  const c = toCanvas(L, resolvePoint(spec.target, elements, ctx.cap, spec.anchor));
  const [ox, oy] = spec.offset ?? [0, 0];
  const cx = c.x + ox * S;
  const cy = c.y + oy * S;
  const rim = r * 0.05;
  return (
    <ScreenCrop
      ctx={ctx}
      screen={L.screen}
      box={{ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }}
      f={z}
      focus={c}
      radius="50%"
      style={{
        opacity: p,
        background: '#fff',
        boxShadow: `0 ${r * 0.18}px ${r * 0.45}px rgba(20,15,40,.32), 0 0 0 ${rim}px rgba(255,255,255,.92), 0 0 0 ${rim + 1}px rgba(0,0,0,.08)`,
      }}
    >
      {/* glass: bright refracting edge and a soft highlight */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          boxShadow: `inset 0 0 ${r * 0.12}px ${r * 0.03}px rgba(255,255,255,.75), inset 0 ${-r * 0.06}px ${r * 0.15}px rgba(40,30,80,.18)`,
          background: 'radial-gradient(60% 40% at 35% 18%, rgba(255,255,255,.35), rgba(255,255,255,0) 70%)',
        }}
      />
    </ScreenCrop>
  );
};

export const Pointer: React.FC<{ L: Layout; cap: Capture; tc: number; kind: string; S: number; accent: string; size?: number }> = ({
  L,
  cap,
  tc,
  kind,
  S,
  accent,
  size = 1,
}) => {
  const p = pointerAt(cap, tc);
  if (!p) return null;
  const c = toCanvas(L, p);
  if (kind === 'touch') {
    // iOS-style touch disc while the finger is down, lingering briefly after a tap.
    const samples = [0, 0.05, 0.1, 0.15, 0.2].map((d) => (pointerAt(cap, tc - d)?.down ? 1 : 0));
    const o = samples.reduce((a, b) => a + b, 0 as number) / samples.length;
    if (o === 0) return null;
    const d = 44 * L.k * size;
    return (
      <div
        style={{
          position: 'absolute',
          left: c.x - d / 2,
          top: c.y - d / 2,
          width: d,
          height: d,
          borderRadius: '50%',
          background: 'rgba(206,206,212,.62)',
          boxShadow: `0 0 0 ${1.5 * L.k}px rgba(255,255,255,.55), 0 ${2 * L.k}px ${8 * L.k}px rgba(0,0,0,.12)`,
          opacity: Math.min(1, o * 1.6),
          transform: `scale(${0.85 + 0.15 * o})`,
        }}
      />
    );
  }
  const px = Math.max(26 * L.k, S * 0.026) * size;
  let press = 0;
  const ripples: React.ReactNode[] = [];
  for (const cl of cap.clicks) {
    const dt = tc - cl.t;
    if (dt > -0.12 && dt < 0.2) press = Math.max(press, 1 - Math.abs(dt - 0.02) / 0.16);
    if (dt >= 0 && dt < 0.55) {
      const k = dt / 0.55;
      const rc = toCanvas(L, cl);
      const rr = px * (0.4 + 1.0 * easeInOut(k));
      ripples.push(
        <div
          key={cl.t}
          style={{
            position: 'absolute',
            left: rc.x - rr,
            top: rc.y - rr,
            width: 2 * rr,
            height: 2 * rr,
            borderRadius: '50%',
            border: `${px * 0.08}px solid ${accent}`,
            opacity: 0.75 * (1 - k),
            background: `${accent}29`,
          }}
        />,
      );
    }
  }
  return (
    <>
      {ripples}
      <svg
        width={px}
        height={px}
        viewBox="0 0 26 26"
        style={{
          position: 'absolute',
          left: c.x - px * 0.2,
          top: c.y - px * 0.12,
          transform: `scale(${1 - 0.18 * clamp01(press)})`,
          transformOrigin: '20% 12%',
          filter: `drop-shadow(0 ${px * 0.06}px ${px * 0.1}px rgba(0,0,0,.3))`,
        }}
      >
        <path d="M5.2 3.1v17.6l4.3-4.1 2.8 6.4 3.2-1.4-2.8-6.3h6z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </>
  );
};

// Steps, arrows, outlines and redactions sit on the screen and move with the camera.
export const ScreenAnnotations: React.FC<Common & { list: Annotation[]; W: number; H: number }> = ({ L, ctx, S, accent, elements, list, W, H }) => (
  <>
    {list.map((a, i) => {
      if (a.type === 'text') return null;
      const o = presence(ctx, a.start, a.end);
      if (o <= 0) return null;
      if (a.type === 'blur' || a.type === 'redact') {
        const b = boxToCanvas(L, resolveBox(a.target, elements));
        if (a.type === 'redact') {
          return <div key={i} style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 4 * L.k, background: a.color ?? '#1c1b1f', opacity: o }} />;
        }
        return (
          <ScreenCrop
            key={i}
            ctx={ctx}
            screen={L.screen}
            box={b}
            f={1}
            radius={4 * L.k}
            style={{ opacity: o }}
            innerStyle={{ filter: `blur(${(a.amount ?? 9) * L.k}px) saturate(.8)` }}
          />
        );
      }
      if (a.type === 'outline') {
        const b = boxToCanvas(L, resolveBox(a.target, elements));
        const pad = (a.pad ?? 6) * L.k;
        const color = a.color ?? accent;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: b.x - pad,
              top: b.y - pad,
              width: b.w + 2 * pad,
              height: b.h + 2 * pad,
              borderRadius: (a.radius ?? 12) * L.k,
              border: `${S * 0.005}px solid ${color}`,
              boxShadow: `0 0 0 ${S * 0.008}px ${color}22`,
              opacity: o,
            }}
          />
        );
      }
      if (a.type === 'step') {
        const pt = toCanvas(L, resolvePoint(a.target, elements, ctx.cap, a.anchor ?? [0, 0.5]));
        const [ox, oy] = a.offset ?? [-0.035, 0];
        const d = S * 0.052;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: pt.x + ox * S - d / 2,
              top: pt.y + oy * S - d / 2,
              width: d,
              height: d,
              borderRadius: '50%',
              background: accent,
              color: '#fff',
              fontFamily: 'Inter',
              fontWeight: 700,
              fontSize: d * 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 0 0 ${d * 0.08}px #fff, 0 ${d * 0.15}px ${d * 0.35}px rgba(30,20,60,.3)`,
              opacity: o,
              transform: `scale(${0.7 + 0.3 * o})`,
            }}
          >
            {a.n}
          </div>
        );
      }
      if (a.type === 'arrow') {
        const to = toCanvas(L, resolvePoint(a.to, elements, ctx.cap, a.anchor));
        let from;
        if (a.fromCanvas) from = { x: a.fromCanvas[0] * W, y: a.fromCanvas[1] * H };
        else if (a.from) from = toCanvas(L, resolvePoint(a.from, elements, ctx.cap));
        else {
          // Come in from the nearest side of the canvas.
          const dx = to.x - W / 2;
          const dy = to.y - H / 2;
          const len = Math.hypot(dx, dy) || 1;
          from = { x: to.x + (dx / len) * S * 0.22 + S * 0.05, y: to.y + (dy / len) * S * 0.22 - S * 0.08 };
        }
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        const curve = a.curve ?? 0.25;
        const cx = mx - ((to.y - from.y) / len) * len * curve;
        const cy = my + ((to.x - from.x) / len) * len * curve;
        const sw = S * 0.011;
        const ang = Math.atan2(to.y - cy, to.x - cx);
        const head = sw * 3.2;
        // stop the line under the head
        const ex = to.x - Math.cos(ang) * head * 0.7;
        const ey = to.y - Math.sin(ang) * head * 0.7;
        const color = a.color ?? '#ffffff';
        const pts = [
          [to.x, to.y],
          [to.x - Math.cos(ang - 0.45) * head, to.y - Math.sin(ang - 0.45) * head],
          [to.x - Math.cos(ang + 0.45) * head, to.y - Math.sin(ang + 0.45) * head],
        ]
          .map((p) => p.join(','))
          .join(' ');
        // Draw-on: the stroke grows from the start as it appears.
        const dash = len * 1.3;
        return (
          <svg key={i} width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', filter: `drop-shadow(0 ${sw * 0.4}px ${sw}px rgba(0,0,0,.28))` }}>
            <path
              d={`M${from.x},${from.y} Q${cx},${cy} ${ex},${ey}`}
              fill="none"
              stroke={color}
              strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={dash}
              strokeDashoffset={dash * (1 - o)}
            />
            <polygon points={pts} fill={color} stroke={color} strokeWidth={sw * 0.5} strokeLinejoin="round" opacity={clamp01((o - 0.7) / 0.3)} />
          </svg>
        );
      }
      return null;
    })}
  </>
);

// Captions and titles: placed on the canvas and not affected by zoom.
export const CanvasText: React.FC<{ list: Annotation[]; ctx: Ctx; W: number; H: number; S: number; defaultFont?: string }> = ({ list, ctx, W, H, S, defaultFont }) => (
  <>
    {list.map((a, i) => {
      if (a.type !== 'text') return null;
      const o = presence(ctx, a.start, a.end, 0.35);
      if (o <= 0) return null;
      const align = a.align ?? 'center';
      const maxW = (a.maxWidth ?? 0.8) * W;
      return (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: a.at[0] * W,
            top: a.at[1] * H,
            width: maxW,
            transform: `translate(${align === 'center' ? -50 : align === 'right' ? -100 : 0}%, ${(1 - o) * S * 0.02}px)`,
            textAlign: align,
            fontFamily: font(a.font ?? defaultFont),
            fontWeight: a.weight ?? 700,
            fontSize: (a.size ?? 0.05) * S,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: a.color ?? '#1c1b1f',
            opacity: o,
          }}
        >
          {a.text}
        </div>
      );
    })}
  </>
);
