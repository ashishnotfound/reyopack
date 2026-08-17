'use client';
// src/components/scanner/ManualEntry.tsx
// Keyboard fallback for barcode entry

import { useState, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';

interface ManualEntryProps {
  onScan: (barcode: string) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
}

export function ManualEntry({
  onScan,
  placeholder = 'Enter AWB / barcode…',
  disabled = false,
  label = 'Manual entry',
}: ManualEntryProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || disabled) return;
      onScan(trimmed);
      setValue('');
      inputRef.current?.focus();
    },
    [value, disabled, onScan]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
      <div className="form-group" style={{ flex: 1 }}>
        <label className="sr-only" htmlFor="manual-barcode">
          {label}
        </label>
        <input
          ref={inputRef}
          id="manual-barcode"
          type="text"
          className="form-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          aria-label={label}
        />
      </div>
      <button
        type="submit"
        className="btn btn--primary"
        disabled={!value.trim() || disabled}
        aria-label="Submit barcode"
      >
        <Search size={18} />
      </button>
    </form>
  );
}
