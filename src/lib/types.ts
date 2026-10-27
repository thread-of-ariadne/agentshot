// Shapes shared by the capture/record/import output and the recipes the agent writes.

// Frames of a capture's video, pre-extracted by the renderer: `${base}${n}.png` is the n-th
// frame (from 0), shown from `times[n]` seconds.
export type VideoFrames = { base: string; times: number[] };

export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export type Capture = {
  name: string;
  source: 'browser' | 'record' | 'import' | 'snap';
  device: 'iphone' | 'desktop';
  viewport: { width: number; height: number };
  scale: number;
  fps: number;
  duration: number;
  frames: { t: number; file: string }[];
  // screen recordings and imported videos
  video?: string;
  pointer: { t: number; x: number; y: number; down: boolean }[];
  clicks: { t: number; x: number; y: number; kind: 'down' | 'click' }[];
  shots: Record<string, { file: string; elements: Record<string, Box> }>;
  elements: Record<string, Box>;
};

// An element name from the capture, [x, y] in screen points, or [x, y, w, h] for a box.
export type Target = string | [number, number] | [number, number, number, number];

export type ZoomSpec = { start: number; end: number; scale?: number; target: Target };

export type Cut = { from: number; to: number; speed?: number; name?: string };

type Timed = { start?: number; end?: number };

export type Annotation = Timed &
  (
    | { type: 'step'; n: number | string; target: Target; anchor?: [number, number]; offset?: [number, number] }
    | { type: 'arrow'; to: Target; from?: Target; fromCanvas?: [number, number]; anchor?: [number, number]; curve?: number; color?: string }
    | { type: 'outline'; target: Target; pad?: number; radius?: number; color?: string }
    | { type: 'blur'; target: Target; amount?: number }
    | { type: 'redact'; target: Target; color?: string }
    | { type: 'text'; text: string; at: [number, number]; size?: number; color?: string; weight?: number; align?: 'left' | 'center' | 'right'; maxWidth?: number; font?: string }
  );

export type Recipe = {
  name: string;
  product?: string;
  capture: string;
  // still: render this named screenshot; omit for a video
  shot?: string;
  size?: string;
  width: number;
  height: number;
  fps?: number;
  // preset, CSS background, image under public/, or "unsplash:<id>" / "met:<id>" / "artic:<id>" /
  // "cleveland:<id>" (the renderer swaps these for the downloaded file before the scene sees them)
  background?: string;
  backgroundBlur?: number;
  grain?: number;
  accent?: string;
  // title/label typefaces, see src/fonts.ts
  font?: string;
  labelFont?: string;
  device?: 'iphone-black' | 'iphone-natural' | 'iphone-white' | 'browser' | 'window' | 'none';
  url?: string;
  title?: string;
  statusBar?: boolean;
  padding?: number;
  tilt?: number;
  // colour grade for the captured screen: 'vivid', 'rich' or a CSS filter, e.g. 'contrast(1.06) saturate(1.1)'
  screenGrade?: string;
  pointer?: 'cursor' | 'touch' | 'none';
  cursorSize?: number;
  zoom?: 'auto' | ZoomSpec[];
  zoomScale?: number;
  cuts?: Cut[];
  lift?: { target: Target; start?: number; radius?: number; scale?: number; dim?: number; label?: string; pad?: number };
  // device centre as fractions of the canvas, e.g. [0.68, 0.5] to leave room for a title on the left
  position?: [number, number];
  loupe?: Timed & { target: Target; anchor?: [number, number]; zoom?: number; size?: number; offset?: [number, number] };
  annotations?: Annotation[];
  tail?: number;
  crf?: number;
  renderScale?: number;
  // set by the renderer
  assetBase?: string;
  cap?: Capture;
  videoFrames?: VideoFrames;
};
