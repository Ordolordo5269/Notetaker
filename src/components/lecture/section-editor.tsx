"use client";
import * as React from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { Bold, Code, Heading3, Italic, List, ListOrdered, Quote, Redo2, Strikethrough, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/** The Markdown serializer escapes brackets; restore the app's `[[ref:a-b]]` tokens. */
export function restoreRefTokens(markdown: string): string {
  return markdown.replace(/\\?\[\\?\[ref:(\d+)-(\d+)\\?\]\\?\]/g, "[[ref:$1-$2]]");
}

function ToolbarButton({
  active,
  label,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn(active && "bg-sunken text-accent")}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

export function SectionEditor({
  heading,
  markdown,
  saving,
  onSave,
  onCancel,
}: {
  heading: string;
  markdown: string;
  saving: boolean;
  onSave: (next: { heading: string; markdown: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = React.useState(heading);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [3, 4] }, link: { openOnClick: false } }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown,
    ],
    content: markdown,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "prose-study max-w-none min-h-[240px] px-4 py-3 outline-none",
        "aria-label": "Contenido de la sección",
      },
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      strike: e?.isActive("strike") ?? false,
      code: e?.isActive("code") ?? false,
      h3: e?.isActive("heading", { level: 3 }) ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      quote: e?.isActive("blockquote") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });

  function save() {
    if (!editor) return;
    onSave({ heading: title.trim() || heading, markdown: restoreRefTokens(editor.getMarkdown()) });
  }

  return (
    <div className="rounded-2xl border border-accent/60 bg-surface shadow-soft" data-testid="section-editor">
      <div className="border-b border-border p-4">
        <Label htmlFor="section-heading">Título de la sección</Label>
        <Input
          id="section-heading"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
          className="text-[16px] font-semibold"
        />
      </div>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        <ToolbarButton
          label="Negrita (⌘B)"
          active={state?.bold}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="Cursiva (⌘I)"
          active={state?.italic}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Tachado"
          active={state?.strike}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton label="Código" active={state?.code} onClick={() => editor?.chain().focus().toggleCode().run()}>
          <Code />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          label="Subapartado"
          active={state?.h3}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 />
        </ToolbarButton>
        <ToolbarButton
          label="Lista"
          active={state?.bullet}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="Lista numerada"
          active={state?.ordered}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          label="Cita"
          active={state?.quote}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton label="Deshacer" disabled={!state?.canUndo} onClick={() => editor?.chain().focus().undo().run()}>
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton label="Rehacer" disabled={!state?.canRedo} onClick={() => editor?.chain().focus().redo().run()}>
          <Redo2 />
        </ToolbarButton>
      </div>
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="min-h-[240px] px-4 py-3 text-sm text-muted">Cargando editor…</div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className="text-[12px] leading-relaxed text-subtle">
          Las marcas <code className="rounded bg-sunken px-1">[[ref:a-b]]</code> enlazan cada punto con el minuto de la
          grabación: puedes moverlas o borrarlas. Se guarda como una versión nueva; la anterior queda en el historial.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || !editor}>
            {saving ? <Spinner /> : null}
            Guardar sección
          </Button>
        </div>
      </div>
    </div>
  );
}
