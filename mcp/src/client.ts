// client.ts — thin fetch wrapper over the Cresc public discovery API.
//
// No auth: /api/public/* is unauthenticated by design. This package holds no
// keys, signs nothing, and never sees article bodies.
//
// NEVER write to stdout from this package — stdout is the MCP JSON-RPC channel.
// Diagnostics go to stderr.

export type PublicArticle = {
  slug: string;
  site: string;
  title: string;
  excerpt: string;
  creator: string;
  topics: string[];
  price: string;
  price_atomic: string;
  url: string;
};

export type SearchResponse = {
  query: string;
  count: number;
  results: PublicArticle[];
};

const DEFAULT_API_URL = 'https://cresc.vercel.app';
const TIMEOUT_MS = 15_000;

export class CrescApiError extends Error {}

function baseUrl(): string {
  return (process.env.CRESC_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');
}

async function getJson<T>(path: string): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  } catch (err) {
    throw new CrescApiError(
      `Could not reach the Cresc API at ${baseUrl()} (${err instanceof Error ? err.message : String(err)}).`
    );
  }

  if (res.status === 404) throw new CrescApiError('not_found');
  if (!res.ok) throw new CrescApiError(`Cresc API returned ${res.status} for ${path}.`);

  return (await res.json()) as T;
}

export async function search(query: string, limit: number): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  return getJson<SearchResponse>(`/api/public/search?${qs.toString()}`);
}

export async function getArticle(slug: string, site: string): Promise<PublicArticle | null> {
  const qs = new URLSearchParams({ site });
  try {
    return await getJson<PublicArticle>(
      `/api/public/articles/${encodeURIComponent(slug)}?${qs.toString()}`
    );
  } catch (err) {
    if (err instanceof CrescApiError && err.message === 'not_found') return null;
    throw err;
  }
}
