import React from 'react';
import { IPHONE, type Layout } from '../lib/geometry';

const RIMS = {
  'iphone-black': 'linear-gradient(135deg, #4a4a50 0%, #1c1c1f 30%, #2c2c31 70%, #55555c 100%)',
  'iphone-natural': 'linear-gradient(135deg, #e9e4da 0%, #b9b2a5 30%, #cfc8bb 70%, #f1ece3 100%)',
  'iphone-white': 'linear-gradient(135deg, #ffffff 0%, #d9d9de 30%, #ececf0 70%, #ffffff 100%)',
};

// Frame drawn behind the screen content.
export const DeviceBack: React.FC<{ device: string; L: Layout; url?: string; title?: string }> = ({ device, L, url, title }) => {
  const { outer, k } = L;
  if (device.startsWith('iphone')) {
    const rim = RIMS[device as keyof typeof RIMS] ?? RIMS['iphone-black'];
    const R = (IPHONE.screenRadius + IPHONE.bezel + IPHONE.rim) * k;
    const btn = (side: 'l' | 'r', top: number, h: number) => (
      <div
        style={{
          position: 'absolute',
          [side === 'l' ? 'left' : 'right']: -2.6 * k,
          top: top * k,
          width: 3.2 * k,
          height: h * k,
          borderRadius: 2 * k,
          background: rim,
        }}
      />
    );
    return (
      <div
        style={{
          position: 'absolute',
          left: outer.x,
          top: outer.y,
          width: outer.w,
          height: outer.h,
          borderRadius: R,
          background: rim,
          boxShadow: `0 ${40 * k}px ${90 * k}px rgba(30,20,60,.28), 0 ${8 * k}px ${20 * k}px rgba(30,20,60,.18)`,
        }}
      >
        {btn('l', 120, 30)}
        {btn('l', 175, 58)}
        {btn('l', 245, 58)}
        {btn('r', 205, 92)}
        <div
          style={{
            position: 'absolute',
            inset: IPHONE.rim * k,
            borderRadius: R - IPHONE.rim * k,
            background: '#050506',
          }}
        />
      </div>
    );
  }
  if (device === 'none') {
    const s = L.screen;
    return (
      <div
        style={{
          position: 'absolute',
          left: s.x,
          top: s.y,
          width: s.w,
          height: s.h,
          borderRadius: L.radius,
          boxShadow: `0 ${s.h * 0.03}px ${s.h * 0.08}px rgba(30,30,40,.22), 0 0 0 1px rgba(0,0,0,.06)`,
        }}
      />
    );
  }
  if (device === 'window') {
    const bar = L.screen.y - outer.y;
    const r = bar * 0.45;
    return (
      <div
        style={{
          position: 'absolute',
          left: outer.x,
          top: outer.y,
          width: outer.w,
          height: outer.h,
          borderRadius: r,
          background: '#f1efec',
          overflow: 'hidden',
          boxShadow: `0 ${bar * 1.2}px ${bar * 3}px rgba(30,30,40,.22), 0 0 0 1px rgba(0,0,0,.08)`,
        }}
      >
        <div style={{ position: 'absolute', left: bar * 0.5, top: bar / 2 - bar * 0.16, display: 'flex', gap: bar * 0.22 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <div key={c} style={{ width: bar * 0.32, height: bar * 0.32, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: bar,
            lineHeight: `${bar}px`,
            textAlign: 'center',
            fontFamily: 'Inter',
            fontWeight: 600,
            fontSize: bar * 0.38,
            color: '#4a4850',
          }}
        >
          {title ?? ''}
        </div>
      </div>
    );
  }
  if (device === 'browser') {
    const bar = L.screen.y - outer.y;
    const r = bar * 0.32;
    return (
      <div
        style={{
          position: 'absolute',
          left: outer.x,
          top: outer.y,
          width: outer.w,
          height: outer.h,
          borderRadius: r,
          background: '#f1efec',
          overflow: 'hidden',
          boxShadow: `0 ${bar * 0.9}px ${bar * 2.2}px rgba(30,30,40,.22), 0 0 0 1px rgba(0,0,0,.06)`,
        }}
      >
        <div style={{ position: 'absolute', left: bar * 0.42, top: bar / 2 - bar * 0.12, display: 'flex', gap: bar * 0.16 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <div key={c} style={{ width: bar * 0.24, height: bar * 0.24, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: bar * 0.2,
            height: bar * 0.6,
            width: outer.w * 0.34,
            transform: 'translateX(-50%)',
            background: '#fff',
            borderRadius: bar * 0.3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: bar * 0.12,
            fontFamily: 'Inter',
            fontSize: bar * 0.27,
            fontWeight: 500,
            color: '#5d5a63',
            boxShadow: '0 0 0 1px rgba(0,0,0,.05)',
          }}
        >
          <svg width={bar * 0.22} height={bar * 0.22} viewBox="0 0 12 12">
            <rect x="2" y="5" width="8" height="6" rx="1.5" fill="#8a8791" />
            <path d="M4 5V3.6a2 2 0 0 1 4 0V5" stroke="#8a8791" strokeWidth="1.3" fill="none" />
          </svg>
          {url ?? 'app.daybook.so'}
        </div>
      </div>
    );
  }
  return null;
};

// Dynamic Island and a tidy 9:41 status bar, drawn over the screenshot (in screen points).
export const IPhoneOverlay: React.FC<{ L: Layout; dark?: boolean; statusBar?: boolean }> = ({ L, dark, statusBar = true }) => {
  const ink = dark ? '#fff' : '#111';
  const { island } = IPHONE;
  return (
    <div
      style={{
        position: 'absolute',
        left: L.screen.x,
        top: L.screen.y,
        width: 390,
        height: 54,
        transform: `scale(${L.k})`,
        transformOrigin: '0 0',
        fontFamily: 'Inter',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: (390 - island.w) / 2,
          top: island.top,
          width: island.w,
          height: island.h,
          borderRadius: island.h / 2,
          background: '#000',
        }}
      />
      {statusBar && (
      <>
      <div style={{ position: 'absolute', left: 0, width: 133, top: 17, textAlign: 'center', fontSize: 17, fontWeight: 600, color: ink, letterSpacing: -0.2 }}>
        9:41
      </div>
      <svg style={{ position: 'absolute', left: 289, top: 21 }} width="78" height="13" viewBox="0 0 78 13">
        <g fill={ink}>
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="4.6" y="6" width="3" height="6" rx="1" />
          <rect x="9.2" y="3.5" width="3" height="8.5" rx="1" />
          <rect x="13.8" y="1" width="3" height="11" rx="1" />
          <path d="M30 3.2a10.5 10.5 0 0 1 14.2 0l-1.3 1.4a8.6 8.6 0 0 0-11.6 0z M32.3 5.8a7 7 0 0 1 9.6 0l-1.3 1.4a5.1 5.1 0 0 0-7 0z M34.6 8.4a3.6 3.6 0 0 1 5 0L37.1 11z" />
          <rect x="51" y="1" width="23" height="11.5" rx="3.6" fill="none" stroke={ink} strokeOpacity=".4" strokeWidth="1" />
          <rect x="53" y="3" width="19" height="7.5" rx="2" />
          <path d="M75.5 4.6v4.2c.9-.3 1.5-1.1 1.5-2.1s-.6-1.8-1.5-2.1z" fillOpacity=".45" />
        </g>
      </svg>
      </>
      )}
    </div>
  );
};
