"use client";

import { useState, useRef, useEffect } from "react";
import { useCookies } from "react-cookie";
import { Button } from "@/components/ui/button";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { showTxConfirmedToast } from "../lib/toast-tx";

// Deliberately narrow — never accept the full Creator row here. This is a client
// component, so any prop passed to it gets serialized into the page payload sent to
// the browser; the full row carries ghost_webhook_secret / ghost_key_enc.
type WithdrawCreator = { id: string; eoa_address: string | null };

const CIRCLE_APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID ?? "";

type Status = 'idle' | 'auth' | 'withdrawing' | 'done' | 'error';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

interface WithdrawSectionProps {
  creator: WithdrawCreator;
  /** Every active content_contract this creator owns — one vault per piece of content. */
  contentContracts: string[];
}

export function WithdrawSection({ creator, contentContracts }: WithdrawSectionProps) {
  const sdkRef = useRef<W3SSdk | null>(null);
  const [cookies, setCookie] = useCookies([
    'circle_device_token', 'circle_device_enc_key',
    'circle_user_token', 'circle_enc_key',
  ]);

  const userToken = cookies.circle_user_token as string | undefined;
  const encKey = cookies.circle_enc_key as string | undefined;
  const deviceToken = cookies.circle_device_token as string | undefined;
  const deviceEncKey = cookies.circle_device_enc_key as string | undefined;

  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [txHashes, setTxHashes] = useState<string[]>([]);
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

  async function withdrawOneVault(contentContract: string): Promise<{ skipped: boolean; txHash?: string }> {
    const signReqRes = await fetch('/api/withdraw/sign-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator_id: creatorId, userToken, content_contract: contentContract }),
    });
    const signReq = await signReqRes.json() as {
      challengeId?: string; nonce?: string; amount_atomic?: string; destination_address?: string;
      skipped?: boolean; error?: string;
    };
    if (signReq.skipped) return { skipped: true };
    if (!signReqRes.ok || !signReq.challengeId || !signReq.nonce || !signReq.amount_atomic) {
      throw new Error(signReq.error ?? `Failed to prepare signature for ${contentContract}`);
    }

    const sdk = sdkRef.current;
    if (!sdk) throw new Error('SDK not initialized');
    sdk.setAuthentication({ userToken: userToken!, encryptionKey: encKey! });

    const signature = await new Promise<string>((resolve, reject) => {
      sdk.execute(signReq.challengeId!, (err, result) => {
        if (err) { reject(new Error('Signing failed: ' + String(err))); return; }
        const sig = (result as { signature?: string } | undefined)?.signature;
        if (!sig) { reject(new Error('No signature returned')); return; }
        resolve(sig);
      });
    });

    const prepRes = await fetch('/api/withdraw/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator_id: creatorId,
        userToken,
        content_contract: contentContract,
        amount_atomic: signReq.amount_atomic,
        nonce: signReq.nonce,
        signature,
      }),
    });
    const prep = await prepRes.json() as { txHash?: string; error?: string };
    if (!prepRes.ok || !prep.txHash) throw new Error(prep.error ?? `Withdraw failed for ${contentContract}`);

    showTxConfirmedToast(signReq.amount_atomic, prep.txHash);
    return { skipped: false, txHash: prep.txHash };
  }

  async function handleWithdrawAll() {
    setErrorMsg(null);

    if (contentContracts.length === 0) return;

    // Re-auth if no session
    if (!userToken || !encKey) {
      setStatus('auth');
      sdkRef.current?.performLogin('Google' as Parameters<W3SSdk['performLogin']>[0]);
      return;
    }

    setStatus('withdrawing');
    setProgress({ done: 0, total: contentContracts.length });
    const hashes: string[] = [];
    try {
      for (let i = 0; i < contentContracts.length; i++) {
        const result = await withdrawOneVault(contentContracts[i]);
        if (result.txHash) hashes.push(result.txHash);
        setProgress({ done: i + 1, total: contentContracts.length });
      }
      setTxHashes(hashes);
      setStatus('done');
    } catch (e) {
      setTxHashes(hashes);
      setErrorMsg(describeError(e));
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

      {status === 'done' ? (
        <div className="font-mono text-xs px-3 py-2 rounded-lg"
          style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}>
          {txHashes.length === 0
            ? '✓ Nothing to withdraw — every vault is empty'
            : `✓ Withdrew from ${txHashes.length} vault${txHashes.length !== 1 ? 's' : ''} → ${creator.eoa_address.slice(0, 10)}…`}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {errorMsg && (
            <div className="font-mono text-xs px-3 py-2 rounded-lg"
              style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
              {errorMsg}
            </div>
          )}
          <Button
            onClick={handleWithdrawAll}
            size="sm"
            className="h-9 text-xs font-mono w-fit"
            disabled={status === 'withdrawing' || status === 'auth' || contentContracts.length === 0}
          >
            {status === 'auth' ? 'Sign in with Google…' :
             status === 'withdrawing' ? `Withdrawing ${progress?.done ?? 0}/${progress?.total ?? contentContracts.length}…` :
             contentContracts.length === 0 ? 'No content yet' :
             'Withdraw all earnings →'}
          </Button>
        </div>
      )}
    </div>
  );
}
