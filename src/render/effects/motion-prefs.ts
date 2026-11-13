/**
 * `prefers-reduced-motion`, kept live. With it set, world VFX skip camera
 * shake and ambient motion (tree sway, clouds, birds, weather); one-shot
 * feedback (impacts, smoke) stays but is never shaken.
 */

let reduced = false;
let installed = false;

function install(): void {
  installed = true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = query.matches;
  query.addEventListener?.('change', (event) => {
    reduced = event.matches;
  });
}

export function reducedMotion(): boolean {
  if (!installed) install();
  return reduced;
}
