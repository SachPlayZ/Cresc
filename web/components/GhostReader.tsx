"use client";

import DOMPurify from "isomorphic-dompurify";
import { useEffect, useMemo, useRef } from "react";

interface GhostReaderProps {
  html: string;
  articleSlug?: string;
  site?: string;
}

export function GhostReader({ html, articleSlug, site }: GhostReaderProps) {
  const sentViewRef = useRef(false);

  const safeHtml = useMemo(() => {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        "p","br","b","strong","i","em","s","strike","u","a","h1","h2","h3","h4",
        "ul","ol","li","blockquote","pre","code","img","video","source","figure",
        "figcaption","hr","table","thead","tbody","tr","th","td",
      ],
      ALLOWED_ATTR: ["href","src","alt","controls","class","style","target","rel","type","width","height"],
      ALLOW_DATA_ATTR: false,
    });
  }, [html]);

  useEffect(() => {
    if (!articleSlug) return;

    const startedAt = Date.now();
    sentViewRef.current = false;

    const readerId = (() => {
      try {
        const key = "cresc_reader_id";
        let id = localStorage.getItem(key);
        if (!id) {
          id = crypto.randomUUID();
          localStorage.setItem(key, id);
        }
        return id;
      } catch {
        return "anonymous";
      }
    })();

    const sendView = () => {
      if (sentViewRef.current) return;
      sentViewRef.current = true;
      const payload = JSON.stringify({
        reader_id: readerId,
        article_slug: articleSlug,
        site,
        event_type: "view",
        dwell_ms: Math.max(0, Date.now() - startedAt),
      });
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/telemetry", new Blob([payload], { type: "application/json" }));
          return;
        }
      } catch {
        // Fall through to fetch.
      }
      void fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    };

    const fallbackTimer = window.setTimeout(sendView, 5000);
    const onPageHide = () => sendView();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") sendView();
    };

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sendView();
    };
  }, [articleSlug, site]);

  return (
    <div className="max-w-2xl mx-auto px-6">
      <article
        className="prose prose-neutral dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </div>
  );
}
