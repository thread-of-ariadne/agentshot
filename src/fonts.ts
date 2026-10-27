// Fonts available to titles and labels (recipe "font" / annotation "font"), bundled from
// @fontsource packages (OFL) so renders never touch the network. The bundler renames the
// "X Variable" families to plain "X" (lib/bundle.mjs). Font files only load when used.
import '@fontsource-variable/caveat/wght.css';
import '@fontsource-variable/cormorant-garamond/wght.css';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource-variable/fraunces/wght.css';
import '@fontsource/gilda-display/400.css';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/lora/wght.css';
import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/nunito/wght.css';
import '@fontsource-variable/playfair-display/wght.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import { waitFor } from './runtime';

// family -> weights to have ready before the first frame
const FONTS: Record<string, string[]> = {
  Caveat: ['400', '500', '600', '700'],
  'Cormorant Garamond': ['400', '500', '600', '700'],
  'DM Serif Display': ['400'],
  Fraunces: ['400', '500', '600', '700'],
  'Gilda Display': ['400'],
  Inter: ['400', '500', '600', '700'],
  Lora: ['400', '500', '600', '700'],
  Manrope: ['400', '500', '600', '700'],
  Nunito: ['400', '500', '600', '700'],
  'Playfair Display': ['400', '500', '600', '700'],
  Poppins: ['400', '500', '600', '700'],
};

export const FONT_NAMES = Object.keys(FONTS);

const loaded = new Map<string, string>();

// Returns a CSS font-family for the name, loading it on first use.
export function font(name = 'Inter'): string {
  const hit = loaded.get(name);
  if (hit) return hit;
  const weights = FONTS[name];
  if (!weights) throw new Error(`Unknown font "${name}". Available: ${FONT_NAMES.join(', ')}`);
  for (const w of weights) waitFor(document.fonts.load(`${w} 16px "${name}"`));
  const css = `"${name}", Inter, sans-serif`;
  loaded.set(name, css);
  return css;
}
