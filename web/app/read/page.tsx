// app/read/page.tsx — Ghost article paywall gate + post-unlock reader.
// Two modes:
//   1. Pre-unlock: shows price, "Pay & Read" button → calls /api/unlock/[slug] → EC2 agent
//   2. Post-unlock (unlock_token in URL): fetches full Ghost HTML server-side, renders it.
//
// Content is never fetched pre-payment. LLM calls are zero on this path.

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "../../lib/db";
import { GhostAdminClient } from "../../lib/ghost/index";
import { GhostReader } from "../../components/GhostReader";
import { fromBaseUnits, toDisplay } from "../../lib/money";
import { USDC_ERC20_DECIMALS, INTERNAL_HMAC_SECRET } from "../../lib/config";
import { GhostUnlockButton } from "../../components/UnlockButton";
import { TipButton } from "../../components/TipButton";
import { decryptGhostKey } from "../../lib/repo/creators";

function validateUnlockToken(token: string, slug: string): boolean {
  try {
    const parts = token.split(':');
    if (parts.length !== 4) return false;
    const [expiry, tokenSlug, readerId, sig] = parts;
    if (tokenSlug !== slug) return false;
    if (parseInt(expiry, 10) < Math.floor(Date.now() / 1000)) return false;
    const expected = crypto
      .createHmac('sha256', INTERNAL_HMAC_SECRET)
      .update(`${expiry}:${slug}:${readerId}`)
      .digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    slug?: string;
    site?: string;
    unlock_token?: string;
    // Legacy params (pieces-based flow)
    piece?: string;
    session?: string;
  }>;
}

export default async function ReadPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // --- Legacy pieces flow (backward compat) ---
  if (params.piece && params.session) {
    return <LegacyPiecesReader pieceId={params.piece} sessionId={params.session} />;
  }

  const slug = params.slug;
  const site = params.site;   // creatorId

  if (!slug || !site) redirect("/");

  const db = createServerClient();

  // Look up article
  const { data: article } = await db
    .from("articles")
    .select("*, creators!inner(display_name, ghost_admin_key, ghost_key_enc, ghost_instance_url, eoa_address)")
    .eq("slug", slug)
    .eq("creator_id", site)
    .single();

  if (!article) redirect("/");

  const priceDisplay = toDisplay(
    fromBaseUnits(BigInt(article.current_price_atomic as number), USDC_ERC20_DECIMALS)
  );

  // Post-unlock: token present → validate then serve content
  if (params.unlock_token) {
    if (!validateUnlockToken(params.unlock_token, slug)) {
      redirect(`/read?slug=${encodeURIComponent(slug)}&site=${encodeURIComponent(site)}`);
    }

    const creator = article.creators as {
      display_name: string;
      ghost_admin_key: string | null;
      ghost_key_enc: string | null;
      ghost_instance_url: string | null;
      eoa_address: string | null;
    };

    // Decrypt admin key (prefer ghost_key_enc; fall back to plaintext ghost_admin_key for migration)
    let adminKey: string | null = null;
    if (creator.ghost_key_enc) {
      try { adminKey = decryptGhostKey(creator.ghost_key_enc); } catch { adminKey = null; }
    } else {
      adminKey = creator.ghost_admin_key;
    }

    if (!adminKey || !creator.ghost_instance_url || !article.ghost_post_id) {
      return <div className="p-10">Content unavailable.</div>;
    }

    let ghostHtml = "";
    let featureImage: string | null = null;
    try {
      const ghostClient = new GhostAdminClient(
        creator.ghost_instance_url,
        adminKey
      );
      const post = await ghostClient.getPost(article.ghost_post_id as string);
      ghostHtml = post.html ?? "";
      featureImage = post.feature_image ?? null;
    } catch (err) {
      console.error("[read] Ghost content fetch failed:", err);
      ghostHtml = "<p>Content temporarily unavailable. Your payment was recorded.</p>";
    }

    return (
      <main className="min-h-screen bg-background text-foreground pb-24">
        <nav className="flex items-center justify-between px-10 py-4.5 border-b" style={{ borderColor: "var(--c-border-soft)" }}>
          <Link href="/" className="font-heading font-bold text-lg tracking-tight text-foreground no-underline">
            Cresc
          </Link>
          <div className="flex items-center gap-2 font-mono text-xs px-3 py-1.5 rounded-lg border" style={{ color: "var(--c-accent)", background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--c-accent)" }} />
            {priceDisplay} · settled on Arc
          </div>
        </nav>

        {featureImage && (
          <div className="w-full" style={{ maxHeight: "420px", overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={featureImage} alt="" className="w-full object-cover" style={{ maxHeight: "420px" }} />
          </div>
        )}

        <div className="max-w-2xl mx-auto px-6 pt-12">
          <h1 className="font-heading font-bold text-[38px] leading-tight mb-4" style={{ letterSpacing: "-0.03em" }}>
            {article.title as string}
          </h1>
          <div className="flex items-center gap-2 font-sans text-sm text-muted-foreground mb-10">
            <span>by {(article.creators as { display_name: string }).display_name}</span>
            <span>·</span>
            <span>paid {priceDisplay}</span>
          </div>
        </div>

        <GhostReader html={ghostHtml} />

        <div className="max-w-2xl mx-auto px-6 pt-10 pb-16 border-t" style={{ borderColor: "var(--c-border-soft)" }}>
          <TipButton
            creatorId={site}
            creatorName={(article.creators as { display_name: string }).display_name}
            defaultAmountAtomic={Math.round((article.current_price_atomic as number) * 0.5)}
          />
        </div>
      </main>
    );
  }

  // Pre-unlock: show paywall UI with "Pay & Read" button
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="font-mono text-xs text-muted-foreground px-3 py-1.5 rounded-lg border inline-block" style={{ border: "1px solid var(--c-border)" }}>
          HTTP 402 · AI-priced · Circle Gateway · Arc Testnet
        </div>

        <h1 className="font-heading font-bold text-3xl leading-tight" style={{ letterSpacing: "-0.03em" }}>
          {article.title as string}
        </h1>

        {(article.excerpt as string) && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {article.excerpt as string}
          </p>
        )}

        <div className="py-4">
          <div className="text-4xl font-heading font-bold" style={{ color: "var(--c-accent)" }}>
            {priceDisplay}
          </div>
          <div className="text-xs text-muted-foreground mt-1">per read · EIP-3009 signed offchain · zero gas</div>
        </div>

        <GhostUnlockButton slug={slug} site={site} priceDisplay={priceDisplay} />

        <p className="text-xs text-muted-foreground">
          Price set autonomously by AI based on article traction.{" "}
          <Link href="/" className="underline">Learn more</Link>
        </p>
      </div>
    </main>
  );
}

