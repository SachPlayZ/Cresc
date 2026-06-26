// src/middleware/hmac.ts — Express middleware: validate Vercel→EC2 HMAC auth.
// Rejects if timestamp skew > 300s or signature mismatch (CLAUDE.md §Vercel↔EC2 boundary).

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { INTERNAL_HMAC_SECRET } from '../config.js';

export function hmacAuth(req: Request, res: Response, next: NextFunction): void {
  const timestamp = req.headers['x-cresc-timestamp'] as string | undefined;
  const sig = req.headers['x-cresc-signature'] as string | undefined;

  if (!timestamp || !sig) {
    res.status(401).json({ error: 'missing hmac headers' });
    return;
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (skew > 300) {
    res.status(401).json({ error: 'timestamp skew too large' });
    return;
  }

  const rawBody: string = (req as Request & { rawBody?: string }).rawBody ?? '';
  const expected = crypto
    .createHmac('sha256', INTERNAL_HMAC_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  let sigBuf: Buffer, expBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, 'hex');
    expBuf = Buffer.from(expected, 'hex');
  } catch {
    res.status(401).json({ error: 'invalid signature encoding' });
    return;
  }

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    res.status(401).json({ error: 'signature mismatch' });
    return;
  }

  next();
}

// Middleware that captures raw body before JSON parse (needed for HMAC)
export function captureRawBody(req: Request, _res: Response, next: NextFunction): void {
  let data = '';
  req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
  req.on('end', () => {
    (req as Request & { rawBody: string }).rawBody = data;
    next();
  });
}
