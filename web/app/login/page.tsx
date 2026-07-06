"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCookies } from "react-cookie";
import { Button } from "@/components/ui/button";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const CIRCLE_APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID ?? "";

type Status = "idle" | "loading" | "not-found" | "error";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default function LoginPage() {
  const router = useRouter();
  const sdkRef = useRef<W3SSdk | null>(null);
  const [cookies, setCookie] = useCookies([
    "circle_device_id", "circle_device_token", "circle_device_enc_key",
  ]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const deviceId = cookies.circle_device_id as string | undefined;
  const deviceToken = cookies.circle_device_token as string | undefined;
  const deviceEncKey = cookies.circle_device_enc_key as string | undefined;

  // SDK is constructed unconditionally on mount (not gated on a wizard step) so it's
  // ready to catch the OAuth response the moment Google redirects back to /login.
  useEffect(() => {
    let cancelled = false;

    const initSdk = async () => {
      try {
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");

        const onLoginComplete = async (err: unknown, res: unknown) => {
          if (cancelled) return;
          if (err) { setError("Google login failed: " + describeError(err)); setStatus("error"); return; }
          const { userToken } = res as { userToken: string; encryptionKey: string };
          setStatus("loading");
          try {
            const loginRes = await fetch("/api/creator/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userToken }),
            });
            const data = await loginRes.json() as {
              creator?: { id: string; eoa_address?: string | null };
              error?: string;
            };
            if (!loginRes.ok || !data.creator) {
              setStatus("not-found");
              return;
            }
            localStorage.setItem("cresc_creator_id", data.creator.id);
            if (data.creator.eoa_address) {
              localStorage.setItem("cresc_ucw_wallet", data.creator.eoa_address);
            }
            router.push("/dashboard");
          } catch (e) {
            setError(describeError(e));
            setStatus("error");
          }
        };

        const sdk = new W3SSdk(
          {
            appSettings: { appId: CIRCLE_APP_ID },
            loginConfigs: {
              deviceToken: deviceToken ?? "",
              deviceEncryptionKey: deviceEncKey ?? "",
              google: { clientId: GOOGLE_CLIENT_ID, redirectUri: `${window.location.origin}/login`, selectAccountPrompt: true },
            },
          },
          onLoginComplete
        );
        sdkRef.current = sdk;

        if (!deviceId) {
          const id = await sdk.getDeviceId();
          setCookie("circle_device_id", id, { path: "/" });
        }
      } catch (e) {
        if (!cancelled) { setError("W3S SDK init failed: " + describeError(e)); setStatus("error"); }
      }
    };

    void initSdk();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLoginClick() {
    setError(null);
    setStatus("loading");
    try {
      let dt = deviceToken;
      let dek = deviceEncKey;
      if (!dt || !dek) {
        if (!deviceId) { setError("Still initializing — try again in a moment."); setStatus("idle"); return; }
        const res = await fetch("/api/ucw/device-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId }),
        });
        const data = await res.json() as { deviceToken?: string; deviceEncryptionKey?: string; error?: string };
        if (!res.ok || !data.deviceToken || !data.deviceEncryptionKey) {
          setError(data.error ?? "Failed to prepare login"); setStatus("error"); return;
        }
        dt = data.deviceToken;
        dek = data.deviceEncryptionKey;
        setCookie("circle_device_token", dt, { path: "/" });
        setCookie("circle_device_enc_key", dek, { path: "/" });
      }

      const sdk = sdkRef.current;
      if (!sdk) { setError("SDK not ready — try again in a moment."); setStatus("idle"); return; }
      sdk.updateConfigs({
        appSettings: { appId: CIRCLE_APP_ID },
        loginConfigs: {
          deviceToken: dt,
          deviceEncryptionKey: dek,
          google: { clientId: GOOGLE_CLIENT_ID, redirectUri: `${window.location.origin}/login`, selectAccountPrompt: true },
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdk.performLogin("Google" as Parameters<W3SSdk["performLogin"]>[0]);
    } catch (e) {
      setError(describeError(e));
      setStatus("error");
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground pb-20">
      <nav className="flex items-center justify-between px-10 py-4.5 border-b" style={{ borderColor: "var(--c-border-soft)" }}>
        <Link href="/" className="font-heading font-bold text-lg tracking-tight" style={{ letterSpacing: "-0.03em" }}>
          Cresc
        </Link>
      </nav>

      <div className="max-w-xl mx-auto px-6 pt-16">
        <div className="flex gap-1 mb-8 p-1 rounded-xl w-fit"
          style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
          <span className="px-4 py-1.5 rounded-lg text-sm font-semibold"
            style={{ background: "var(--c-accent)", color: "#fff" }}>
            Log in
          </span>
          <Link href="/ghost-onboard" className="px-4 py-1.5 rounded-lg text-sm font-semibold no-underline transition-colors"
            style={{ color: "var(--c-muted)" }}>
            Join as Creator
          </Link>
        </div>
        <h1 className="font-heading font-bold text-3xl mb-2" style={{ letterSpacing: "-0.03em" }}>
          Log in
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Sign in with the Google account you used to create your Circle wallet.
        </p>

        {status === "not-found" ? (
          <div className="flex flex-col gap-4">
            <div className="font-sans text-sm px-4 py-3 rounded-xl"
              style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
              No Cresc creator account is linked to this Google account yet.
            </div>
            <Link href="/ghost-onboard"
              className="block font-sans font-semibold text-sm px-6 py-3 rounded-xl text-center transition-opacity"
              style={{ background: "var(--c-accent)", color: "#fff" }}>
              Onboard as a new creator →
            </Link>
          </div>
        ) : (
          <Button
            onClick={handleLoginClick}
            disabled={status === "loading"}
            className="h-11 font-bold text-sm w-full"
          >
            {status === "loading" ? "Signing in…" : "Continue with Google"}
          </Button>
        )}

        {error && (
          <div className="font-mono text-xs px-4 py-3 rounded-xl mt-4"
            style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
