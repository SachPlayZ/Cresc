import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return new NextResponse("Key required", { status: 400 });
  }

  const region = process.env.AWS_REGION ?? "us-east-1";
  const bucket = process.env.S3_BUCKET;

  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return new NextResponse("AWS S3 configuration missing", { status: 500 });
  }

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3.send(command);
    if (!response.Body) {
      return new NextResponse("Media resource empty", { status: 404 });
    }

    // Convert S3 response stream to standard web stream
    const stream = response.Body.transformToWebStream();

    return new NextResponse(stream as any, {
      headers: {
        "Content-Type": response.ContentType || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("Error proxying media from S3:", err);
    return new NextResponse("Media not found", { status: 404 });
  }
}
