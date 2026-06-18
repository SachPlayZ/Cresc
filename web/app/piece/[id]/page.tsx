/**
 * app/piece/[id]/page.tsx — M4 reader page.
 *
 * Server component: fetches piece metadata (title, current_price) from DB.
 * Renders title + price ticker + UnlockButton (client component).
 * After unlock: UnlockButton shows the piece body + Arc explorer link inline.
 *
 * The piece body is NOT returned here — it only arrives after the x402 payment
 * settles. This page intentionally shows only metadata before payment.
 */

import { notFound } from "next/navigation";
import { createServerClient } from "../../../lib/db";
import { getPiece } from "../../../lib/repo/index";
import { fromBaseUnits as moneyFromBaseUnits, toDisplay } from "../../../lib/money";
import { USDC_ERC20_DECIMALS, isMockMode } from "../../../lib/config";
import { UnlockButton } from "../../../components/UnlockButton";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PiecePage({ params }: PageProps) {
  const { id } = await params;

  // Fetch piece metadata server-side.
  let piece;
  try {
    const db = createServerClient();
    piece = await getPiece(db, id);
  } catch {
    if (isMockMode) {
      // In pure mock mode (no DB), render a deterministic demo piece.
      piece = null;
    } else {
      // Surface DB errors clearly in dev.
      throw new Error(`Failed to load piece ${id}`);
    }
  }

  // Mock piece for dev/demo when no DB is configured.
  const mockPiece = {
    id,
    title: "Mock Article: The Quiet Collapse of Attention",
    current_price: "1000", // $0.001 in 6-decimal base units
    body: "Mock body — this will be shown after payment in real mode.",
    status: "listed" as const,
  };

  const displayPiece = piece ?? (isMockMode ? mockPiece : null);

  if (!displayPiece) {
    notFound();
  }

  if (displayPiece.status !== "listed" && !isMockMode) {
    notFound();
  }

  // Convert standing price to display string.
  const standingPrice = moneyFromBaseUnits(
    BigInt(displayPiece.current_price),
    USDC_ERC20_DECIMALS
  );
  const priceDisplay = toDisplay(standingPrice);

  return (
    <main
      data-theme="dark"
      style={{
        minHeight: "100vh",
        background: "var(--c-bg, #0a0814)",
        color: "var(--c-text, #ede8ff)",
        fontFamily: "var(--font-manrope), sans-serif",
        padding: "0 0 80px",
      }}
    >
      {/* ---- Nav bar ---- */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 40px",
          borderBottom: "1px solid var(--c-border-soft, rgba(255,255,255,0.07))",
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: "-0.03em",
            color: "var(--c-text, #ede8ff)",
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              background: "var(--c-accent, #7c3aed)",
              borderRadius: 3,
              display: "inline-block",
              transform: "rotate(45deg)",
              boxShadow: "0 0 10px var(--c-accent, #7c3aed)",
            }}
          />
          Cresc
        </a>

        {/* Standing price badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 13,
            color: "var(--c-accent, #7c3aed)",
            background: "var(--c-surface, #13111f)",
            border: "1px solid var(--c-border, rgba(255,255,255,0.1))",
            padding: "6px 13px",
            borderRadius: 8,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--c-accent, #7c3aed)",
              boxShadow: "0 0 8px var(--c-accent, #7c3aed)",
              display: "inline-block",
            }}
          />
          {priceDisplay} · standing price
        </div>
      </nav>

      {/* ---- Content area ---- */}
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "64px 40px 0",
        }}
      >
        {/* Protocol badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--c-violet, #8b5cf6)",
            background: "var(--c-surface, #13111f)",
            border: "1px solid var(--c-border, rgba(255,255,255,0.1))",
            padding: "6px 12px",
            borderRadius: 999,
            marginBottom: 28,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--c-accent, #7c3aed)",
              display: "inline-block",
            }}
          />
          402 · x402 payment required
        </div>

        {/* Title */}
        <h1
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontWeight: 700,
            fontSize: 38,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            margin: "0 0 12px",
          }}
        >
          {displayPiece.title}
        </h1>

        {/* Meta */}
        <div
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 15,
            color: "var(--c-muted, #888)",
            marginBottom: 40,
          }}
        >
          Unlock for {priceDisplay} · settled instantly on Arc via Circle Gateway
        </div>

        {/* ---- Paywall / content area (client) ---- */}
        <div
          style={{
            background: "linear-gradient(170deg, var(--c-surface-hi, #1a1630), var(--c-surface, #13111f))",
            border: "1px solid var(--c-border, rgba(255,255,255,0.1))",
            borderRadius: 16,
            padding: "32px 36px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Blurred preview hint */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "repeating-linear-gradient(180deg, var(--c-border-soft, rgba(255,255,255,0.04)) 0, var(--c-border-soft, rgba(255,255,255,0.04)) 1px, transparent 1px, transparent 28px)",
              pointerEvents: "none",
              borderRadius: 16,
            }}
          />

          <div style={{ position: "relative", zIndex: 1 }}>
            {/* Teaser text lines (blurred placeholder) */}
            <div style={{ marginBottom: 32 }}>
              {[100, 96, 88, 100, 72].map((w, i) => (
                <div
                  key={i}
                  style={{
                    height: 10,
                    borderRadius: 4,
                    background: "var(--c-border, rgba(255,255,255,0.1))",
                    width: `${w}%`,
                    marginBottom: 10,
                    opacity: 0.5 - i * 0.06,
                  }}
                />
              ))}
            </div>

            {/* Unlock CTA */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
                padding: "24px 0 8px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 12,
                  letterSpacing: "0.1em",
                  color: "var(--c-dim, #555)",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                HTTP 402 · locked
              </div>

              <UnlockButton pieceId={id} priceDisplay={priceDisplay} />

              <div
                style={{
                  fontFamily: "var(--font-manrope), sans-serif",
                  fontSize: 13,
                  color: "var(--c-dim, #555)",
                  maxWidth: 340,
                  lineHeight: 1.5,
                }}
              >
                EIP-3009 signed offchain · zero gas · sub-second settlement on Arc
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
