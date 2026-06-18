// POST /api/media/presign — returns a presigned S3 PUT URL + public CDN URL.
// Client uploads directly to S3; no file bytes hit this server.

import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/webm", "video/quicktime",
]);
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".mov"]);

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  };
  return map[mime] ?? "";
}

export async function POST(req: NextRequest) {
  const { filename, mimeType } = await req.json() as { filename?: string; mimeType?: string };

  if (!filename || !mimeType) {
    return NextResponse.json({ error: "filename and mimeType required" }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported MIME type" }, { status: 400 });
  }

  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : "";
  if (!ALLOWED_EXTS.has(ext)) {
    return NextResponse.json({ error: "Unsupported file extension" }, { status: 400 });
  }

  const region = process.env.AWS_REGION ?? "us-east-1";
  const bucket = process.env.S3_BUCKET;

  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    // Mock mode: return a placeholder URL so the editor is testable without AWS.
    const mockKey = `pieces/${randomUUID()}${extFromMime(mimeType) || ext}`;
    return NextResponse.json({
      uploadUrl: `https://mock-s3.example.com/${bucket ?? "piece-media"}/${mockKey}`,
      publicUrl: `https://mock-cdn.example.com/${mockKey}`,
    });
  }

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const key = `pieces/${randomUUID()}${ext}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  const publicUrl = `/api/media/view?key=${key}`;

  return NextResponse.json({ uploadUrl, publicUrl });
}
