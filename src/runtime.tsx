// The few rendering primitives the scene needs: a frame clock, canvas config, a full-size
// layer and a registry of work (image decodes, font loads) a frame must wait for before the
// renderer screenshots it. Replaces the parts of Remotion this project used.
import React, { createContext, useContext } from 'react';

export type VideoConfig = { width: number; height: number; fps: number; durationInFrames: number };

const FrameContext = createContext<{ frame: number; config: VideoConfig }>({
  frame: 0,
  config: { width: 1920, height: 1080, fps: 30, durationInFrames: 1 },
});

export const FrameProvider: React.FC<{ frame: number; config: VideoConfig; children: React.ReactNode }> = ({ frame, config, children }) => (
  <FrameContext.Provider value={{ frame, config }}>{children}</FrameContext.Provider>
);

export const useCurrentFrame = () => useContext(FrameContext).frame;
export const useVideoConfig = () => useContext(FrameContext).config;

// Same box as Remotion's AbsoluteFill (a flex column), so layouts did not shift in the move.
export const AbsoluteFill: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}
  >
    {children}
  </div>
);

const pending = new Set<Promise<unknown>>();

// Holds the current frame until `p` settles (e.g. a font load).
export function waitFor<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  p.catch(() => {}).finally(() => pending.delete(p));
  return p;
}

function imageReady(img: HTMLImageElement): Promise<void> {
  if (img.complete) return img.naturalWidth ? img.decode().catch(() => {}) : Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener('load', () => img.decode().catch(() => {}).then(resolve), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}

// Resolves once the DOM as committed can be captured: registered work is done, every <img>
// is decoded and no font is still loading. Returns the images that failed to load.
export async function frameReady(): Promise<string[]> {
  for (let round = 0; round < 20; round++) {
    // layout first, so text set in a font that is not loaded yet starts loading it
    void document.body.offsetHeight;
    await Promise.all([...Array.from(document.images).map(imageReady), ...pending, document.fonts.ready]);
    if (!pending.size && document.fonts.status === 'loaded') break;
  }
  return Array.from(document.images)
    .filter((img) => img.complete && !img.naturalWidth)
    .map((img) => img.src);
}
