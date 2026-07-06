// lib/ghost/index.ts — Ghost Admin API adapter (server-side only).
// Ghost Admin API uses JWT auth: key format is "<id>:<hex-secret>".
// Full HTML is only fetched at read-time (post x402 settlement) — never pre-unlock.

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

// Blocks SSRF via a creator-supplied Ghost instance URL (e.g. pointing at
// 169.254.169.254 or an internal address). https-only, and rejects both literal
// private/loopback/link-local IPs and hostnames that resolve to them.
export async function assertPublicHttpsUrl(urlString: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('invalid instance URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('instance URL must use https://');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('instance URL must not point to a local/internal host');
  }

  const addresses: string[] = [];
  if (net.isIP(hostname)) {
    addresses.push(hostname);
  } else {
    const results = await dns.lookup(hostname, { all: true }).catch(() => []);
    addresses.push(...results.map((r) => r.address));
  }
  if (addresses.length === 0) {
    throw new Error('instance URL host could not be resolved');
  }
  for (const addr of addresses) {
    if (isPrivateOrLoopbackIp(addr)) {
      throw new Error('instance URL must not point to a private/internal address');
    }
  }
}

function isPrivateOrLoopbackIp(addr: string): boolean {
  if (net.isIPv4(addr)) {
    const parts = addr.split('.').map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }
  if (net.isIPv6(addr)) {
    const lower = addr.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    return false;
  }
  return false;
}

export type GhostPost = {
  id: string;            // Ghost UUID — stored as pieces.ghost_post_id
  slug: string;          // URL slug — stored as pieces.ghost_slug
  title: string;
  html: string;          // full content — fetched at read time only
  custom_excerpt: string | null;
  published_at: string;
  feature_image: string | null;
  reading_time: number;  // minutes
};

function buildJwt(adminKey: string): string {
  const colonIdx = adminKey.indexOf(':');
  const id = adminKey.slice(0, colonIdx);
  const hexSecret = adminKey.slice(colonIdx + 1);
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', Buffer.from(hexSecret, 'hex'))
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${sig}`;
}

const POST_FIELDS = 'id,slug,title,html,custom_excerpt,published_at,feature_image,reading_time';

export class GhostAdminClient {
  private instanceUrl: string;
  private adminKey: string;

  constructor(instanceUrl: string, adminKey: string) {
    // Normalise: strip trailing slash
    this.instanceUrl = instanceUrl.replace(/\/$/, '');
    this.adminKey = adminKey;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Ghost ${buildJwt(this.adminKey)}` };
  }

  async validateKey(): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.instanceUrl}/ghost/api/admin/posts/?limit=1&fields=id`,
        { headers: this.authHeaders() }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async listPosts(): Promise<GhostPost[]> {
    const res = await fetch(
      `${this.instanceUrl}/ghost/api/admin/posts/?limit=all&fields=${POST_FIELDS}&filter=status:published`,
      { headers: this.authHeaders() }
    );
    if (!res.ok) {
      throw new Error(`[ghost] listPosts failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const json = await res.json() as { posts: GhostPost[] };
    return json.posts ?? [];
  }

  async getPost(ghostPostId: string): Promise<GhostPost> {
    const res = await fetch(
      `${this.instanceUrl}/ghost/api/admin/posts/${ghostPostId}/?fields=${POST_FIELDS}`,
      { headers: this.authHeaders(), cache: 'no-store' }
    );
    if (!res.ok) {
      throw new Error(`[ghost] getPost(${ghostPostId}) failed: ${res.status}`);
    }
    const json = await res.json() as { posts: GhostPost[] };
    const post = json.posts?.[0];
    if (!post) throw new Error(`[ghost] getPost returned no data for id=${ghostPostId}`);
    return post;
  }
}

// Maps a Ghost post to a pieces INSERT shape.
// body = excerpt (teaser only — full HTML stays in Ghost).
// length_chars = reading_time * 1200 words/min proxy.
export function ghostPostToPieceInsert(
  post: GhostPost,
  creatorId: string,
  instanceUrl: string
): {
  creator_id: string;
  title: string;
  body: string;
  kind: 'article';
  length_chars: number;
  topic_tags: string[];
  objective: 'MAX_REVENUE';
  current_price: string;
  reserve: string;
  ceiling: string;
  status: 'listed';
  ghost_post_id: string;
  ghost_slug: string;
  ghost_instance_url: string;
} {
  return {
    creator_id: creatorId,
    title: post.title,
    body: post.custom_excerpt ?? '',
    kind: 'article',
    length_chars: Math.round((post.reading_time ?? 1) * 1200),
    topic_tags: [],
    objective: 'MAX_REVENUE',
    current_price: '1000',   // $0.001 starting price (6-dec base units)
    reserve: '1000',
    ceiling: '100000',       // $0.1
    status: 'listed',
    ghost_post_id: post.id,
    ghost_slug: post.slug,
    ghost_instance_url: instanceUrl,
  };
}