async function LegacyPiecesReader({ pieceId, sessionId }: { pieceId: string; sessionId: string }) {
  const db = createServerClient();

  const { data: session } = await db
    .from("sessions")
    .select("id, piece_id, reader_id, view_price_paid")
    .eq("id", sessionId)
    .single();

  if (!session || session.piece_id !== pieceId) redirect(`/piece/${pieceId}`);

  const { data: piece } = await db
    .from("pieces")
    .select("id, title, ghost_post_id, ghost_instance_url, creator_id, current_price")
    .eq("id", pieceId)
    .single();

  if (!piece || !piece.ghost_post_id) return <div className="p-10">Not found.</div>;

  const { data: creator } = await db
    .from("creators")
    .select("display_name, wallet_address, ghost_admin_key")
    .eq("id", piece.creator_id)
    .single();

  if (!creator?.ghost_admin_key) return <div className="p-10">Not found.</div>;

  let ghostHtml = "";
  try {
    const ghostClient = new GhostAdminClient(
      piece.ghost_instance_url as string,
      creator.ghost_admin_key as string
    );
    const post = await ghostClient.getPost(piece.ghost_post_id as string);
    ghostHtml = post.html ?? "";
  } catch (err) {
    console.error("[read] legacy Ghost fetch failed:", err);
    ghostHtml = "<p>Content temporarily unavailable.</p>";
  }

  const pricePaid = toDisplay(
    fromBaseUnits(BigInt(session.view_price_paid as string), USDC_ERC20_DECIMALS)
  );

  return (
    <main className="min-h-screen bg-background text-foreground pb-24">
      <nav className="flex items-center justify-between px-10 py-4.5 border-b" style={{ borderColor: "var(--c-border-soft)" }}>
        <Link href="/" className="font-heading font-bold text-lg">Cresc</Link>
        <span className="font-mono text-xs px-3 py-1.5 rounded-lg border">{pricePaid} · settled on Arc</span>
      </nav>
      <div className="max-w-2xl mx-auto px-6 pt-12">
        <h1 className="font-heading font-bold text-[38px] leading-tight mb-4">{piece.title as string}</h1>
      </div>
      <GhostReader html={ghostHtml} />
    </main>
  );
}
