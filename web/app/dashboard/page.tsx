// app/dashboard/page.tsx — Creator dashboard.
// Shows Ghost articles, current prices, earnings from payment_events, price history.

import { Metadata } from "next";
import Link from "next/link";
import { createServerClient } from "../../lib/db";
import { listArticlesByCreator, getCreator } from "../../lib/repo/index";
import type { Article, Creator } from "../../lib/repo/types";
import { fromBaseUnits, toDisplay } from "../../lib/money";
import { USDC_ERC20_DECIMALS } from "../../lib/config";
import { WithdrawSection } from "../../components/WithdrawSection";

export const metadata: Metadata = { title: "Dashboard — Cresc" };

const DEV_CREATOR_ID = process.env.DEV_CREATOR_ID ?? "";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ creator?: string }>;
}) {
  const { creator: creatorParam } = await searchParams;
  const creatorId = creatorParam ?? DEV_CREATOR_ID;

  let creator: Creator | null = null;
  let articles: Article[] = [];
  const earningsBySlug: Record<string, bigint> = {};
  let totalEarnings = 0n;

  if (creatorId) {
    const db = createServerClient();
    try {
      creator = await getCreator(db, creatorId);
      articles = await listArticlesByCreator(db, creatorId);

      // Earnings: sum payment_events per article slug
      const slugs = articles.map((a) => a.slug);
      if (slugs.length > 0) {
        const { data: payments } = await db
          .from('payment_events')
          .select('article_slug, amount_usdc')
          .in('article_slug', slugs);

        for (const p of payments ?? []) {
          const slug = p.article_slug as string;
          const amt = BigInt(p.amount_usdc as string);
          earningsBySlug[slug] = (earningsBySlug[slug] ?? 0n) + amt;
          totalEarnings += amt;
        }
      }
    } catch (err) {
      console.error('[dashboard]', err);
    }
  }

  const fmt = (atomic: bigint | string | number) =>
    toDisplay(fromBaseUnits(BigInt(String(atomic)), USDC_ERC20_DECIMALS));

  return (
    <main className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center justify-between px-10 py-4.5 border-b" style={{ borderColor: 'var(--c-border-soft)' }}>
        <Link href="/" className="font-heading font-bold text-lg tracking-tight">Cresc</Link>
        {creator && (
          <span className="font-sans text-sm text-muted-foreground">
            {creator.display_name}
          </span>
        )}
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-10">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-heading font-bold text-3xl" style={{ letterSpacing: '-0.03em' }}>Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Ghost articles · live AI pricing · Circle Gateway</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-bold" style={{ color: 'var(--c-accent)' }}>{fmt(totalEarnings)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">total earnings</div>
          </div>
        </div>

        {/* Ghost connect prompt */}
        {!creator?.ghost_instance_url && (
          <div className="rounded-xl border px-6 py-5 flex items-center justify-between" style={{ border: '1px solid var(--c-border)', background: 'var(--c-surface)' }}>
            <div>
              <div className="font-semibold text-sm">Connect your Ghost blog</div>
              <div className="text-xs text-muted-foreground mt-0.5">Sync articles and enable the paywall snippet</div>
            </div>
            <Link
              href={`/ghost-connect${creatorId ? `?creator=${creatorId}` : ''}`}
              className="text-sm font-semibold px-4 py-2 rounded-lg"
              style={{ background: '#0f172a', color: '#fff' }}
            >
              Connect Ghost →
            </Link>
          </div>
        )}

        {/* Articles table */}
        {articles.length === 0 ? (
          <div className="text-muted-foreground text-sm py-12 text-center">
            {creator?.ghost_instance_url
              ? 'No articles synced yet. Ghost webhook will populate them automatically on publish.'
              : 'Connect your Ghost blog to see articles here.'}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest px-1">Articles ({articles.length})</div>
            <div className="rounded-xl border overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)' }}>
                    <th className="text-left px-4 py-2.5 font-mono text-xs text-muted-foreground font-normal">Article</th>
                    <th className="text-right px-4 py-2.5 font-mono text-xs text-muted-foreground font-normal">Current price</th>
                    <th className="text-right px-4 py-2.5 font-mono text-xs text-muted-foreground font-normal">Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((article, i) => (
                    <tr
                      key={article.slug}
                      style={{
                        borderTop: i > 0 ? '1px solid var(--c-border-soft)' : undefined,
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-sm leading-tight">{article.title || article.slug}</div>
                        <div className="font-mono text-xs text-muted-foreground mt-0.5">{article.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm" style={{ color: 'var(--c-accent)' }}>
                        {fmt(article.current_price_atomic)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {fmt(earningsBySlug[article.slug] ?? 0n)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {creator && <WithdrawSection creator={creator} />}

      </div>
    </main>
  );
}
