"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Node, mergeAttributes } from "@tiptap/core";
import { useRef, useCallback, useState, useEffect } from "react";
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
  Quote,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  Sparkles,
  Loader2,
  BookOpen
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
  if (!presignRes.ok) throw new Error("Presign endpoint failed");
  const { uploadUrl, publicUrl } = await presignRes.json() as { uploadUrl: string; publicUrl: string };

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  
  if (!uploadRes.ok) {
    if (uploadRes.status === 0 || uploadRes.status === 403) {
      throw new Error(
        "CORS policy error: Preflight credentials or access control rules are not configured on the S3 bucket. Please check S3 permissions."
      );
    }
    throw new Error(`S3 upload failed with status ${uploadRes.status}`);
  }
  return publicUrl;
}

// ---------------------------------------------------------------------------
// Toolbar Button Component
// ---------------------------------------------------------------------------
function ToolbarButton({
  active,
  onClick,
  title,
  disabled,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-2 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95 flex items-center justify-center cursor-pointer ${
        disabled ? "opacity-30 cursor-not-allowed" : ""
      }`}
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
      className="inline-block w-px h-4 mx-1 self-center"
      style={{ background: "var(--c-border)" }}
    />
  );
}

interface ToolbarProps {
  editor: Editor;
  uploading: boolean;
  setUploading: (val: boolean) => void;
  setUploadError: (val: string) => void;
}

function Toolbar({ editor, uploading, setUploading, setUploadError }: ToolbarProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError("");
    try {
      const url = await uploadMedia(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      console.error("Image upload failed:", err);
    } finally {
      setUploading(false);
    }
  }, [editor, setUploading, setUploadError]);

  const handleVideoUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError("");
    try {
      const url = await uploadMedia(file);
      editor.chain().focus().insertContent({ type: "videoBlock", attrs: { src: url } }).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      console.error("Video upload failed:", err);
    } finally {
      setUploading(false);
    }
  }, [editor, setUploading, setUploadError]);

  const setLink = useCallback(() => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter link URL", prev ?? "https://");
    if (!url) { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-1 p-2 border-b"
      style={{
        background: "color-mix(in srgb, var(--c-surface) 80%, transparent)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--c-border-soft)",
      }}
    >
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolbarButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1" disabled={uploading}>
          <Heading1 size={16} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2" disabled={uploading}>
          <Heading2 size={16} />
        </ToolbarButton>

        <Divider />

        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold" disabled={uploading}>
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic" disabled={uploading}>
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough" disabled={uploading}>
          <Strikethrough size={15} />
        </ToolbarButton>

        <Divider />

        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List" disabled={uploading}>
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List" disabled={uploading}>
          <ListOrdered size={15} />
        </ToolbarButton>

        <Divider />

        <ToolbarButton active={editor.isActive("link")} onClick={setLink} title="Link" disabled={uploading}>
          <Link2 size={15} />
        </ToolbarButton>

        {/* Image upload */}
        <ToolbarButton onClick={() => imageInputRef.current?.click()} title="Upload Image" disabled={uploading}>
          <ImageIcon size={15} />
        </ToolbarButton>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }}
        />

        {/* Video upload */}
        <ToolbarButton onClick={() => videoInputRef.current?.click()} title="Upload Video" disabled={uploading}>
          <VideoIcon size={15} />
        </ToolbarButton>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoUpload(f); e.target.value = ""; }}
        />

        <Divider />

        <ToolbarButton active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline Code" disabled={uploading}>
          <Code size={15} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote" disabled={uploading}>
          <Quote size={15} />
        </ToolbarButton>
      </div>

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={uploading || !editor.can().undo()}>
          <Undo2 size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={uploading || !editor.can().redo()}>
          <Redo2 size={15} />
        </ToolbarButton>
      </div>
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

export function RichEditor({ placeholder = "Write your masterpiece here…", onChange, disabled }: RichEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ allowBase64: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      VideoBlock,
    ],
    editable: !disabled && !uploading,
    onUpdate({ editor }) {
      const html = editor.getHTML();
      onChange?.(html);
      
      // Update statistics
      const text = editor.getText().trim();
      setWordCount(text ? text.split(/\s+/).length : 0);
      setCharCount(text.length);
    },
    editorProps: {
      attributes: {
        class: "outline-none min-h-[380px] px-8 py-7 text-[16px] leading-relaxed font-sans tiptap-editor-content",
      },
    },
  });

  if (!editor) return null;

  const readTime = Math.max(1, Math.round(wordCount / 200));

  return (
    <div
      className="rounded-2xl overflow-hidden cresc-editor-wrapper flex flex-col"
      style={{
        border: "1px solid var(--c-border)",
        background: "var(--c-surface)",
        boxShadow: "var(--c-shadow-sm)",
      }}
    >
      {/* Notion-style header bar */}
      <div
        className="px-4 py-2 border-b flex items-center justify-between text-xs font-mono"
        style={{
          background: "var(--c-bg-soft)",
          borderBottom: "1px solid var(--c-border-soft)",
          color: "var(--c-dim)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span>Editor Session Connected</span>
        </div>
        <div className="flex items-center gap-2">
          <span>HTML Source Node</span>
        </div>
      </div>

      <Toolbar
        editor={editor}
        uploading={uploading}
        setUploading={setUploading}
        setUploadError={setUploadError}
      />

      <div
        className="relative flex-1"
        style={{
          background: "var(--c-surface-hi)",
        }}
      >
        {/* Editor Body */}
        <EditorContent editor={editor} />

        {/* Overlay loader when media is uploading */}
        {uploading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{
              background: "rgba(21, 16, 31, 0.75)",
              backdropFilter: "blur(6px)",
            }}
          >
            <Loader2 className="animate-spin text-[var(--c-violet)]" size={32} />
            <span
              className="text-sm font-mono tracking-wide"
              style={{ color: "var(--c-text)" }}
            >
              Uploading Media Assets...
            </span>
          </div>
        )}
      </div>

      {/* Upload Error Alert Banner */}
      {uploadError && (
        <div
          className="p-3 text-xs border-t font-mono leading-relaxed"
          style={{
            background: "rgba(224, 138, 138, 0.09)",
            borderColor: "rgba(224, 138, 138, 0.22)",
            color: "var(--c-red)",
          }}
        >
          <div className="font-bold mb-1">❌ Media Upload Blocked</div>
          <div>{uploadError}</div>
          <div className="mt-1.5 opacity-80 text-[10px]">
            Tip: S3 requires preflight Access Control headers. Configure CORS in your AWS S3 Permissions tab to resolve this preflight blocker.
          </div>
        </div>
      )}

      {/* Tiptap Styled Stylesheet & Prose overrides */}
      <style>{`
        .cresc-editor-wrapper {
          transition: border-color 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .cresc-editor-wrapper:focus-within {
          border-color: var(--c-violet) !important;
          box-shadow: 0 0 30px rgba(155, 134, 255, 0.16) !important;
        }
        
        /* Prose writing canvas custom layout rules */
        .tiptap-editor-content p {
          margin: 0 0 1.25em;
          color: var(--c-text);
          font-size: 16px;
          line-height: 1.8;
          font-family: var(--font-sans), sans-serif;
        }
        
        .tiptap-editor-content h1 {
          font-family: var(--font-heading), sans-serif;
          font-size: 2em;
          font-weight: 700;
          margin: 1.3em 0 0.5em;
          letter-spacing: -0.03em;
          color: var(--c-text);
          line-height: 1.25;
        }
        
        .tiptap-editor-content h2 {
          font-family: var(--font-heading), sans-serif;
          font-size: 1.55em;
          font-weight: 700;
          margin: 1.1em 0 0.5em;
          letter-spacing: -0.025em;
          color: var(--c-text);
          line-height: 1.35;
        }
        
        .tiptap-editor-content a {
          color: var(--c-violet);
          text-decoration: underline;
          text-underline-offset: 4px;
          font-weight: 600;
          transition: color 0.15s ease;
        }
        .tiptap-editor-content a:hover {
          color: var(--c-text);
        }
        
        .tiptap-editor-content img {
          max-width: 100%;
          border-radius: 14px;
          margin: 1.5em 0;
          border: 1px solid var(--c-border);
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
        }
        
        .tiptap-editor-content video {
          max-width: 100%;
          border-radius: 14px;
          margin: 1.5em 0;
          border: 1px solid var(--c-border);
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
        }
        
        .tiptap-editor-content code {
          font-family: var(--font-mono), monospace;
          font-size: 0.88em;
          padding: 0.2em 0.45em;
          border-radius: 6px;
          background: var(--c-surface-2);
          border: 1px solid var(--c-border);
          color: var(--c-accent);
          font-variant-ligatures: none;
        }
        
        .tiptap-editor-content pre {
          background: rgba(0, 0, 0, 0.35);
          padding: 1.25em 1.50em;
          border-radius: 12px;
          overflow-x: auto;
          margin: 1.25em 0;
          border: 1px solid var(--c-border);
        }
        .tiptap-editor-content pre code {
          background: transparent;
          border: none;
          padding: 0;
          color: var(--c-text);
          font-size: 0.88em;
        }
        
        .tiptap-editor-content blockquote {
          border-left: 4px solid var(--c-violet);
          padding: 0.25em 0 0.25em 1.25em;
          color: var(--c-muted);
          font-style: italic;
          margin: 1.5em 0;
          font-size: 1.05em;
        }
        
        .tiptap-editor-content ul {
          list-style-type: disc;
          padding-left: 1.75em;
          margin: 0.75em 0 1.25em;
        }
        
        .tiptap-editor-content ol {
          list-style-type: decimal;
          padding-left: 1.75em;
          margin: 0.75em 0 1.25em;
        }
        
        .tiptap-editor-content li {
          margin-bottom: 0.45em;
          color: var(--c-text);
          line-height: 1.7;
        }
        
        /* Placeholder layout */
        .tiptap-editor-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--c-dim);
          pointer-events: none;
          float: left;
          height: 0;
          font-style: italic;
        }
      `}</style>

      {/* Notion/Medium style bottom stats bar */}
      <div
        className="px-5 py-3 border-t flex items-center justify-between text-xs font-sans"
        style={{
          background: "var(--c-bg-soft)",
          borderTop: "1px solid var(--c-border-soft)",
          color: "var(--c-muted)",
        }}
      >
        <div className="flex items-center gap-4">
          <span>Words: <strong className="font-mono text-foreground" style={{ color: "var(--c-text)" }}>{wordCount}</strong></span>
          <span className="w-1 h-1 rounded-full bg-[var(--c-border)]" />
          <span>Characters: <strong className="font-mono text-foreground" style={{ color: "var(--c-text)" }}>{charCount}</strong></span>
        </div>
        <div className="flex items-center gap-1.5 font-medium">
          <BookOpen size={13} style={{ color: "var(--c-violet)" }} />
          <span>Est. Reading Time: <strong className="text-foreground font-semibold" style={{ color: "var(--c-text)" }}>{readTime} min</strong></span>
        </div>
      </div>
    </div>
  );
}

// Helper to count words in HTML (strip tags first)
export function countWordsInHtml(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ");
  return text.trim().split(/\s+/).filter(Boolean).length;
}
