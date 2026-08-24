'use client';
// src/components/scanner/CameraScanner.tsx
// Real barcode scanner using @zxing/browser + camera feed
// Supports Android Chrome camera — continuous scanning

import { useEffect, useRef, useCallback, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat, Exception } from '@zxing/library';
import { playScanSound } from '@/lib/utils/sound';
import { vibrateScan } from '@/lib/utils/vibration';
import { Camera, CameraOff, RefreshCw } from 'lucide-react';

interface CameraScannerProps {
  onScan: (barcode: string) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  continuous?: boolean;
}

export function CameraScanner({
  onScan,
  onError,
  disabled = false,
  continuous = true,
}: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastScannedRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);
  const scanGenerationRef = useRef(0);
  const startScanningRef = useRef<() => Promise<void>>(async () => undefined);

  const [cameraState, setCameraState] = useState<
    'idle' | 'starting' | 'active' | 'error' | 'denied'
  >('idle');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>();

  const handleDecode = useCallback(
    (text: string) => {
      if (disabled) return;

      const now = Date.now();
      // Keep the same label from firing twice while it is still in frame.
      if (
        text === lastScannedRef.current &&
        now - lastScanTimeRef.current < 1500
      ) {
        return;
      }

      lastScannedRef.current = text;
      lastScanTimeRef.current = now;

      playScanSound();
      vibrateScan();
      onScan(text.trim());
    },
    [disabled, onScan]
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isInsecureOrigin, setIsInsecureOrigin] = useState(false);

  const startScanning = useCallback(async () => {
    if (!videoRef.current) return;
    if (disabled) return;

    const generation = ++scanGenerationRef.current;
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraState('starting');
    setErrorMessage(null);
    setIsInsecureOrigin(false);

    // 1. Check W3C Secure Context and MediaDevices API availability
    if (typeof window !== 'undefined') {
      const isSecure = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const hasMediaDevices = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

      if (!isSecure || !hasMediaDevices) {
        setIsInsecureOrigin(true);
        setCameraState('error');
        const msg = `Insecure Origin (${window.location.origin}): Browser security policy blocks camera access on unencrypted HTTP LAN IPs. HTTPS or localhost required.`;
        setErrorMessage(msg);
        onError?.(msg);
        return;
      }
    }

    try {
      // Configure hints for barcode formats common in warehouse/Amazon
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.QR_CODE,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.PDF_417,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.ITF,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess: continuous ? 2000 : 0,
      });
      readerRef.current = reader;

      // Get available cameras
      let videoDevices: MediaDeviceInfo[] = [];
      try {
        videoDevices = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(videoDevices);
      } catch {
        // The browser can still select the environment camera by facingMode.
      }

      // Prefer back/environment camera (for Android warehouse use)
      const backCamera = videoDevices.find(
        (d) =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('environment') ||
          d.label.toLowerCase().includes('rear')
      );

      const deviceId = selectedDeviceId || backCamera?.deviceId;

      const constraints: MediaTrackConstraints = {
        facingMode: deviceId ? undefined : { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      };

      const controls = await reader.decodeFromConstraints(
        { video: constraints },
        videoRef.current,
        (result, error) => {
          if (result) {
            handleDecode(result.getText());
          } else if (error && !(error instanceof Exception)) {
            // Non-ZXing exception
          }
        }
      );

      if (generation !== scanGenerationRef.current || disabled) {
        controls.stop();
        return;
      }

      controlsRef.current = controls;
      setCameraState('active');
    } catch (err: unknown) {
      const error = err as DOMException;
      if (generation !== scanGenerationRef.current) return;

      let detailMsg = error.message || 'Unknown camera error';
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraState('denied');
        detailMsg = 'Camera permission denied. Please allow camera access in browser settings.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setCameraState('error');
        detailMsg = 'No rear camera hardware found on this device.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        setCameraState('error');
        detailMsg = 'Camera hardware is currently in use by another application.';
      } else if (error.name === 'SecurityError') {
        setCameraState('error');
        detailMsg = 'Security error: Camera access blocked by security policy or insecure origin.';
      } else {
        setCameraState('error');
      }

      setErrorMessage(detailMsg);
      onError?.(detailMsg);
    }
  }, [disabled, handleDecode, onError, continuous, selectedDeviceId]);

  const stopScanning = useCallback(() => {
    scanGenerationRef.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraState('idle');
  }, []);

  useEffect(() => {
    startScanningRef.current = startScanning;
  }, [startScanning]);

  useEffect(() => {
    if (!disabled) void startScanningRef.current();
    else {
      const timer = window.setTimeout(stopScanning, 0);
      return () => window.clearTimeout(timer);
    }

    return () => {
      stopScanning();
    };
  }, [disabled, stopScanning]);

  // Restart only when the operator explicitly changes cameras. The previous
  // camera effect also depended on cameraState, so setting it to "active"
  // immediately scheduled another stop/start cycle forever.
  useEffect(() => {
    if (!selectedDeviceId || disabled) return;
    const timer = window.setTimeout(() => {
      stopScanning();
      void startScanningRef.current();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [disabled, selectedDeviceId, stopScanning]);

  return (
    <div className="scanner-viewport" aria-label="Barcode scanner camera">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ display: cameraState === 'active' ? 'block' : 'none' }}
        aria-hidden="true"
      />

      {/* Scanning overlay */}
      {cameraState === 'active' && (
        <div className="scanner-overlay" aria-hidden="true">
          <div className="scanner-reticle">
            <div className="scanner-scan-line" />
          </div>
        </div>
      )}

      {/* Status overlays */}
      {cameraState === 'idle' || cameraState === 'starting' ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: 'var(--text-secondary)',
          }}
        >
          {cameraState === 'starting' ? (
            <>
              <div className="spinner spinner--lg" />
              <span style={{ fontSize: 14 }}>Starting camera…</span>
            </>
          ) : (
            <>
              <Camera size={40} opacity={0.4} />
              <span style={{ fontSize: 14 }}>Camera inactive</span>
            </>
          )}
        </div>
      ) : null}

      {cameraState === 'denied' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <CameraOff size={40} color="var(--color-error)" />
          <p style={{ fontSize: 14, color: 'var(--color-error-text)' }}>
            Camera access denied.
            <br />
            Allow camera in browser settings.
          </p>
        </div>
      )}

      {cameraState === 'error' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: 20,
            textAlign: 'center',
            background: 'var(--bg-card)',
          }}
        >
          <CameraOff size={36} color="var(--color-error)" />
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-error-text)' }}>
            {isInsecureOrigin ? 'Insecure Context (HTTP LAN IP)' : 'Camera Error'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 300, lineHeight: 1.4 }}>
            {errorMessage || 'Unable to access camera feed.'}
          </div>

          {isInsecureOrigin && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                background: 'var(--bg-secondary)',
                padding: '8px 12px',
                borderRadius: 6,
                textAlign: 'left',
                maxWidth: 320,
                lineHeight: 1.4,
              }}
            >
              <strong>Android Chrome Setup:</strong>
              <ol style={{ paddingLeft: 16, margin: '4px 0 0 0' }}>
                <li>Open <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code></li>
                <li>Add <code>{typeof window !== 'undefined' ? window.location.origin : 'http://192.168.1.2:3000'}</code></li>
                <li>Enable flag & Relaunch Chrome</li>
              </ol>
            </div>
          )}

          <button
            className="btn btn--ghost btn--sm mt-1"
            onClick={startScanning}
            aria-label="Retry camera"
          >
            <RefreshCw size={14} /> Retry Camera
          </button>
        </div>
      )}

      {/* Disabled overlay */}
      {disabled && cameraState === 'active' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Scanner paused
          </span>
        </div>
      )}

      {/* Camera switcher (for devices with multiple cameras) */}
      {devices.length > 1 && cameraState === 'active' && (
        <button
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 8,
            padding: '6px 10px',
            color: '#fff',
            fontSize: 12,
            cursor: 'pointer',
          }}
          onClick={() => {
            const currentIdx = devices.findIndex((d) => d.deviceId === selectedDeviceId);
            const nextIdx = (currentIdx + 1) % devices.length;
            setSelectedDeviceId(devices[nextIdx].deviceId);
          }}
          aria-label="Switch camera"
        >
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  );
}
