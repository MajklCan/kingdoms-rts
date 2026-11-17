/**
 * Cache key for files the game loads at runtime from public/ (sprite
 * atlases and manifests, portraits, audio). Their names carry no content
 * hash, and some hosts serve /assets/* as immutable for a year, so a new
 * build could pair a cached old atlas image with a new frame list. Every
 * such URL carries the build version instead.
 */

const BUILD_KEY = `${__APP_VERSION__}-${__GIT_COMMIT__}`;

/** `url` with the build version as a query parameter. */
export function versioned(url: string, key: string = BUILD_KEY): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(key)}`;
}
