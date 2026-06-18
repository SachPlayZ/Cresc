"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Node, mergeAttributes } from "@tiptap/core";
import { useRef, useCallback } from "react";

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
// Toolbar
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
      className="px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors"
      style={{
        background: active ? "rgba(155,134,255,0.18)" : "transparent",
        color: active ? "var(--c-violet)" : "var(--c-muted)",
        border: active ? "1px solid rgba(155,134,255,0.3)" : "1px solid transparent",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      className="inline-block w-px h-5 mx-0.5 self-center"
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
      className="flex flex-wrap items-center gap-0.5 p-2 rounded-t-xl border-b"
      style={{
        background: "var(--c-surface)",
        border: "1px solid var(--c-border)",
        borderBottom: "1px solid var(--c-border-soft)",
      }}
    >
      <ToolbarButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">H1</ToolbarButton>
      <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">H2</ToolbarButton>

      <Divider />

      <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><strong>B</strong></ToolbarButton>
      <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><em>I</em></ToolbarButton>
      <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><s>S</s></ToolbarButton>

      <Divider />

      <ToolbarButton active={editor.isActive("link")} onClick={setLink} title="Link">🔗</ToolbarButton>

      {/* Image upload */}
      <ToolbarButton onClick={() => imageInputRef.current?.click()} title="Upload image">📷</ToolbarButton>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }}
      />

      {/* Video upload */}
      <ToolbarButton onClick={() => videoInputRef.current?.click()} title="Upload video">🎬</ToolbarButton>
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoUpload(f); e.target.value = ""; }}
      />

      <Divider />

      <ToolbarButton active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">&lt;/&gt;</ToolbarButton>
      <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">&ldquo;</ToolbarButton>
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
        class: "outline-none min-h-64 px-5 py-4 text-sm leading-7 font-sans",
      },
    },
  });

  if (!editor) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--c-border)" }}
    >
      <Toolbar editor={editor} />
      <div
        style={{
          background: "var(--c-surface-hi)",
          // Prose styles for the editable area
        }}
      >
        <style>{`
          .tiptap p { margin: 0 0 0.75em; }
          .tiptap h1 { font-size: 1.6em; font-weight: 700; margin: 1em 0 0.4em; letter-spacing: -0.02em; }
          .tiptap h2 { font-size: 1.3em; font-weight: 700; margin: 0.8em 0 0.4em; }
          .tiptap a { color: var(--c-violet); text-decoration: underline; }
          .tiptap img { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }
          .tiptap video { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }
          .tiptap code { font-family: var(--font-mono); font-size: 0.875em; padding: 0.1em 0.35em; border-radius: 4px; background: rgba(255,255,255,0.06); }
          .tiptap pre { background: rgba(0,0,0,0.3); padding: 0.8em 1em; border-radius: 8px; overflow-x: auto; margin: 0.75em 0; }
          .tiptap blockquote { border-left: 3px solid var(--c-violet); padding-left: 1em; color: var(--c-muted); margin: 0.75em 0; }
          .tiptap ul, .tiptap ol { padding-left: 1.5em; margin: 0.5em 0; }
          .tiptap p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--c-dim); pointer-events: none; float: left; height: 0; }
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
