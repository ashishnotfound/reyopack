'use client';
// src/app/(auth)/login/page.tsx
// Supabase Authentication — Mobile Hardened Login & Registration

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Loader2, LogIn, AlertCircle, UserPlus } from 'lucide-react';
import { notifyError, notifySuccess } from '@/lib/ui/notifications';

function LoginFormContent() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams?.get('redirectTo') || '/scan';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleToggleMode = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setErrorMsg(null);
    setIsSignUp((prev) => !prev);
  };

  const parseAuthError = (err: Error): string => {
    const msg = err.message || '';
    if (msg.includes('Invalid login credentials')) {
      return 'Invalid email or password. Please check your credentials.';
    }
    if (msg.includes('User already registered') || msg.includes('already exists')) {
      return 'An account with this email already exists. Please log in instead.';
    }
    if (msg.includes('Password should be at least')) {
      return 'Password must be at least 6 characters long.';
    }
    if (msg.includes('Email not confirmed')) {
      return 'Email confirmation is required. Please check your inbox.';
    }
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return 'Network unavailable. Please check your internet connection.';
    }
    return msg || 'An unexpected error occurred during authentication.';
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setErrorMsg(null);

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();
    const cleanFullName = fullName.trim();

    if (!cleanEmail || !cleanPassword) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    if (isSignUp && !cleanFullName) {
      setErrorMsg('Please enter your full name.');
      return;
    }

    if (loading) return;
    setLoading(true);

    try {
      const supabase = getSupabaseClient();

      if (isSignUp) {
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: cleanEmail,
          password: cleanPassword,
          options: {
            data: {
              full_name: cleanFullName || cleanEmail.split('@')[0],
            },
          },
        });

        if (signUpErr) throw signUpErr;

        if (signUpData.session) {
          window.location.href = redirectTo;
        } else if (signUpData.user) {
          notifySuccess('Account created. Signing you in…');
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: cleanPassword,
          });

          if (signInErr) {
            notifySuccess('Account registered. Please log in with your credentials.');
            setIsSignUp(false);
          } else {
            window.location.href = redirectTo;
          }
        }
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });

        if (signInErr) throw signInErr;

        window.location.href = redirectTo;
      }
    } catch (err) {
      const friendlyMsg = parseAuthError(err as Error);
      setErrorMsg(friendlyMsg);
      notifyError(friendlyMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card fade-in stack" style={{ width: '100%', maxWidth: 400, padding: 32 }}>
      <div className="text-center mb-2">
        <div
          className="font-extrabold text-2xl mb-1"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          REYO <span style={{ color: 'var(--color-primary)' }}>PACK</span>
        </div>
        <div className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase' }}>
          Fulfillment & Packing System
        </div>
      </div>

      {errorMsg && (
        <div
          className="card--error p-3 row align-center"
          style={{ gap: 10, borderRadius: 8 }}
          role="alert"
        >
          <AlertCircle size={20} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          <div className="text-xs text-error font-semibold" style={{ lineHeight: 1.4 }}>
            {errorMsg}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} action="#" noValidate className="stack">
        {isSignUp && (
          <div className="form-group">
            <label className="form-label" htmlFor="login-name">
              Full Name
            </label>
            <input
              id="login-name"
              name="full_name"
              type="text"
              className="form-input"
              placeholder="e.g. Rahul Sharma"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="login-email">
            Email Address
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            className="form-input"
            placeholder="packer@reyostore.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            className="form-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
          />
        </div>

        <button
          type="submit"
          className="btn btn--primary btn--full btn--lg mt-2"
          disabled={loading}
          id="btn-login-submit"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="spin" /> Authenticating…
            </>
          ) : isSignUp ? (
            <>
              <UserPlus size={18} /> Create Account
            </>
          ) : (
            <>
              <LogIn size={18} /> Log In
            </>
          )}
        </button>
      </form>

      <div className="text-center mt-2">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ border: 'none', cursor: 'pointer' }}
          onClick={handleToggleMode}
          id="btn-toggle-auth-mode"
        >
          {isSignUp ? 'Already have an account? Log In' : 'Need an account? Register'}
        </button>
      </div>
      <Link href="/bootstrap-admin" className="text-xs text-secondary text-center">
        First administrator setup
      </Link>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'var(--bg-primary)',
      }}
    >
      <Suspense
        fallback={
          <div className="card text-center p-6">
            <Loader2 size={24} className="spin text-primary" />
          </div>
        }
      >
        <LoginFormContent />
      </Suspense>
    </div>
  );
}
