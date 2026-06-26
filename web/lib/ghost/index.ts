// lib/ghost/index.ts — Ghost Admin API adapter (server-side only).
// Ghost Admin API uses JWT auth: key format is "<id>:<hex-secret>".
// Full HTML is only fetched at read-time (post x402 settlement) — never pre-unlock.

import crypto from 'node:crypto';

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

// Verifies a Ghost webhook HMAC signature.
// Header format: "sha256=<hex>, t=<unix_timestamp>"
export function verifyGhostSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): boolean {
  try {
    const sha256Part = signatureHeader.split(',').find((p) => p.trim().startsWith('sha256='));
    if (!sha256Part) return false;
    const receivedHex = sha256Part.trim().replace('sha256=', '');
    const expected = crypto
      .createHmac('sha256', Buffer.from(webhookSecret))
      .update(rawBody)
      .digest();
    const received = Buffer.from(receivedHex, 'hex');
    if (received.length !== expected.length) return false;
    return crypto.timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}
