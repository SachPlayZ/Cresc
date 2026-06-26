"use client";

import { useState, useTransition } from "react";

interface GhostUnlockButtonProps {
  slug: string;
  site: string;
  priceDisplay: string;
}

export function GhostUnlockButton({ slug, site, priceDisplay }: GhostUnlockButtonProps) {
  const [state, setState] = useState<'idle' | 'paying' | 'declined' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [, startTransition] = useTransition();

  function getReaderId(): string {
    if (typeof localStorage === 'undefined') return crypto.randomUUID();
    const key = 'cresc_reader_id';
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
  }

  function pay() {
    setState('paying');
    startTransition(async () => {
      try {
        const readerId = getReaderId();
        const requestId = crypto.randomUUID();
        const res = await fetch(`/api/unlock/${encodeURIComponent(slug)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reader_id: readerId, request_id: requestId }),
        });
        const data = await res.json() as {
          decision?: string; unlock_token?: string; reason?: string; error?: string;
        };

        if (data.decision === 'paid' && data.unlock_token) {
          window.location.href =
            `/read?slug=${encodeURIComponent(slug)}&site=${encodeURIComponent(site)}&unlock_token=${encodeURIComponent(data.unlock_token)}`;
          return;
        }
        if (data.decision === 'declined') {
          setState('declined');
          setMessage(data.reason ?? 'Declined by Reader Agent');
          return;
        }
        setState('error');
        setMessage(data.error ?? 'Payment failed');
      } catch (err) {
        setState('error');
        setMessage(String(err));
      }
    });
  }

  if (state === 'paying') {
    return (
      <button disabled className="inline-flex items-center gap-2 h-12 px-8 rounded-xl font-bold text-sm" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-accent)' }}>
        <Spinner />
        Settling {priceDisplay} on Arc…
      </button>
    );
  }

  if (state === 'declined' || state === 'error') {
    return (
      <div className="flex flex-col gap-3 items-center">
        <div className="text-sm font-mono px-4 py-2 rounded-lg" style={{ background: 'rgba(224,138,138,0.07)', border: '1px solid rgba(224,138,138,0.2)', color: '#e08a8a' }}>
          {state === 'declined' ? `Declined: ${message}` : `Error: ${message}`}
        </div>
        <button onClick={pay} className="h-12 px-8 rounded-xl font-bold text-sm" style={{ background: '#0f172a', color: '#fff' }}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={pay}
      className="h-12 px-8 rounded-xl font-bold text-sm transition-opacity hover:opacity-90"
      style={{ background: '#0f172a', color: '#fff' }}
    >
      Pay {priceDisplay} &amp; Read →
    </button>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
