'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { invokeSupabaseFunction } from '@/lib/supabase/edge';

export default function BootstrapAdminPage() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const { response, data: payload } = await invokeSupabaseFunction<{ message?: string; error?: string }>('bootstrap-admin');
      if (!response.ok) throw new Error(payload.error || 'First-admin setup could not be completed.');
      setMessage(payload.message || 'Administrator access is ready.');
      window.setTimeout(() => router.replace('/admin'), 500);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'First-admin setup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="card stack" style={{ width: '100%', maxWidth: 440, padding: 32 }}>
        <div className="text-center">
          <ShieldCheck size={32} color="var(--color-primary)" />
          <h1 className="text-2xl font-extrabold mt-2">First administrator setup</h1>
          <p className="text-sm text-secondary mt-1">
            The first signed-in account can claim administrator access once. Existing administrators remain protected.
          </p>
        </div>

        {error && <div className="card--error p-3 text-sm" role="alert">{error}</div>}
        {message && <div className="card--success p-3 text-sm" role="status">{message}</div>}

        <form className="stack" onSubmit={handleSubmit}>
          <button className="btn btn--primary btn--full btn--lg" type="submit" disabled={loading}>
            {loading ? <><Loader2 size={18} className="spin" /> Checking setup…</> : <><KeyRound size={18} /> Make me Admin</>}
          </button>
        </form>

        <div className="text-xs text-muted text-center">
          This works only while no administrator exists. Supabase enforces the one-time rule transactionally.
        </div>
        <Link href="/login?redirectTo=/bootstrap-admin" className="btn btn--ghost btn--full">Sign in first</Link>
      </div>
    </main>
  );
}
