import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from './runtime';
import { Background } from './components/Background';
import { DeviceBack, IPhoneOverlay } from './components/Device';
import { CanvasText, Lift, Loupe, Pointer, ScreenAnnotations, presence } from './components/Overlays';
import { Screen, type Ctx } from './components/Source';
import { font } from './fonts';
import { deviceOf, layout, toCanvas } from './lib/geometry';
import { cameraAt, captureTime, timeMap, zoomSegments } from './lib/timeline';
import type { Capture, Recipe } from './lib/types';

// device chrome, steps and labels use Inter
font('Inter');

// Light, low-contrast UIs (cream on cream) read flat in video; a gentle grade restores depth.
const GRADES: Record<string, string> = {
  vivid: 'contrast(1.06) saturate(1.12)',
  rich: 'contrast(1.1) saturate(1.18) brightness(0.98)',
};

export const Scene: React.FC<Recipe> = (recipe) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const cap = recipe.cap as Capture;
  if (!cap) return null;

  // Sizes of labels, loupes and shadows follow the short side so 4:5 and 16:9 match.
  const S = Math.min(W, H);
  const map = timeMap(recipe, cap);
  const still = recipe.shot ? cap.shots[recipe.shot] : null;
  const tc = still ? 0 : captureTime(map, frame / fps);
  const ctx: Ctx = { cap, map, still, tc, assetBase: recipe.assetBase, videoFrames: recipe.videoFrames };
  const elements = still ? still.elements : cap.elements;
  const device = deviceOf(recipe, cap);
  const L = layout(recipe, cap, W, H);
  const accent = recipe.accent ?? '#6d5ce8';
  const common = { L, ctx, S, accent, elements, labelFont: recipe.labelFont ?? recipe.font };
  const annotations = recipe.annotations ?? [];

  const lift = recipe.lift;
  const liftP = lift ? presence(ctx, lift.start, undefined, 0.6) : 0;

  const cam = still ? { s: 1, focus: null } : cameraAt(zoomSegments(recipe, cap, map), frame / fps);
  const origin = cam.focus ? toCanvas(L, cam.focus) : { x: W / 2, y: H / 2 };
  const tilt = recipe.tilt ?? 0;
  const grade = GRADES[recipe.screenGrade ?? ''] ?? recipe.screenGrade ?? '';
  const statusBar = recipe.statusBar ?? cap.source === 'browser';

  return (
    <AbsoluteFill>
      {/* no background in recipe or style: 'peach', as the Remotion version's composition defaults gave */}
      <Background name={recipe.background ?? 'peach'} grain={recipe.grain} blur={(recipe.backgroundBlur ?? 0) * S} assetBase={recipe.assetBase} />
      <AbsoluteFill style={{ transform: `scale(${cam.s})`, transformOrigin: `${origin.x}px ${origin.y}px` }}>
        <AbsoluteFill
          style={
            tilt
              ? { transform: `perspective(${W * 1.8}px) rotateY(${tilt}deg) rotateX(${tilt * 0.35}deg) rotateZ(${-tilt * 0.12}deg)` }
              : undefined
          }
        >
          <DeviceBack device={device} L={L} url={recipe.url} title={recipe.title} />
          <div
            style={{
              position: 'absolute',
              left: L.screen.x,
              top: L.screen.y,
              width: L.screen.w,
              height: L.screen.h,
              borderRadius: device === 'browser' || device === 'window' ? `0 0 ${S * 0.01}px ${S * 0.01}px` : L.radius,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            <Screen
              ctx={ctx}
              w={L.screen.w}
              h={L.screen.h}
              style={{
                filter:
                  [grade, lift ? `saturate(${1 - 0.45 * liftP}) blur(${0.6 * liftP * L.k}px)` : ''].filter(Boolean).join(' ') || undefined,
              }}
            />
            {lift && <AbsoluteFill style={{ background: `rgba(30,26,48,${(lift.dim ?? 0.16) * liftP})` }} />}
          </div>
          {device.startsWith('iphone') && <IPhoneOverlay L={L} statusBar={statusBar} />}
          <ScreenAnnotations {...common} list={annotations} W={W} H={H} />
          {lift && <Lift {...common} spec={lift} device={device} />}
          {recipe.loupe && <Loupe {...common} spec={recipe.loupe} />}
          {!still && recipe.pointer !== 'none' && (
            <Pointer
              L={L}
              cap={cap}
              tc={tc}
              S={S}
              accent={accent}
              size={recipe.cursorSize}
              kind={recipe.pointer ?? (cap.device === 'iphone' ? 'touch' : 'cursor')}
            />
          )}
        </AbsoluteFill>
      </AbsoluteFill>
      <CanvasText list={annotations} ctx={ctx} W={W} H={H} S={S} defaultFont={recipe.font} />
    </AbsoluteFill>
  );
};
