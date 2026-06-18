"use client";

import { useState } from "react";
import { Button } from "./ui/button";

// USDC ERC-20 on Arc Testnet (public constant — not a secret)
const USDC_ARC = "0x3600000000000000000000000000000000000000";
// Suggested deposit: $0.10 = 100_000 base units (6 dec)
const SUGGESTED_AMOUNT_BASE = 100_000;

interface DepositPromptProps {
  address: string;
  onFunded: () => void;
}

export function DepositPrompt({ address, onFunded }: DepositPromptProps) {
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  // EIP-681 URI: MetaMask intercepts this and pre-fills the ERC-20 transfer.
  const metaMaskUri = `ethereum:${USDC_ARC}/transfer?address=${address}&uint256=${SUGGESTED_AMOUNT_BASE}`;

  async function copyAddress() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function checkBalance() {
    setChecking(true);
    setStatus(null);
    try {
      const res = await fetch("/api/reader/balance");
      if (!res.ok) throw new Error("balance check failed");
      const data = await res.json() as { gatewayFunded: boolean; onChain: string; spendable: string };
      if (data.gatewayFunded) {
        onFunded();
        return;
      }
      if (parseFloat(data.onChain) > 0) {
        setStatus("USDC arrived — depositing into Gateway… check again in a moment.");
      } else {
        setStatus("No USDC detected yet. Send to the address above and try again.");
      }
    } catch {
      setStatus("Could not check balance. Try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div>
        <p className="font-semibold text-sm mb-1" style={{ color: "var(--c-fg)" }}>
          Fund your reading wallet
        </p>
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>
          Send USDC once — pay for any article without MetaMask popups.
        </p>
      </div>

      <div
        className="rounded-xl p-3 flex flex-col gap-2"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>Send USDC to</p>
        <div className="flex items-center gap-2">
          <code
            className="font-mono text-xs flex-1 truncate"
            style={{ color: "var(--c-fg)" }}
          >
            {short}
          </code>
          <button
            onClick={copyAddress}
            className="text-xs px-2 py-1 rounded-md transition-colors"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: copied ? "var(--c-green)" : "var(--c-muted)",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <a
            href={metaMaskUri}
            className="text-xs px-2 py-1 rounded-md no-underline transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--c-muted)" }}
            title="Open in MetaMask (desktop/mobile)"
          >
            MetaMask ↗
          </a>
        </div>
      </div>

      <ul className="text-xs flex flex-col gap-1" style={{ color: "var(--c-muted)" }}>
        <li>
          Get testnet USDC →{" "}
          <a
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: "var(--c-accent)" }}
          >
            faucet.circle.com
          </a>{" "}
          (select Arc Testnet)
        </li>
        <li>$0.10 suggested — covers ~10–100 reads</li>
      </ul>

      {status && (
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>
          {status}
        </p>
      )}

      <Button
        onClick={checkBalance}
        disabled={checking}
        variant="outline"
        size="sm"
        className="self-start"
      >
        {checking ? "Checking…" : "I've sent it — check balance"}
      </Button>
    </div>
  );
}
