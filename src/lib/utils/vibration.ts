// src/lib/utils/vibration.ts
// Haptic feedback via Navigator.vibrate API (Android Chrome)

export function vibrateSuccess(): void {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([100, 50, 100]); // two short pulses
    }
  } catch {
    // Vibration not supported — silently fail
  }
}

export function vibrateError(): void {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([300]); // one long pulse
    }
  } catch {}
}

export function vibrateWarning(): void {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([150, 100, 150]); // double medium pulse
    }
  } catch {}
}

export function vibrateScan(): void {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate(50); // very short — scan detected
    }
  } catch {}
}
