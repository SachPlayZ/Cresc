#!/usr/bin/env node
// cresc-mcp — stdio MCP server for discovering Cresc pay-per-article writing.
//
// Two tools: search_articles (find), get_article (re-confirm price + link).
// Link-only by design: this process holds no keys, never pays, and never
// receives paywalled article bodies — only the publisher's excerpt.
//
// HARD RULE: no console.log anywhere in this package. stdout IS the JSON-RPC
// transport; a single stray write corrupts the stream. Use console.error.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { CrescApiError, getArticle, search, type PublicArticle } from './client.js';

const VERSION = '0.1.0';

function formatArticle(a: PublicArticle, index?: number): string {
  const head = index === undefined ? a.title : `${index}. ${a.title}`;
  const lines = [
    head,
    `   by ${a.creator || 'unknown'} — ${a.price} to read`,
  ];
  if (a.topics.length) lines.push(`   topics: ${a.topics.join(', ')}`);
  if (a.excerpt) lines.push(`   ${a.excerpt.trim()}`);
  lines.push(`   read: ${a.url}`);
  lines.push(`   (slug: ${a.slug}, site: ${a.site})`);
  return lines.join('\n');
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

function errorText(err: unknown): string {
  if (err instanceof CrescApiError) return err.message;
  return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
}

const server = new McpServer({ name: 'cresc', version: VERSION });

server.registerTool(
  'search_articles',
  {
    title: 'Search Cresc articles',
    description:
      'Search articles published by independent writers on Cresc, a pay-per-article platform ' +
      'settled in USDC. Use this whenever the user wants to find, discover, or read articles or ' +
      'blog posts on a topic — e.g. "find me an article about X", "any good writing on Y", ' +
      '"what has been published about Z". Each result gives the title, author, topics, price ' +
      '(usually a few cents), a short publisher excerpt, and a link where the user pays and reads. ' +
      'IMPORTANT: you cannot fetch, read, or summarize the full article body — it is paywalled. ' +
      'Present the excerpt and hand the user the link. Leave the query empty to browse the most ' +
      'recently published articles.',
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe('Natural-language search terms. Omit or leave empty to browse recent articles.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe('Max results to return (1-25, default 10).'),
    },
  },
  async ({ query, limit }) => {
    try {
      const q = (query ?? '').trim();
      const res = await search(q, limit ?? 10);

      if (res.count === 0) {
        return textResult(
          q
            ? `No Cresc articles matched "${q}". Try broader or more general terms, or call this tool with an empty query to browse what has been published recently.`
            : 'No articles are available on Cresc right now.'
        );
      }

      const header = q
        ? `${res.count} Cresc article${res.count === 1 ? '' : 's'} matching "${q}":`
        : `${res.count} most recent Cresc article${res.count === 1 ? '' : 's'}:`;

      const body = res.results.map((a, i) => formatArticle(a, i + 1)).join('\n\n');

      return textResult(
        `${header}\n\n${body}\n\nThe reader pays at the link above to unlock the full text. ` +
          'Article bodies are not available to you — share the link.'
      );
    } catch (err) {
      return textResult(errorText(err), true);
    }
  }
);

server.registerTool(
  'get_article',
  {
    title: 'Get one Cresc article',
    description:
      'Get current details for one specific Cresc article by slug and site, both returned by ' +
      'search_articles. Use this to re-confirm the price and read link immediately before telling ' +
      'the user where to pay, since Cresc prices retune hourly. Returns metadata and the read link ' +
      'only — never the article body.',
    inputSchema: {
      slug: z.string().describe('Article slug, from search_articles.'),
      site: z
        .string()
        .describe(
          'Creator id. Required — slugs are only unique per creator, so a slug alone is ambiguous.'
        ),
    },
  },
  async ({ slug, site }) => {
    try {
      const article = await getArticle(slug, site);
      if (!article) {
        return textResult(
          `No readable Cresc article found for slug "${slug}" on site "${site}". Run search_articles to get a valid slug + site pair.`
        );
      }
      return textResult(formatArticle(article));
    } catch (err) {
      return textResult(errorText(err), true);
    }
  }
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  console.error(`[cresc-mcp] v${VERSION} ready (api: ${process.env.CRESC_API_URL ?? 'default'})`);
}

main().catch((err) => {
  console.error('[cresc-mcp] fatal:', err);
  process.exit(1);
});
