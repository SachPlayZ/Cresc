/**
 * app/piece/[id]/page.tsx — M4 reader page (updated M-C5/M-C6).
 *
 * Server component: fetches piece metadata (title, current_price, kind) from DB.
 * Renders title + price ticker + UnlockButton (client component).
 * After unlock: UnlockButton renders HTML body (sanitized) or <video> for video pieces.
 *
 * Piece body NOT returned here — only arrives after x402 payment settles.
 */

import { notFound } from "next/navigation";
import { createServerClient } from "../../../lib/db";
import { getPiece, getCreator } from "../../../lib/repo/index";
import { fromBaseUnits as moneyFromBaseUnits, toDisplay } from "../../../lib/money";
import { USDC_ERC20_DECIMALS, isMockMode } from "../../../lib/config";
import { UnlockButton } from "../../../components/UnlockButton";
import Link from "next/link";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PiecePage({ params }: PageProps) {
  const { id } = await params;

  let piece;
  let creator = null;
  try {
    const db = createServerClient();
    piece = await getPiece(db, id);
    if (piece) {
      creator = await getCreator(db, piece.creator_id);
    }
  } catch {
    if (isMockMode) {
      piece = null;
    } else {
      throw new Error(`Failed to load piece ${id}`);
    }
  }

  const mockPiece = {
    id,
    title: "Mock Article: The Quiet Collapse of Attention",
    current_price: "1000",
    kind: "article" as const,
    body: "<p>Mock body — this will be shown after payment in real mode.</p>",
    status: "listed" as const,
    creator_id: "mock-creator-1",
  };

  const mockCreator = {
    id: "mock-creator-1",
    display_name: "Dana Okafor",
    wallet_address: "0x9b86FF5733c6F84E3ECF8E3ECF8E3ECF8E3ECF8E",
    created_at: new Date().toISOString(),
  };

  const displayPiece = piece ?? (isMockMode ? mockPiece : null);
  const displayCreator = creator ?? (isMockMode ? mockCreator : null);

  if (!displayPiece) notFound();
  if (displayPiece!.status !== "listed" && !isMockMode) notFound();

  const standingPrice = moneyFromBaseUnits(
    BigInt(displayPiece!.current_price),
    USDC_ERC20_DECIMALS
  );
  const priceDisplay = toDisplay(standingPrice);
  const isVideo = (displayPiece as { kind?: string }).kind === "video";

  return (
    <main className="min-h-screen bg-background text-foreground pb-20">
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-10 py-4.5 border-b"
        style={{ borderColor: "var(--c-border-soft)" }}
      >
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="font-heading font-bold text-lg tracking-tight text-foreground no-underline flex items-center gap-2"
            style={{ letterSpacing: "-0.03em" }}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{
                background: "var(--c-accent)",
                transform: "rotate(45deg)",
                boxShadow: "0 0 10px var(--c-accent)",
              }}
            />
            Cresc
          </Link>
          <Link
            href="/browse"
            className="font-sans text-sm font-semibold text-muted-foreground hover:text-foreground no-underline transition-colors"
          >
            Browse
          </Link>
          <Link
            href="/history"
            className="font-sans text-sm font-semibold text-muted-foreground hover:text-foreground no-underline transition-colors"
          >
            My History
          </Link>
        </div>

        {/* Standing price badge */}
        <div
          className="flex items-center gap-2 font-mono text-sm px-3 py-1.5 rounded-lg border"
          style={{
            color: "var(--c-accent)",
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: "var(--c-accent)",
              boxShadow: "0 0 8px var(--c-accent)",
            }}
          />
          {priceDisplay} · standing price
        </div>
      </nav>

      {/* Content area */}
      <div className="max-w-2xl mx-auto px-10 pt-16">
        {/* Protocol badge */}
        <div
          className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-full border mb-7"
          style={{
            color: "var(--c-violet)",
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
          }}
        >
          <span
            className="inline-block w-1 h-1 rounded-full"
            style={{ background: "var(--c-accent)" }}
          />
          {isVideo ? "402 · video locked" : "402 · x402 payment required"}
        </div>

        {/* Title */}
        <h1
          className="font-heading font-bold text-[38px] leading-tight mb-3"
          style={{ letterSpacing: "-0.03em" }}
        >
          {displayPiece!.title}
        </h1>

        {/* Meta & Creator */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-[15px] text-muted-foreground mb-10">
          <span>{isVideo ? "Unlock to watch" : "Unlock to read"}</span>
          <span>·</span>
          <span>{priceDisplay}</span>
          <span>·</span>
          <span>by</span>
          {displayCreator && (
            <Link
              href={`/creator/${displayCreator.wallet_address}`}
              className="font-bold hover:underline transition-colors flex items-center gap-1.5"
              style={{ color: "var(--c-violet)" }}
            >
              <span>{displayCreator.display_name}</span>
              <span className="font-mono text-xs opacity-60">
                ({displayCreator.wallet_address.slice(0, 6)}...{displayCreator.wallet_address.slice(-4)})
              </span>
            </Link>
          )}
          <span>·</span>
          <span>settled instantly on Arc</span>
        </div>

        {/* Paywall / content area */}
        <div
          className="rounded-2xl p-8 relative overflow-hidden border"
          style={{
            background: "linear-gradient(170deg, var(--c-surface-hi), var(--c-surface))",
            border: "1px solid var(--c-border)",
          }}
        >
          {/* Blurred preview hint */}
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{
              backgroundImage:
                "repeating-linear-gradient(180deg, var(--c-border-soft) 0, var(--c-border-soft) 1px, transparent 1px, transparent 28px)",
            }}
          />

          <div className="relative z-10">
            {/* Pre-unlock teaser */}
            <div className="mb-8">
              {isVideo ? (
                // Video placeholder with padlock icon
                <div
                  className="flex flex-col items-center justify-center rounded-xl gap-3"
                  style={{
                    background: "rgba(0,0,0,0.45)",
                    height: "180px",
                    border: "1px solid var(--c-border)",
                  }}
                >
                  <div className="text-4xl" style={{ filter: "drop-shadow(0 0 12px rgba(255,255,255,0.2))" }}>
                    🎬🔒
                  </div>
                  <span className="font-mono text-xs tracking-wider" style={{ color: "var(--c-muted)" }}>
                    video locked
                  </span>
                </div>
              ) : (
                // Article skeleton bars
                [100, 96, 88, 100, 72].map((w, i) => (
                  <div
                    key={i}
                    className="h-2.5 rounded mb-2.5"
                    style={{
                      background: "var(--c-border)",
                      width: `${w}%`,
                      opacity: 0.5 - i * 0.06,
                    }}
                  />
                ))
              )}
            </div>

            {/* Unlock CTA */}
            <div className="flex flex-col items-center gap-3.5 pt-6 pb-2 text-center">
              <div
                className="font-mono text-xs tracking-widest uppercase mb-1"
                style={{ color: "var(--c-dim)" }}
              >
                {isVideo ? "HTTP 402 · video locked" : "HTTP 402 · locked"}
              </div>

              <UnlockButton pieceId={id} priceDisplay={priceDisplay} isVideo={isVideo} />

              <p
                className="font-sans text-sm max-w-xs leading-snug"
                style={{ color: "var(--c-dim)" }}
              >
                EIP-3009 signed offchain · zero gas · sub-second settlement on Arc
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
