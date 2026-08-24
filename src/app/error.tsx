'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="container stack" style={{ paddingTop: 48 }}><h1 className="text-2xl font-extrabold">Reyo Pack needs attention</h1><p className="text-secondary">The page failed to load. Your server records were not changed by this screen.</p><button className="btn btn--primary" onClick={() => reset()}>Retry</button></main>;
}
