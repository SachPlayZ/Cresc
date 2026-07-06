"use client";

import { useState, useEffect, useRef } from "react";
import { useCookies } from "react-cookie";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { fromDisplay } from "../lib/money";

// Deliberately narrow — never accept the full Creator row here. This is a client
// component, so any prop passed to it gets serialized into the page payload sent to
// the browser; the full row carries ghost_webhook_secret / ghost_key_enc.
type WithdrawCreator = { id: string; eoa_address: string | null };

const CIRCLE_APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID ?? "";

type Status = 'idle' | 'auth' | 'signing' | 'submitting' | 'done' | 'error';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function WithdrawSection({ creator }: { creator: WithdrawCreator }) {
  const sdkRef = useRef<W3SSdk | null>(null);
  const [cookies, setCookie] = useCookies([
    'circle_device_token', 'circle_device_enc_key',
    'circle_user_token', 'circle_enc_key',
  ]);

  const userToken = cookies.circle_user_token as string | undefined;
  const encKey = cookies.circle_enc_key as string | undefined;
  const deviceToken = cookies.circle_device_token as string | undefined;
  const deviceEncKey = cookies.circle_device_enc_key as string | undefined;

  const [amount, setAmount] = useState("");
  const [contentContract, setContentContract] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [status, setStatus] = useState<Status>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const creatorId = creator.id;

  useEffect(() => {
    if (!CIRCLE_APP_ID) return;
    const onLoginComplete = (err: unknown, res: unknown) => {
      if (err) { setErrorMsg("Re-auth failed: " + describeError(err)); setStatus('error'); return; }
      const { userToken: ut, encryptionKey: ek } = res as { userToken: string; encryptionKey: string };
      setCookie('circle_user_token', ut, { path: '/' });
      setCookie('circle_enc_key', ek, { path: '/' });
      setStatus('idle');
    };
    const init = async () => {
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const sdk = new W3SSdk(
        {
          appSettings: { appId: CIRCLE_APP_ID },
          loginConfigs: {
            deviceToken: deviceToken ?? '',
            deviceEncryptionKey: deviceEncKey ?? '',
            google: { clientId: GOOGLE_CLIENT_ID, redirectUri: `${window.location.origin}/dashboard`, selectAccountPrompt: true },
          },
        },
        onLoginComplete
      );
      sdkRef.current = sdk;
      await sdk.getDeviceId();
    };
    void init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!amount || !destAddress || !creatorId) {
      setErrorMsg("Amount, destination address, and creator ID required.");
      return;
    }

    let amountAtomic: string;
    try {
      const parsed = fromDisplay(amount, 6);
      if (parsed.value <= 0n) throw new Error("amount must be positive");
      amountAtomic = parsed.value.toString();
    } catch {
      setErrorMsg("Invalid amount.");
      return;
    }

    // Re-auth if no session
    if (!userToken || !encKey) {
      setStatus('auth');
      sdkRef.current?.performLogin('Google' as Parameters<W3SSdk['performLogin']>[0]);
      return;
    }

    setStatus('signing');
    try {
      // Step 1: get a signTypedData challenge for the EIP-712 Withdraw message
      // (creator's own UCW wallet authorizes exactly this to/amount/nonce — see
      // contracts/src/ContentVault.sol withdrawSigned).
      const signReqRes = await fetch('/api/withdraw/sign-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: creatorId,
          userToken,
          amount_atomic: amountAtomic,
          content_contract: contentContract,
          destination_address: destAddress,
        }),
      });
      const signReq = await signReqRes.json() as { challengeId?: string; nonce?: string; error?: string };
      if (!signReqRes.ok || !signReq.challengeId || !signReq.nonce) {
        throw new Error(signReq.error ?? 'Failed to prepare signature request');
      }

      const sdk = sdkRef.current;
      if (!sdk) throw new Error('SDK not initialized');
      sdk.setAuthentication({ userToken, encryptionKey: encKey });

      const signature = await new Promise<string>((resolve, reject) => {
        sdk.execute(signReq.challengeId!, (err, result) => {
          if (err) { reject(new Error('Signing failed: ' + String(err))); return; }
          const sig = (result as { signature?: string } | undefined)?.signature;
          if (!sig) { reject(new Error('No signature returned')); return; }
          resolve(sig);
        });
      });

      setStatus('submitting');
      const prepRes = await fetch('/api/withdraw/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_id: creatorId,
          userToken,
          amount_atomic: amountAtomic,
          content_contract: contentContract,
          destination_address: destAddress,
          nonce: signReq.nonce,
          signature,
        }),
      });
      const prep = await prepRes.json() as {
        status?: string;
        txHash?: string;
        withdrawalId?: string | null;
        error?: string;
      };
      if (!prepRes.ok || prep.error) throw new Error(prep.error ?? 'Prepare failed');
      setTxHash(prep.txHash!);
      setStatus('done');
    } catch (e) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }

  if (!creator.eoa_address) return null;

  return (
    <div className="rounded-xl border px-6 py-5 space-y-4"
      style={{ border: '1px solid var(--c-border)', background: 'var(--c-surface)' }}>
      <div className="font-semibold text-sm">Withdraw earnings</div>
      <div className="font-mono text-xs text-muted-foreground">
        Wallet: {creator.eoa_address.slice(0, 10)}…{creator.eoa_address.slice(-6)}
      </div>

      {status === 'done' && txHash ? (
        <div className="font-mono text-xs px-3 py-2 rounded-lg"
          style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}>
          ✓ Withdrawn — tx: {txHash.slice(0, 18)}…
        </div>
      ) : (
        <form onSubmit={handleWithdraw} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="font-mono text-xs text-muted-foreground block mb-1">Amount (USDC)</label>
              <Input placeholder="0.10" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="h-9 text-sm font-mono" />
            </div>
            <div className="flex-1">
              <label className="font-mono text-xs text-muted-foreground block mb-1">Content contract</label>
              <Input placeholder="0x…" value={contentContract} onChange={(e) => setContentContract(e.target.value)}
                className="h-9 text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="font-mono text-xs text-muted-foreground block mb-1">Destination address</label>
            <Input placeholder="0x…" value={destAddress} onChange={(e) => setDestAddress(e.target.value)}
              className="h-9 text-sm font-mono" />
          </div>
          {errorMsg && (
            <div className="font-mono text-xs px-3 py-2 rounded-lg"
              style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
              {errorMsg}
            </div>
          )}
          <Button type="submit" size="sm" className="h-9 text-xs font-mono"
            disabled={status === 'signing' || status === 'submitting' || status === 'auth'}>
            {status === 'auth' ? 'Sign in with Google…' :
             status === 'signing' ? 'Approve in Circle UI…' :
             status === 'submitting' ? 'Submitting…' :
             'Withdraw →'}
          </Button>
        </form>
      )}
    </div>
  );
}
