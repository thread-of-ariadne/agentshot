import React from 'react';
import { AbsoluteFill } from '../runtime';
import { asset } from './Source';

// Built-in looks. Anything else is an image path under public/ (e.g. backgrounds/meadow.jpg)
// or any CSS background value (starts with a colour, gradient or #).
export const PRESETS: Record<string, string> = {
  lavender:
    'radial-gradient(60% 70% at 18% 20%, #f3e8ff 0%, transparent 70%), radial-gradient(55% 65% at 85% 80%, #dfe6ff 0%, transparent 70%), radial-gradient(50% 60% at 80% 15%, #ece4ff 0%, transparent 70%), #e9e5f7',
  peach:
    'radial-gradient(45% 55% at 50% 50%, #ffd2b8 0%, rgba(255,210,184,0) 75%), radial-gradient(70% 80% at 15% 90%, #ffe4d6 0%, transparent 70%), #fbeee6',
  sage:
    'radial-gradient(60% 70% at 25% 25%, #eef3e6 0%, transparent 70%), radial-gradient(60% 70% at 80% 80%, #d6e2d2 0%, transparent 70%), #e3eadd',
  sky:
    'radial-gradient(70% 60% at 30% 20%, #ffffff 0%, transparent 70%), radial-gradient(60% 70% at 80% 85%, #bcd8f5 0%, transparent 70%), #d7e8f8',
  rose:
    'radial-gradient(55% 60% at 50% 45%, #ffd6e4 0%, transparent 75%), radial-gradient(60% 60% at 15% 85%, #ffe9d9 0%, transparent 70%), #fbe8ee',
  mint:
    'radial-gradient(55% 60% at 30% 30%, #e6fbf1 0%, transparent 75%), radial-gradient(60% 60% at 85% 80%, #c9eedd 0%, transparent 70%), #dcf3e8',
  neutral: 'radial-gradient(70% 70% at 50% 40%, #f6f2ec 0%, transparent 75%), #e8e1d6',
  midnight:
    'radial-gradient(45% 55% at 50% 45%, #3a2d75 0%, rgba(58,45,117,0) 70%), radial-gradient(60% 60% at 85% 90%, #1d3a5c 0%, transparent 70%), #0f0e17',
  ink: 'radial-gradient(60% 60% at 50% 40%, #26252c 0%, transparent 75%), #121116',
  dusk:
    'radial-gradient(55% 60% at 22% 18%, #d9a08a 0%, rgba(217,160,138,0) 70%), radial-gradient(60% 65% at 85% 85%, #8f7aa3 0%, rgba(143,122,163,0) 70%), radial-gradient(45% 45% at 80% 15%, #c9a1a0 0%, rgba(201,161,160,0) 70%), #b79a9c',
  plum: 'radial-gradient(55% 60% at 50% 40%, #5b4670 0%, rgba(91,70,112,0) 75%), radial-gradient(60% 60% at 15% 90%, #3b2d4a 0%, transparent 70%), #2a2133',
  white: '#ffffff',
};

const IMAGE = /\.(png|jpe?g|webp|avif)$/i;

export const Background: React.FC<{ name?: string; grain?: number; blur?: number; assetBase?: string }> = ({
  name = 'lavender',
  grain = 0.07,
  blur = 0,
  assetBase,
}) => {
  const isImage = IMAGE.test(name);
  const css = PRESETS[name] ?? (isImage ? '#ddd' : name);
  return (
    <AbsoluteFill style={{ background: css, overflow: 'hidden' }}>
      {isImage && (
        <img
          src={asset(assetBase, name)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: blur ? `blur(${blur}px)` : undefined,
            transform: blur ? 'scale(1.08)' : undefined,
          }}
        />
      )}
      {grain > 0 && (
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: grain, mixBlendMode: 'multiply' }}>
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
      )}
    </AbsoluteFill>
  );
};
