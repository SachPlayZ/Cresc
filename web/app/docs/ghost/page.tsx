import type { Metadata } from "next";
import Link from "next/link";
import GhostDocsClient from "./GhostDocsClient";

export const metadata: Metadata = {
  title: "Ghost Setup Guide — Cresc",
  description: "Connect your Ghost publication to Cresc in a few minutes with our step-by-step integration guide.",
};

export default function GhostDocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground pb-20">
      <nav
        className="flex items-center justify-between px-6 sm:px-10 py-4 border-b"
        style={{ borderColor: "var(--c-border-soft)", background: "var(--c-bg)" }}
      >
        <Link
          href="/"
          className="font-heading font-bold text-lg tracking-tight text-foreground no-underline flex items-center gap-2"
          style={{ letterSpacing: "-0.03em" }}
        >
          <img src="/cresc-logo-transparent.png" alt="Cresc" style={{ width: 18, height: 18 }} />
          Cresc
        </Link>
        <Link href="/ghost-onboard" style={{ textDecoration: "none" }}>
          <button className="cresc-btn-outline px-4 py-2 rounded-full text-xs font-semibold border border-border bg-transparent text-foreground hover:bg-muted/30 transition-all cursor-pointer">
            Start Setup
          </button>
        </Link>
      </nav>

      <GhostDocsClient />
    </main>
  );
}
