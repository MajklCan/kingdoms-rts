import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from './audio-manager';
import { parseSettings, shouldDefaultMuted } from './audio-settings';

describe('audio settings', () => {
  it('defaults to muted on local dev hosts only', () => {
    expect(shouldDefaultMuted('localhost')).toBe(true);
    expect(shouldDefaultMuted('127.0.0.1')).toBe(true);
    expect(shouldDefaultMuted('game.localhost')).toBe(true);
    expect(shouldDefaultMuted('kingdoms.example.com')).toBe(false);
    expect(shouldDefaultMuted(undefined)).toBe(false);
  });

  it('migrates the old {masterVolume, muted} shape with every channel at full', () => {
    const s = parseSettings(JSON.stringify({ masterVolume: 0.4, muted: false }), true);
    expect(s).toEqual({ masterVolume: 0.4, muted: false, music: 1, sfx: 1, voices: 1, ambience: 1, ui: 1 });
  });

  it('clamps out-of-range values and ignores junk', () => {
    const s = parseSettings(JSON.stringify({ masterVolume: 3, music: -1, sfx: 'loud', ui: 0.25 }), false);
    expect(s.masterVolume).toBe(1);
    expect(s.music).toBe(0);
    expect(s.sfx).toBe(1);
    expect(s.ui).toBe(0.25);
    expect(s.muted).toBe(false);
  });

  it('uses the dev-host default when nothing is saved', () => {
    expect(parseSettings(null, true).muted).toBe(true);
    expect(parseSettings(null, false).muted).toBe(false);
  });
});

describe('AudioManager without WebAudio', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps and persists every channel, including the UI bus', () => {
    const manager = new AudioManager({} as Phaser.Scene);
    manager.setChannelVolume('ui', 0.3);
    manager.setChannelVolume('music', 0.6);
    manager.setMasterVolume(0.5);
    const saved = JSON.parse(store.get('kingdoms.audio') ?? '{}') as Record<string, number>;
    expect(saved.ui).toBe(0.3);
    expect(saved.music).toBe(0.6);
    expect(saved.masterVolume).toBe(0.5);
    expect(new AudioManager({} as Phaser.Scene).getChannelVolume('ui')).toBe(0.3);
  });

  it('no-ops every playback call instead of throwing', () => {
    const manager = new AudioManager({} as Phaser.Scene);
    manager.setMuted(false);
    expect(manager.play('sword_clash')).toBe(false);
    expect(manager.playVoiceBark('soldier_1', 'select', 4)).toBe('none');
    expect(() => {
      manager.playMenuMusic();
      manager.playBattleMusic({ fadeOut: 1 });
      manager.setAmbience('nature_ambience', 1);
      manager.setGamePaused(true);
      manager.update();
    }).not.toThrow();
    expect(manager.debugSnapshot()).toBeNull();
  });
});
