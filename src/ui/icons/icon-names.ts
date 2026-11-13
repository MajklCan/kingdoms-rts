// List of the SVG icons in public/assets/ui/icons. Each file is a monochrome
// silhouette used as a CSS mask and tinted with currentColor. The coloured
// pixel-art icons live in the sprite sheets listed in raster-icons.ts.
import type { RasterIconName } from './raster-icons';

export const ICON_NAMES = [
  'alert',
  'auto-defend',
  'banners',
  'check',
  'chevron-left',
  'chevron-right',
  'chevron-up',
  'close',
  'crown',
  'defeat',
  'demolish',
  'download',
  'eye',
  'flag',
  'formation-compact',
  'formation-free',
  'formation-line',
  'hammer',
  'helm',
  'hold',
  'hourglass',
  'house',
  'idle',
  'info',
  'keyboard',
  'load',
  'lock',
  'machine-gun',
  'menu',
  'mode-campaign',
  'mode-multiplayer',
  'mode-skirmish',
  'mortar',
  'objectives',
  'pause',
  'person',
  'play',
  'plus',
  'pop',
  'quit',
  'research',
  'save',
  'scroll',
  'settings',
  'shield',
  'sound-off',
  'sound-on',
  'speed',
  'stop',
  'swords',
  'tech',
  'victory',
] as const;

export type SvgIconName = (typeof ICON_NAMES)[number];

/** Any HUD icon: an SVG silhouette or a pixel-art sheet frame. */
export type IconName = SvgIconName | RasterIconName;
