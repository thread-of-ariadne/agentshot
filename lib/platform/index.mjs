// The OS-specific half of shot: window lookup, recording, stills, mouse log and input driver.
// Everything else (scenarios, captures, library) is shared.
export const os = process.platform === 'darwin' ? await import('./mac.mjs') : await import('./win.mjs');
