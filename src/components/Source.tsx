import React from 'react';
import { useCurrentFrame, useVideoConfig } from '../runtime';
import { frameAt, videoFrameAt, type TimeMap } from '../lib/timeline';
import type { Box, Capture, VideoFrames } from '../lib/types';

// Everything a screen-content layer needs to draw the capture at the current moment.
export type Ctx = {
  cap: Capture;
  map: TimeMap;
  still: { file: string } | null;
  tc: number; // capture time
  assetBase?: string;
  videoFrames?: VideoFrames;
};

export const asset = (base: string | undefined, p: string) => (base ?? '/public/') + p;

// The captured screen drawn at w x h px. Used for the main screen and for every crop
// (lift, loupe, blur), so crops always show the same moment as the screen.
// Video sources are drawn from frames the renderer pre-extracts with ffmpeg.
export const Screen: React.FC<{ ctx: Ctx; w: number; h: number; style?: React.CSSProperties }> = ({ ctx, w, h, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { cap, map, still, tc, assetBase, videoFrames } = ctx;
  const sized: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: w, height: h, display: 'block', ...style };
  if (still || !cap.video) {
    const file = still ? still.file : frameAt(cap, tc);
    return <img src={asset(assetBase, `captures/${cap.name}/${file}`)} style={sized} />;
  }
  if (!videoFrames) throw new Error(`capture "${cap.name}" is a video; the renderer must pass videoFrames`);
  const n = videoFrameAt(map, frame, fps, videoFrames);
  return <img src={`${videoFrames.base}${n}.png`} style={sized} />;
};

// A window onto the screen: `box` (canvas px) shows the screen magnified f times around
// `focus` (canvas px of the unmagnified screen).
export const ScreenCrop: React.FC<{
  ctx: Ctx;
  screen: Box;
  box: Box;
  f: number;
  focus?: { x: number; y: number };
  radius?: number | string;
  style?: React.CSSProperties;
  innerStyle?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ ctx, screen, box, f, focus, radius, style, innerStyle, children }) => {
  // Default: content is anchored so the box shows the region it sits over, scaled about its centre.
  const fx = focus ? focus.x : box.x + box.w / 2;
  const fy = focus ? focus.y : box.y + box.h / 2;
  const left = box.w / 2 - (fx - screen.x) * f;
  const top = box.h / 2 - (fy - screen.y) * f;
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', borderRadius: radius, ...style }}>
      <div style={{ position: 'absolute', left, top, width: screen.w * f, height: screen.h * f, ...innerStyle }}>
        <Screen ctx={ctx} w={screen.w * f} h={screen.h * f} />
      </div>
      {children}
    </div>
  );
};
