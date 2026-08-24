// src/lib/utils/vibration.ts
// Haptic feedback via Navigator.vibrate API (Android Chrome)

let vibrationEnabled = true;
const VIBRATION_PREFERENCE_KEY = 'reyo-pack:vibration-enabled';

export function getVibrationEnabled(): boolean {
  if (typeof window === 'undefined') return vibrationEnabled;
  const stored = window.localStorage.getItem(VIBRATION_PREFERENCE_KEY);
  if (stored !== null) vibrationEnabled = stored === 'true';
  return vibrationEnabled;
}

export function setVibrationEnabled(enabled: boolean): void {
  vibrationEnabled = enabled;
  try {
    window.localStorage.setItem(VIBRATION_PREFERENCE_KEY, String(enabled));
  } catch {
    // Browser storage may be unavailable; the in-memory setting still works.
  }
}

function canVibrate(): boolean {
  return vibrationEnabled && typeof navigator !== 'undefined' && 'vibrate' in navigator;
}

export function vibrateSuccess(): void {
  try {
    if (canVibrate()) {
      navigator.vibrate([100, 50, 100]); // two short pulses
    }
  } catch {
    // Vibration not supported — silently fail
  }
}

export function vibrateError(): void {
  try {
    if (canVibrate()) {
      navigator.vibrate([300]); // one long pulse
    }
  } catch {}
}

export function vibrateWarning(): void {
  try {
    if (canVibrate()) {
      navigator.vibrate([150, 100, 150]); // double medium pulse
    }
  } catch {}
}

export function vibrateScan(): void {
  try {
    if (canVibrate()) {
      navigator.vibrate(50); // very short — scan detected
    }
  } catch {}
}
