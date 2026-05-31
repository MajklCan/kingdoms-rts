import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from './audio-manager';

function createManager(): AudioManager {
  return new AudioManager({} as Phaser.Scene);
}

function volumeSetter(manager: AudioManager): (sound: Phaser.Sound.BaseSound, volume: number) => boolean {
  return (manager as unknown as {
    setSoundVolume: (sound: Phaser.Sound.BaseSound, volume: number) => boolean;
  }).setSoundVolume.bind(manager);
}

describe('AudioManager stale sound guards', () => {
  const localStorageGetItem = vi.fn<(key: string) => string | null>(() => null);

  beforeEach(() => {
    localStorageGetItem.mockReturnValue(null);
    vi.stubGlobal('localStorage', {
      getItem: localStorageGetItem,
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call setVolume after Phaser has destroyed a sound config', () => {
    const setVolume = vi.fn();
    const sound = {
      currentConfig: null,
      pendingRemove: true,
      setVolume,
      volumeNode: { gain: {} },
    } as unknown as Phaser.Sound.BaseSound;

    expect(volumeSetter(createManager())(sound, 0.5)).toBe(false);
    expect(setVolume).not.toHaveBeenCalled();
  });

  it('does not call setVolume after Phaser has nulled the WebAudio volume node', () => {
    const setVolume = vi.fn();
    const sound = {
      currentConfig: {},
      pendingRemove: false,
      setVolume,
      volumeNode: null,
    } as unknown as Phaser.Sound.BaseSound;

    expect(volumeSetter(createManager())(sound, 0.5)).toBe(false);
    expect(setVolume).not.toHaveBeenCalled();
  });

  it('clamps and applies volume for a live sound', () => {
    const setVolume = vi.fn();
    const sound = {
      currentConfig: {},
      pendingRemove: false,
      setVolume,
      volumeNode: { gain: {} },
    } as unknown as Phaser.Sound.BaseSound;

    expect(volumeSetter(createManager())(sound, 2)).toBe(true);
    expect(setVolume).toHaveBeenCalledWith(1);
  });

  it('defaults to muted on local development hosts when no setting is saved', () => {
    vi.stubGlobal('location', { hostname: 'localhost' });

    expect(createManager().muted).toBe(true);
  });

  it('uses saved mute preference over local development default', () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' });
    localStorageGetItem.mockReturnValue(JSON.stringify({ muted: false }));

    expect(createManager().muted).toBe(false);
  });
});
