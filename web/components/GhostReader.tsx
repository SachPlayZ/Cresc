"use client";

import { useEffect, useState } from "react";

interface GhostReaderProps {
  html: string;
}

export function GhostReader({ html }: GhostReaderProps) {
  const [safeHtml, setSafeHtml] = useState(html);

  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const dp = require("dompurify") as any;
      const purify: { sanitize: (h: string, cfg: Record<string, unknown>) => string } = dp.default ?? dp;
      setSafeHtml(
        purify.sanitize(html, {
          ALLOWED_TAGS: [
            "p","br","b","strong","i","em","s","strike","u","a","h1","h2","h3","h4",
            "ul","ol","li","blockquote","pre","code","img","video","source","figure",
            "figcaption","hr","table","thead","tbody","tr","th","td",
          ],
          ALLOWED_ATTR: ["href","src","alt","controls","class","style","target","rel","type","width","height"],
          ALLOW_DATA_ATTR: false,
        })
      );
    } catch {
      setSafeHtml(html);
    }
  }, [html]);

  return (
    <div className="max-w-2xl mx-auto px-6">
      <article
        className="prose prose-neutral dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}
