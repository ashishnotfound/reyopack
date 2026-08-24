// src/lib/utils/sound.ts
// Audio feedback utilities for barcode scanning
// Uses Web Audio API — no external dependencies

let audioContext: AudioContext | null = null;
let soundEnabled = true;
const SOUND_PREFERENCE_KEY = 'reyo-pack:sound-enabled';

export function getSoundEnabled(): boolean {
  if (typeof window === 'undefined') return soundEnabled;
  const stored = window.localStorage.getItem(SOUND_PREFERENCE_KEY);
  if (stored !== null) soundEnabled = stored === 'true';
  return soundEnabled;
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, String(enabled));
  } catch {
    // Browser storage may be unavailable; the in-memory setting still works.
  }
}

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.3
): void {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch {
    // Audio not supported or blocked — silently fail
  }
}

export function playSuccessSound(): void {
  // Two ascending tones — success
  playTone(880, 0.1, 'sine', 0.4);
  setTimeout(() => playTone(1320, 0.15, 'sine', 0.3), 110);
}

export function playErrorSound(): void {
  // Low descending buzz — error
  playTone(220, 0.1, 'square', 0.3);
  setTimeout(() => playTone(180, 0.2, 'square', 0.3), 110);
}

export function playWarningSound(): void {
  // Mid-tone double beep — warning (already packed, cancelled)
  playTone(440, 0.1, 'sine', 0.35);
  setTimeout(() => playTone(440, 0.1, 'sine', 0.35), 200);
}

export function playScanSound(): void {
  // Short single beep — scan detected
  playTone(1200, 0.08, 'sine', 0.25);
}
