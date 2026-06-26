import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Ghost Setup Guide — Cresc",
  description: "How creators connect Ghost to Cresc with Circle User Controlled Wallets, webhooks, and Code Injection.",
};

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://your-cresc-domain.com").replace(/\/$/, "");
const SNIPPET = `<script src="${APP_URL}/cresc-ghost.js" data-site="YOUR_CREATOR_ID"></script>`;
const WEBHOOK_URL = `${APP_URL}/api/ghost/sync?site=YOUR_CREATOR_ID`;

export default function GhostDocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground pb-20">
      <nav
        className="flex items-center justify-between px-6 sm:px-10 py-4 border-b"
        style={{ borderColor: "var(--c-border-soft)" }}
      >
        <Link
          href="/"
          className="font-heading font-bold text-lg tracking-tight text-foreground no-underline flex items-center gap-2"
          style={{ letterSpacing: "-0.03em" }}
        >
          <img src="/cresc-logo-transparent.png" alt="Cresc" style={{ width: 18, height: 18 }} />
          Cresc
        </Link>
        <Link href="/ghost-onboard" className="font-mono text-xs text-muted-foreground no-underline">
          Start setup
        </Link>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-14">
        <div
          className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-full border mb-6"
          style={{ color: "var(--c-violet)", background: "var(--c-surface)", border: "1px solid var(--c-border)" }}
        >
          <span className="inline-block w-1 h-1 rounded-full" style={{ background: "var(--c-accent)" }} />
          Creator Guide
        </div>

        <h1 className="font-heading font-bold text-4xl mb-3" style={{ letterSpacing: "-0.04em" }}>
          Connect Ghost to Cresc
        </h1>
        <p className="text-muted-foreground text-base leading-7 mb-10">
          This is the creator checklist for logging in, finding the Ghost details Cresc needs,
          adding the webhook, and pasting the paywall snippet into Ghost Code Injection.
        </p>

        <section className="space-y-4 mb-10">
          <Step n={1} title="Create your Cresc wallet">
            <p>
              Go to <Link href="/ghost-onboard" className="text-foreground underline">/ghost-onboard</Link>,
              enter your display name, then create your Circle User Controlled Wallet. Sign in with Google
              and approve the Circle wallet challenge. This wallet is where creator payments are received.
            </p>
          </Step>

          <Step n={2} title="Find your Ghost Admin API key">
            <p>
              In Ghost Admin, open <strong>Settings</strong>, then <strong>Integrations</strong>,
              then <strong>Add custom integration</strong>. Name it Cresc and copy the
              <strong> Admin API Key</strong>. It looks like <code>id:secret</code>.
            </p>
            <p>
              Paste your Ghost site URL and Admin API Key into the final step of Cresc onboarding.
              Cresc validates the key, syncs existing posts, and returns the webhook secret plus
              your exact Code Injection line.
            </p>
          </Step>

          <Step n={3} title="Add the Ghost webhook">
            <p>
              In Ghost Admin, open <strong>Settings</strong>, then <strong>Webhooks</strong>,
              then <strong>Add webhook</strong>. Add three post webhooks if your Ghost UI asks for
              one event per webhook: <strong>Post published</strong>, <strong>Post updated</strong>,
              and <strong>Post deleted</strong>.
            </p>
            <CodeBlock value={WEBHOOK_URL} />
            <p>
              Use the webhook secret shown by Cresc after onboarding. Do not invent this value;
              the generated secret is how Cresc verifies the webhook came from your Ghost site.
            </p>
          </Step>

          <Step n={4} title="Paste the Code Injection line">
            <p>
              In Ghost Admin, open <strong>Settings</strong>, then <strong>Code Injection</strong>,
              then paste the Cresc script into <strong>Site Footer</strong>. The generated line looks like this:
            </p>
            <CodeBlock value={SNIPPET} />
            <p>
              Replace <code>YOUR_CREATOR_ID</code> only if you are setting this up manually.
              The onboarding screen gives you the exact line with your real creator ID already filled in.
            </p>
          </Step>

          <Step n={5} title="Publish or update a post">
            <p>
              Publish a Ghost post or update an existing one. The webhook syncs it into Cresc,
              sets the starting price, and the injected script adds the unlock button on the Ghost page.
            </p>
          </Step>
        </section>

        <div
          className="rounded-lg border px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}
        >
          <div>
            <div className="font-heading font-semibold text-sm mb-1">Ready to connect?</div>
            <div className="text-muted-foreground text-sm">The setup flow will generate your real webhook URL and script tag.</div>
          </div>
          <Link
            href="/ghost-onboard"
            className="font-sans font-semibold text-sm px-5 py-2.5 rounded-lg text-center no-underline"
            style={{ background: "var(--c-accent)", color: "var(--c-accent-ink)" }}
          >
            Start Ghost setup
          </Link>
        </div>
      </div>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-5" style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}>
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full font-mono text-xs font-bold shrink-0"
          style={{ background: "var(--c-accent)", color: "var(--c-accent-ink)" }}
        >
          {n}
        </span>
        <h2 className="font-heading font-semibold text-base m-0">{title}</h2>
      </div>
      <div className="text-sm leading-7 text-muted-foreground space-y-3">{children}</div>
    </div>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <pre
      className="font-mono text-xs whitespace-pre-wrap break-all rounded-md p-3 my-3"
      style={{ color: "var(--c-accent)", background: "var(--c-surface-hi)", border: "1px solid var(--c-border)" }}
    >
      {value}
    </pre>
  );
}
