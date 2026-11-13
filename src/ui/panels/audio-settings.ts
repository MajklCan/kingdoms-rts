/** Audio settings panel (master + per-channel sliders, mute) and the quick-mute button. */

import type { AudioChannel } from '../../render/audio/audio-manager';
import { byId } from '../dom';
import { getScene } from '../game-bridge';

// Per-channel volume sliders in the settings panel (slider id -> channel + % span).
const CHANNEL_SLIDERS: ReadonlyArray<{ id: string; channel: AudioChannel; pct: string }> = [
  { id: 'vol-music', channel: 'music', pct: 'pct-music' },
  { id: 'vol-sfx', channel: 'sfx', pct: 'pct-sfx' },
  { id: 'vol-voices', channel: 'voices', pct: 'pct-voices' },
  { id: 'vol-ambience', channel: 'ambience', pct: 'pct-ambience' },
];

function setPct(spanId: string, fraction: number): void {
  const span = byId(spanId);
  if (span) span.textContent = `${Math.round(fraction * 100)}%`;
}

export function bindAudioSettings(): void {
  const soundBtn = byId<HTMLButtonElement>('sound-toggle');
  const masterSlider = byId<HTMLInputElement>('vol-master');
  const muteCheck = byId<HTMLInputElement>('settings-mute');

  // Sync every audio control (bar button + panel sliders + mute) to the manager.
  const refreshAudioUi = (): boolean => {
    const audio = getScene()?.getAudio();
    if (!audio) return false;
    if (soundBtn) {
      soundBtn.textContent = audio.muted ? 'Muted' : 'Sound';
      soundBtn.setAttribute('aria-pressed', String(audio.muted));
    }
    if (muteCheck) muteCheck.checked = audio.muted;
    if (masterSlider) masterSlider.value = String(Math.round(audio.masterVolume * 100));
    setPct('pct-master', audio.masterVolume);
    for (const { id, channel, pct } of CHANNEL_SLIDERS) {
      const v = audio.getChannelVolume(channel);
      const input = byId<HTMLInputElement>(id);
      if (input) input.value = String(Math.round(v * 100));
      setPct(pct, v);
    }
    return true;
  };

  // The scene boots asynchronously; poll briefly until its AudioManager exists,
  // then sync the controls to the persisted volume/mute/channels.
  let tries = 0;
  const sync = window.setInterval(() => {
    if (refreshAudioUi() || tries++ > 50) window.clearInterval(sync);
  }, 100);

  const applyMute = (muted: boolean): void => {
    const audio = getScene()?.getAudio();
    if (!audio) return;
    audio.setMuted(muted);
    refreshAudioUi();
  };

  soundBtn?.addEventListener('click', () => {
    const audio = getScene()?.getAudio();
    if (audio) applyMute(!audio.muted);
  });
  muteCheck?.addEventListener('change', () => applyMute(!!muteCheck.checked));

  masterSlider?.addEventListener('input', () => {
    const audio = getScene()?.getAudio();
    if (!audio) return;
    const v = Number(masterSlider.value) / 100;
    audio.setMasterVolume(v);
    setPct('pct-master', v);
  });

  for (const { id, channel, pct } of CHANNEL_SLIDERS) {
    const input = byId<HTMLInputElement>(id);
    input?.addEventListener('input', () => {
      const audio = getScene()?.getAudio();
      if (!audio) return;
      const v = Number(input.value) / 100;
      audio.setChannelVolume(channel, v);
      setPct(pct, v);
    });
  }

  // Settings panel open/close (mirrors the tech/mission toggle pattern).
  const panel = byId('settings-panel');
  const settingsToggle = byId<HTMLButtonElement>('settings-toggle');
  const settingsClose = byId<HTMLButtonElement>('settings-close');
  if (panel && settingsToggle && settingsClose) {
    const setOpen = (open: boolean) => {
      panel.classList.toggle('open', open);
      settingsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) refreshAudioUi();
    };
    settingsToggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
    settingsClose.addEventListener('click', () => setOpen(false));
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && panel.classList.contains('open')) setOpen(false);
    });
  }
}
