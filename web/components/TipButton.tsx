"use client";

import { useState } from "react";

interface TipButtonProps {
  creatorId: string;
  contentContract: string;
  creatorName: string;
  defaultAmountAtomic: string; // suggested tip = 50% of article price
}

const PRESET_AMOUNTS = [
  { label: "$0.01", atomic: "10000" },
  { label: "$0.05", atomic: "50000" },
  { label: "$0.10", atomic: "100000" },
];

export function TipButton({ creatorId, contentContract, creatorName, defaultAmountAtomic }: TipButtonProps) {
  const [state, setState] = useState<'idle' | 'paying' | 'paid' | 'declined' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(
    PRESET_AMOUNTS.find((p) => BigInt(p.atomic) >= BigInt(defaultAmountAtomic))?.atomic ?? PRESET_AMOUNTS[1].atomic
  );

  function getReaderId(): string {
    if (typeof localStorage === 'undefined') return 'anon';
    const key = 'cresc_reader_id';
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
  }

  async function sendTip() {
    setState('paying');
    try {
      const res = await fetch('/api/tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reader_id: getReaderId(),
          creator_id: creatorId,
          content_contract: contentContract,
          amount_atomic: selected,
        }),
      });
      const data = await res.json() as { decision?: string; reason?: string; error?: string };

      if (data.decision === 'paid') {
        setState('paid');
        return;
      }
      if (data.decision === 'declined') {
        setState('declined');
        setMessage(data.reason ?? 'Budget limit reached');
        return;
      }
      setState('error');
      setMessage(data.error ?? 'Tip failed');
    } catch (err) {
      setState('error');
      setMessage(String(err));
    }
  }

  if (state === 'paid') {
    return (
      <div className="text-center py-3 text-sm font-mono" style={{ color: 'var(--c-accent)' }}>
        Tip settled on Arc ✓
      </div>
    );
  }

  if (state === 'declined' || state === 'error') {
    return (
      <div className="text-center text-xs font-mono py-2" style={{ color: '#e08a8a' }}>
        {state === 'declined' ? `Declined: ${message}` : `Error: ${message}`}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 pt-2">
      <p className="text-xs text-muted-foreground">
        Enjoyed this? Send {creatorName} a tip.
      </p>
      <div className="flex gap-2">
        {PRESET_AMOUNTS.map((p) => (
          <button
            key={p.atomic}
            onClick={() => setSelected(p.atomic)}
            className="px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors"
            style={{
              background: selected === p.atomic ? 'var(--c-accent)' : 'var(--c-surface)',
              color: selected === p.atomic ? '#fff' : 'var(--c-text)',
              border: '1px solid var(--c-border)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        onClick={sendTip}
        disabled={state === 'paying'}
        className="h-10 px-6 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: '#0f172a', color: '#fff' }}
      >
        {state === 'paying' ? 'Settling…' : 'Send tip →'}
      </button>
    </div>
  );
}
