"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Node, mergeAttributes } from "@tiptap/core";
import { useRef, useCallback } from "react";
import {
  Heading1,
  Heading2,
  Bold,
  Italic,
  Strikethrough,
  Link2,
  Image as ImageIcon,
  Video as VideoIcon,
  Code,
  Quote
} from "lucide-react";

// ---------------------------------------------------------------------------
// Custom VideoBlock Tiptap node — renders as <video controls>
// ---------------------------------------------------------------------------
const VideoBlock = Node.create({
  name: "videoBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: "video[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes, { controls: true, style: "max-width:100%" })];
  },
});

// ---------------------------------------------------------------------------
// Upload helper — presign → PUT to S3 → return publicUrl
// ---------------------------------------------------------------------------
async function uploadMedia(file: File): Promise<string> {
  const presignRes = await fetch("/api/media/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type }),
  });
  if (!presignRes.ok) throw new Error("Presign failed");
  const { uploadUrl, publicUrl } = await presignRes.json() as { uploadUrl: string; publicUrl: string };

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!uploadRes.ok) throw new Error("S3 upload failed");
  return publicUrl;
}

// ---------------------------------------------------------------------------
// Toolbar Button
// ---------------------------------------------------------------------------
function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer"
      style={{
        background: active ? "rgba(155,134,255,0.14)" : "transparent",
        color: active ? "var(--c-violet)" : "var(--c-muted)",
        border: active ? "1px solid rgba(155,134,255,0.22)" : "1px solid transparent",
        boxShadow: active ? "0 0 10px rgba(155, 134, 255, 0.08)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      className="inline-block w-px h-4 mx-1.5 self-center"
      style={{ background: "var(--c-border)" }}
    />
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(async (file: File) => {
    try {
      const url = await uploadMedia(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      console.error("Image upload failed:", err);
    }
  }, [editor]);

  const handleVideoUpload = useCallback(async (file: File) => {
    try {
      const url = await uploadMedia(file);
      editor.chain().focus().insertContent({ type: "videoBlock", attrs: { src: url } }).run();
    } catch (err) {
      console.error("Video upload failed:", err);
    }
  }, [editor]);

  const setLink = useCallback(() => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (!url) { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  return (
    <div
      className="flex flex-wrap items-center gap-1 p-2 rounded-t-xl border-b"
      style={{
        background: "var(--c-surface-hi)",
        borderBottom: "1px solid var(--c-border-soft)",
      }}
    >
      <ToolbarButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
        <Heading1 size={17} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        <Heading2 size={17} />
      </ToolbarButton>

      <Divider />

      <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
        <Bold size={16} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
        <Italic size={16} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
        <Strikethrough size={16} />
      </ToolbarButton>

      <Divider />

      <ToolbarButton active={editor.isActive("link")} onClick={setLink} title="Link">
        <Link2 size={16} />
      </ToolbarButton>

      {/* Image upload */}
      <ToolbarButton onClick={() => imageInputRef.current?.click()} title="Upload image">
        <ImageIcon size={16} />
      </ToolbarButton>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }}
      />

      {/* Video upload */}
      <ToolbarButton onClick={() => videoInputRef.current?.click()} title="Upload video">
        <VideoIcon size={16} />
      </ToolbarButton>
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoUpload(f); e.target.value = ""; }}
      />

      <Divider />

      <ToolbarButton active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
        <Code size={16} />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
        <Quote size={16} />
      </ToolbarButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RichEditor — public interface
// ---------------------------------------------------------------------------
interface RichEditorProps {
  placeholder?: string;
  onChange?: (html: string) => void;
  disabled?: boolean;
}

export function RichEditor({ placeholder = "Write your piece here…", onChange, disabled }: RichEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ allowBase64: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      VideoBlock,
    ],
    editable: !disabled,
    onUpdate({ editor }) {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "outline-none min-h-64 px-6 py-5 text-[15px] leading-relaxed font-sans tiptap-editor-content",
      },
    },
  });

  if (!editor) return null;

  return (
    <div
      className="rounded-xl overflow-hidden cresc-editor-wrapper"
      style={{
        border: "1px solid var(--c-border)",
        background: "var(--c-surface-hi)",
      }}
    >
      <Toolbar editor={editor} />
      <div
        style={{
          background: "var(--c-bg-soft)",
        }}
      >
        <style>{`
          .cresc-editor-wrapper {
            transition: border-color 0.22s ease, box-shadow 0.22s ease;
          }
          .cresc-editor-wrapper:focus-within {
            border-color: var(--c-violet) !important;
            box-shadow: 0 0 24px rgba(155, 134, 255, 0.14) !important;
          }
          .tiptap-editor-content p {
            margin: 0 0 1.1em;
            color: var(--c-text);
            font-size: 15px;
            line-height: 1.7;
          }
          .tiptap-editor-content h1 {
            font-family: var(--font-heading), sans-serif;
            font-size: 1.85em;
            font-weight: 700;
            margin: 1.2em 0 0.5em;
            letter-spacing: -0.025em;
            color: var(--c-text);
          }
          .tiptap-editor-content h2 {
            font-family: var(--font-heading), sans-serif;
            font-size: 1.45em;
            font-weight: 700;
            margin: 1em 0 0.5em;
            letter-spacing: -0.02em;
            color: var(--c-text);
          }
          .tiptap-editor-content a {
            color: var(--c-violet);
            text-decoration: underline;
            font-weight: 500;
          }
          .tiptap-editor-content img {
            max-width: 100%;
            border-radius: 12px;
            margin: 1.2em 0;
            border: 1px solid var(--c-border);
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
          }
          .tiptap-editor-content video {
            max-width: 100%;
            border-radius: 12px;
            margin: 1.2em 0;
            border: 1px solid var(--c-border);
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
          }
          .tiptap-editor-content code {
            font-family: var(--font-mono), monospace;
            font-size: 0.9em;
            padding: 0.2em 0.4em;
            border-radius: 6px;
            background: rgba(255,255,255,0.06);
            color: var(--c-accent);
          }
          .tiptap-editor-content pre {
            background: rgba(0,0,0,0.3);
            padding: 1.2em 1.5em;
            border-radius: 10px;
            overflow-x: auto;
            margin: 1em 0;
            border: 1px solid var(--c-border);
          }
          .tiptap-editor-content blockquote {
            border-left: 4px solid var(--c-violet);
            padding-left: 1.2em;
            color: var(--c-muted);
            font-style: italic;
            margin: 1.2em 0;
          }
          .tiptap-editor-content ul, .tiptap-editor-content ol {
            padding-left: 1.8em;
            margin: 0.8em 0;
          }
          .tiptap-editor-content li {
            margin-bottom: 0.4em;
          }
          .tiptap-editor-content p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            color: var(--c-dim);
            pointer-events: none;
            float: left;
            height: 0;
          }
        `}</style>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// Helper to count words in HTML (strip tags first)
export function countWordsInHtml(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ");
  return text.trim().split(/\s+/).filter(Boolean).length;
}
