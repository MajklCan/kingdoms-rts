/**
 * Integer texel scale for the pixel-art skin. The skin textures are authored
 * at 1x (scripts/ui/gen_ui_skin.py) and drawn through border-image and
 * tiled backgrounds sized in multiples of `--px`. One texel must cover a
 * whole number of device pixels or the art smears, so `--px` is derived from
 * the root font size (which already follows the viewport and the UI scale
 * setting) and rounded in device pixels: 2 device px per texel at 1280x720,
 * 3 at 1920x1080, 4 at 1280x720 on a 2x display.
 */

const TEXELS_PER_REM = 8;

export function texelDevicePixels(rootFontPx: number, dpr: number): number {
  return Math.max(1, Math.round((rootFontPx * dpr) / TEXELS_PER_REM));
}

export function syncPixelScale(): void {
  const root = document.documentElement;
  const fontPx = parseFloat(getComputedStyle(root).fontSize) || 16;
  const dpr = window.devicePixelRatio || 1;
  const px = texelDevicePixels(fontPx, dpr) / dpr;
  root.style.setProperty('--px', `${px}px`);
  root.dataset.texel = String(texelDevicePixels(fontPx, dpr));
}

let bound = false;

/** Keep `--px` right through window resizes and moves between displays. */
export function bindPixelScale(): void {
  syncPixelScale();
  if (bound) return;
  bound = true;
  window.addEventListener('resize', syncPixelScale);
  const watchDpr = (): void => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener(
      'change',
      () => {
        syncPixelScale();
        watchDpr();
      },
      { once: true }
    );
  };
  watchDpr();
}
