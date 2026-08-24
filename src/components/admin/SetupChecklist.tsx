'use client';

import Link from 'next/link';
import { CheckCircle2, CircleAlert, Loader2, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';

type CheckState = 'ready' | 'missing' | 'checking';

interface ChecklistState {
  database: CheckState;
  realtime: CheckState;
  amazon: CheckState;
}

export function SetupChecklist() {
  const [checks, setChecks] = useState<ChecklistState>({
    database: 'checking',
    realtime: 'checking',
    amazon: 'checking',
  });

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all([
      fetch('/api/health', { signal: controller.signal }).then((response) => response.json()),
      fetch('/api/admin/amazon-status', { signal: controller.signal }).then((response) => response.json()),
    ])
      .then(([health, amazon]) => {
        const databaseReady = Boolean(health?.configured?.supabase);
        setChecks({
          database: databaseReady ? 'ready' : 'missing',
          realtime: databaseReady ? 'ready' : 'missing',
          amazon: amazon?.configured ? 'ready' : 'missing',
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setChecks({ database: 'missing', realtime: 'missing', amazon: 'missing' });
        }
      });

    return () => controller.abort();
  }, []);

  const rows = [
    ['Database', checks.database],
    ['Authentication', checks.database === 'ready' ? 'ready' : 'missing'],
    ['Admin account', 'ready' as CheckState],
    ['Realtime', checks.realtime],
    ['Amazon credentials', checks.amazon],
    ['Scanner', 'ready' as CheckState],
  ] as const;

  return (
    <section className="card card--elevated setup-checklist" aria-labelledby="setup-checklist-title">
      <div className="row row--between">
        <div className="row" style={{ gap: 8 }}>
          <Settings2 size={18} color="var(--color-primary)" />
          <div>
            <h2 id="setup-checklist-title" className="text-base font-bold">REYO PACK SETUP</h2>
            <p className="text-xs text-muted">One place to see what is ready for operations.</p>
          </div>
        </div>
        {checks.amazon !== 'ready' && (
          <Link className="btn btn--primary btn--sm" href="/admin/amazon">CONFIGURE AMAZON</Link>
        )}
      </div>

      <div className="setup-checklist__grid">
        {rows.map(([label, state]) => (
          <div className="setup-checklist__row" key={label}>
            <span className="text-sm">{label}</span>
            {state === 'checking' ? (
              <span className="text-xs text-muted row"><Loader2 size={13} className="spin" /> Checking…</span>
            ) : state === 'ready' ? (
              <span className="text-xs text-success row"><CheckCircle2 size={14} /> Ready</span>
            ) : (
              <span className="text-xs text-warning row"><CircleAlert size={14} /> Setup needed</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
