import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import { RhWorkflowGraph } from '../components/RhWorkflowGraph';
import { RhFieldEditorPopover } from '../components/RhFieldEditorPopover';
import { RhLivePreviewPanel } from '../components/RhLivePreviewPanel';
import {
  fieldsFromAppInfoRaw,
  normalizeRhField,
  parseRunningHubRunRef,
  RH_FIELD_TYPE_LABELS,
  rhWorkflowFieldKind,
  sortRhFields,
  type RhAppConfig,
  type RhAppSummary,
  type RhField,
  type RhWorkflowConfig,
  type RhWorkflowSummary,
} from '../lib/runningHubAdmin';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type EditorState =
  | { kind: 'workflow'; id: string; config: RhWorkflowConfig; loading: boolean; fetching: boolean; saving: boolean; dirty: boolean; saveOkUntil: number; error: string | null }
  | { kind: 'app'; id: string; config: RhAppConfig; loading: boolean; fetching: boolean; saving: boolean; dirty: boolean; saveOkUntil: number; error: string | null };

function emptyWorkflowConfig(workflowId: string): RhWorkflowConfig {
  return {
    workflowId,
    title: `工作流 ${workflowId.slice(-6)}`,
    description: '',
    fields: [],
    workflowJson: {},
    optionalImageMode: 'prune-workflow',
    raw: {},
    updatedAt: 0,
  };
}

function emptyAppConfig(appId: string): RhAppConfig {
  return {
    appId,
    title: `AI 应用 ${appId.slice(-6)}`,
    description: '',
    fields: [],
    raw: {},
    updatedAt: 0,
  };
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export const AdminRunningHubWorkflowsPage = memo(function AdminRunningHubWorkflowsPage({
  shellActive,
}: {
  shellActive: boolean;
}) {
  const [workflows, setWorkflows] = useState<RhWorkflowSummary[]>([]);
  const [apps, setApps] = useState<RhAppSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [popoverFieldId, setPopoverFieldId] = useState<string | null>(null);
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | null>(null);

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wfRes, appRes] = await Promise.all([
        fetch('/api/runninghub/workflows', { credentials: 'same-origin' }),
        fetch('/api/runninghub/apps', { credentials: 'same-origin' }),
      ]);
      const wfData = await readJson(wfRes);
      const appData = await readJson(appRes);
      if (!wfRes.ok) throw new Error(wfData.error || '加载工作流列表失败');
      if (!appRes.ok) throw new Error(appData.error || '加载应用列表失败');
      setWorkflows(Array.isArray(wfData.workflows) ? wfData.workflows : []);
      setApps(Array.isArray(appData.apps) ? appData.apps : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shellActive) void loadLists();
  }, [shellActive, loadLists]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseRunningHubRunRef(pasteValue);
    if (!parsed) {
      setError('请粘贴 /run/ai-app/... 或 /run/workflow/...（或直接粘贴纯数字 workflowId）');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const path = parsed.type === 'workflow' ? `/api/runninghub/workflows/${encodeURIComponent(parsed.id)}` : `/api/runninghub/apps/${encodeURIComponent(parsed.id)}`;
      const body = parsed.type === 'workflow' ? emptyWorkflowConfig(parsed.id) : emptyAppConfig(parsed.id);
      const res = await fetch(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (!res.ok || data.success === false) throw new Error(data.error || '添加失败');
      setPasteValue('');
      await loadLists();
      openEditor(parsed.type, parsed.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败');
    } finally {
      setAdding(false);
    }
  };

  const openEditor = useCallback(async (kind: 'app' | 'workflow', id: string) => {
    setActiveNodeId(null);
    setEditor({
      kind,
      id,
      config: kind === 'workflow' ? emptyWorkflowConfig(id) : emptyAppConfig(id),
      loading: true,
      fetching: false,
      saving: false,
      dirty: false,
      saveOkUntil: 0,
      error: null,
    } as EditorState);
    try {
      const path = kind === 'workflow' ? `/api/runninghub/workflows/${encodeURIComponent(id)}` : `/api/runninghub/apps/${encodeURIComponent(id)}`;
      const res = await fetch(path, { credentials: 'same-origin' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || '加载配置失败');
      const config = kind === 'workflow' ? (data.workflow as RhWorkflowConfig) : (data.app as RhAppConfig);
      setEditor((prev) => (prev && prev.kind === kind && prev.id === id ? ({ ...prev, config, loading: false } as EditorState) : prev));
    } catch (e) {
      setEditor((prev) =>
        prev && prev.kind === kind && prev.id === id
          ? ({ ...prev, loading: false, error: e instanceof Error ? e.message : '加载配置失败' } as EditorState)
          : prev
      );
    }
  }, []);

  const closeEditor = () => {
    setEditor(null);
    setActiveNodeId(null);
    setPopoverFieldId(null);
  };

  const handleFetchRemote = async () => {
    if (!editor) return;
    setEditor((prev) => (prev ? ({ ...prev, fetching: true, error: null } as EditorState) : prev));
    try {
      if (editor.kind === 'workflow') {
        const res = await fetch('/api/runninghub/workflows/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ workflowId: editor.id, title: editor.config.title, description: editor.config.description }),
        });
        const data = await readJson(res);
        if (!res.ok || data.success === false) throw new Error(data.error || '拉取工作流失败');
        const fetched = data.data as { fields: RhField[]; workflowJson: Record<string, unknown>; raw: unknown };
        setEditor((prev) => {
          if (!prev || prev.kind !== 'workflow') return prev;
          const prevFieldsById = new Map(prev.config.fields.map((f) => [f.id, f]));
          const mergedFields = fetched.fields.map((f) => {
            const existing = prevFieldsById.get(f.id);
            return existing ? { ...normalizeRhField(f), enabled: existing.enabled, label: existing.label || f.label, note: existing.note } : normalizeRhField(f);
          });
          return {
            ...prev,
            fetching: false,
            dirty: true,
            saveOkUntil: 0,
            config: { ...prev.config, fields: mergedFields, workflowJson: fetched.workflowJson, raw: fetched.raw },
          };
        });
      } else {
        const res = await fetch(`/api/runninghub/app-info?webappId=${encodeURIComponent(editor.id)}`, { credentials: 'same-origin' });
        const data = await readJson(res);
        if (!res.ok || data.success === false) throw new Error(data.error || '拉取应用参数失败');
        const fetchedFields = fieldsFromAppInfoRaw(data);
        setEditor((prev) => {
          if (!prev || prev.kind !== 'app') return prev;
          const prevFieldsById = new Map(prev.config.fields.map((f) => [f.id, f]));
          const mergedFields = fetchedFields.map((f) => {
            const existing = prevFieldsById.get(f.id);
            return existing ? { ...f, enabled: existing.enabled, label: existing.label || f.label, note: existing.note || f.note } : f;
          });
          return { ...prev, fetching: false, dirty: true, saveOkUntil: 0, config: { ...prev.config, fields: mergedFields, raw: data.data ?? data } };
        });
      }
    } catch (e) {
      setEditor((prev) => (prev ? ({ ...prev, fetching: false, error: e instanceof Error ? e.message : '拉取失败' } as EditorState) : prev));
    }
  };

  const addNotice = useStore((s) => s.addNotice);

  const handleSave = async () => {
    if (!editor) return;
    setEditor((prev) => (prev ? ({ ...prev, saving: true, error: null } as EditorState) : prev));
    try {
      const path = editor.kind === 'workflow' ? `/api/runninghub/workflows/${encodeURIComponent(editor.id)}` : `/api/runninghub/apps/${encodeURIComponent(editor.id)}`;
      const res = await fetch(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(editor.config),
      });
      const data = await readJson(res);
      if (!res.ok || data.success === false) throw new Error(data.error || '保存失败');
      const saved = editor.kind === 'workflow' ? (data.workflow as RhWorkflowConfig) : (data.app as RhAppConfig);
      addNotice('RunningHub 配置已保存', 'success');
      setEditor((prev) => (prev ? ({ ...prev, saving: false, dirty: false, saveOkUntil: Date.now(), config: saved } as EditorState) : prev));
      window.setTimeout(() => {
        setEditor((prev) => (prev?.saveOkUntil ? ({ ...prev, saveOkUntil: 0 } as EditorState) : prev));
      }, 2600);
      await loadLists();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败';
      addNotice(msg, 'error');
      setEditor((prev) => (prev ? ({ ...prev, saving: false, error: msg } as EditorState) : prev));
    }
  };

  const handleDelete = async (kind: 'app' | 'workflow', id: string) => {
    if (!window.confirm('确定删除这个配置吗？此操作不可恢复。')) return;
    setError(null);
    try {
      const path = kind === 'workflow' ? `/api/runninghub/workflows/${encodeURIComponent(id)}` : `/api/runninghub/apps/${encodeURIComponent(id)}`;
      const res = await fetch(path, { method: 'DELETE', credentials: 'same-origin' });
      const data = await readJson(res);
      if (!res.ok || data.success === false) throw new Error(data.error || '删除失败');
      if (editor && editor.kind === kind && editor.id === id) closeEditor();
      await loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const toggleFieldEnabled = (fieldId: string) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const fields = prev.config.fields.map((f) => (f.id === fieldId ? { ...f, enabled: !f.enabled } : f));
      return { ...prev, dirty: true, saveOkUntil: 0, config: { ...prev.config, fields } } as EditorState;
    });
  };

  const updateField = (fieldId: string, patch: Partial<RhField>) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const fields = prev.config.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f));
      return { ...prev, dirty: true, saveOkUntil: 0, config: { ...prev.config, fields } } as EditorState;
    });
  };

  const reorderFields = (reordered: RhField[]) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const orderById = new Map(reordered.map((f) => [f.id, f.order]));
      const fields = prev.config.fields.map((f) => (orderById.has(f.id) ? { ...f, order: orderById.get(f.id)! } : f));
      return { ...prev, dirty: true, saveOkUntil: 0, config: { ...prev.config, fields } } as EditorState;
    });
  };

  const popoverField = editor?.config.fields.find((f) => f.id === popoverFieldId) || null;

  const allSortedFields = useMemo(() => (editor ? sortRhFields(editor.config.fields) : []), [editor]);
  const visibleFields = useMemo(
    () => (activeNodeId ? allSortedFields.filter((f) => String(f.nodeId) === String(activeNodeId)) : allSortedFields),
    [allSortedFields, activeNodeId]
  );

  if (!shellActive) return null;

  return (
    <div className="fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] custom-scrollbar">
      <main className="mx-auto max-w-5xl px-6 pb-16 pt-[5.5rem] md:px-10 md:pt-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <h1 className="font-serif text-3xl tracking-[-0.02em]" style={{ fontFamily: '"Noto Serif", ui-serif, Georgia, serif' }}>
            RunningHub 工作流
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[#e5e2e1]/65">
            管理画布「RH生成」节点可调用的 AI 应用与自定义工作流。粘贴 RunningHub 的 <code className="text-[#ffb866]/80">/run/ai-app/…</code> 或{' '}
            <code className="text-[#ffb866]/80">/run/workflow/…</code> 链接即可添加。
          </p>
        </motion.div>

        <form onSubmit={handleAdd} className="mt-8 flex flex-col gap-3 rounded-[1.5rem] bg-[#131313]/80 p-5 outline outline-[0.5px] outline-[#45464d]/20 sm:flex-row sm:items-center">
          <input
            type="text"
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder="粘贴 /run/ai-app/xxx 或 /run/workflow/xxx"
            className="min-w-0 flex-1 rounded-2xl bg-[#1c1b1b]/85 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
          />
          <button
            type="submit"
            disabled={adding || !pasteValue.trim()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#ffb866] to-[#b77100] px-5 py-3 text-sm font-medium text-[#1a1208] disabled:opacity-60"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            添加
          </button>
        </form>

        {error ? (
          <p className="mt-6 text-sm text-red-400/95" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-16 text-[#e5e2e1]/50">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : (
          <>
            <RhSection
              title="AI 应用"
              icon={Sparkles}
              emptyHint="粘贴 /run/ai-app/... 自动创建 AI 应用卡片"
              items={apps.map((a) => ({ id: a.appId, title: a.title, description: a.description, fieldCount: a.fieldCount, refLine: `/run/ai-app/${a.appId}` }))}
              onEdit={(id) => void openEditor('app', id)}
              onDelete={(id) => void handleDelete('app', id)}
            />
            <RhSection
              title="自定义工作流"
              icon={Workflow}
              emptyHint="粘贴 /run/workflow/... 自动创建工作流卡片"
              items={workflows.map((w) => ({ id: w.workflowId, title: w.title, description: w.description, fieldCount: w.fieldCount, refLine: `/run/workflow/${w.workflowId}` }))}
              onEdit={(id) => void openEditor('workflow', id)}
              onDelete={(id) => void handleDelete('workflow', id)}
            />
          </>
        )}
      </main>

      {editor
        ? createPortal(
            <AnimatePresence>
              <RhEditorOverlay
                editor={editor}
                allFields={allSortedFields}
                visibleFields={visibleFields}
                activeNodeId={activeNodeId}
                onNodeClick={(nodeId) => setActiveNodeId((prev) => (prev === nodeId ? null : nodeId))}
                onClose={closeEditor}
                onFetchRemote={() => void handleFetchRemote()}
                onSave={() => void handleSave()}
                onToggleField={toggleFieldEnabled}
                onReorderFields={reorderFields}
                onOpenFieldEditor={(fieldId, rect) => {
                  setPopoverFieldId(fieldId);
                  setPopoverAnchorRect(rect);
                }}
                onTitleChange={(title) => setEditor((prev) => (prev ? ({ ...prev, dirty: true, saveOkUntil: 0, config: { ...prev.config, title } } as EditorState) : prev))}
                onDescriptionChange={(description) =>
                  setEditor((prev) => (prev ? ({ ...prev, dirty: true, saveOkUntil: 0, config: { ...prev.config, description } } as EditorState) : prev))
                }
                onOptionalImageModeChange={(optionalImageMode) =>
                  setEditor((prev) => (prev && prev.kind === 'workflow' ? ({ ...prev, dirty: true, saveOkUntil: 0, config: { ...prev.config, optionalImageMode } }) : prev))
                }
              />
              {popoverField && popoverAnchorRect ? (
                <RhFieldEditorPopover
                  field={popoverField}
                  anchorRect={popoverAnchorRect}
                  isWorkflowMode={editor.kind === 'workflow'}
                  onChange={(patch) => updateField(popoverField.id, patch)}
                  onClose={() => setPopoverFieldId(null)}
                />
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </div>
  );
});

function RhSection({
  title,
  icon: Icon,
  emptyHint,
  items,
  onEdit,
  onDelete,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  emptyHint: string;
  items: Array<{ id: string; title: string; description: string; fieldCount: number; refLine: string }>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-[#e5e2e1]/70">
        <Icon className="h-4 w-4 text-[#ffb866]/80" />
        {title}
        <span className="text-xs text-[#e5e2e1]/40">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-2xl bg-[#131313]/50 py-10 text-center text-sm text-[#e5e2e1]/45">{emptyHint}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="group rounded-2xl bg-[#131313]/70 p-4 outline outline-[0.5px] outline-[#45464d]/15 transition-colors duration-200 hover:bg-[#171716]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-[#e5e2e1]">{item.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[#e5e2e1]/40">{item.refLine}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onEdit(item.id)}
                    title="编辑"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#e5e2e1]/60 hover:bg-[#1c1b1b] hover:text-[#ffb866]"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    title="删除"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#e5e2e1]/50 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {item.description ? <p className="mt-2 line-clamp-2 text-xs text-[#e5e2e1]/50">{item.description}</p> : null}
              <p className="mt-3 text-[11px] uppercase tracking-[0.1em] text-[#e5e2e1]/35">{item.fieldCount} 个参数</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RhEditorOverlay({
  editor,
  allFields,
  visibleFields,
  activeNodeId,
  onNodeClick,
  onClose,
  onFetchRemote,
  onSave,
  onToggleField,
  onReorderFields,
  onOpenFieldEditor,
  onTitleChange,
  onDescriptionChange,
  onOptionalImageModeChange,
}: {
  editor: EditorState;
  allFields: RhField[];
  visibleFields: RhField[];
  activeNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  onClose: () => void;
  onFetchRemote: () => void;
  onSave: () => void;
  onToggleField: (fieldId: string) => void;
  onReorderFields: (fields: RhField[]) => void;
  onOpenFieldEditor: (fieldId: string, rect: DOMRect) => void;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
  onOptionalImageModeChange: (mode: string) => void;
}) {
  const isWorkflow = editor.kind === 'workflow';
  const hasGraph = isWorkflow && Object.keys((editor.config as RhWorkflowConfig).workflowJson || {}).length > 0;
  const justSaved = editor.saveOkUntil > 0;
  return (
    <motion.div
      className="fixed inset-0 z-[95] flex flex-col bg-[#0e0e0e]/97 backdrop-blur-[24px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={spring}
    >
      <motion.div
        className="flex flex-col h-full"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={spring}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 bg-[#131313]/60 px-6 py-4 md:px-10">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#e5e2e1]">
              {editor.kind === 'workflow' ? '工作流配置' : 'AI 应用配置'}
            </p>
            <p className="truncate text-[11px] text-[#e5e2e1]/40">
              {editor.kind === 'workflow' ? `/run/workflow/${editor.id}` : `/run/ai-app/${editor.id}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onFetchRemote}
              disabled={editor.fetching}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1c1b1b] px-3.5 py-2 text-xs text-[#e5e2e1]/75 hover:text-[#e5e2e1] disabled:opacity-60"
            >
              {editor.fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              重新拉取
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={editor.saving}
              className={cn(
                'relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-all duration-300 disabled:opacity-60',
                justSaved
                  ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-[#0e0e0e]'
                  : 'bg-gradient-to-br from-[#ffb866] to-[#b77100] text-[#1a1208]',
                editor.dirty && !editor.saving && !justSaved && 'shadow-[0_0_0_3px_rgba(255,184,102,0.22)]'
              )}
            >
              {editor.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : justSaved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {editor.saving ? '保存中…' : justSaved ? '已保存' : editor.dirty ? '保存更改' : '保存'}
              {editor.dirty && !editor.saving && !justSaved ? (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#ffb866] ring-2 ring-[#0e0e0e]" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#e5e2e1]/55 hover:bg-[#1c1b1b] hover:text-[#e5e2e1]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 md:px-10">
          {editor.loading ? (
            <div className="flex justify-center py-16 text-[#e5e2e1]/50">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-[1680px] gap-8 md:grid-cols-[420px_1fr]">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">名称</span>
                  <input
                    type="text"
                    value={editor.config.title}
                    onChange={(e) => onTitleChange(e.target.value)}
                    className="w-full rounded-2xl bg-[#131313]/80 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">备注</span>
                  <textarea
                    value={editor.config.description}
                    onChange={(e) => onDescriptionChange(e.target.value)}
                    rows={4}
                    placeholder="用途、参数说明…"
                    className="w-full resize-none rounded-2xl bg-[#131313]/80 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
                  />
                </label>
                {editor.error ? <p className="text-sm text-red-400/95">{editor.error}</p> : null}

                <RhLivePreviewPanel
                  mode={editor.kind}
                  refId={editor.id}
                  title={editor.config.title}
                  fields={allFields}
                  workflowJson={isWorkflow ? (editor.config as RhWorkflowConfig).workflowJson : undefined}
                  optionalImageMode={isWorkflow ? (editor.config as RhWorkflowConfig).optionalImageMode : undefined}
                  onOptionalImageModeChange={onOptionalImageModeChange}
                  onReorderFields={onReorderFields}
                />
              </div>

              <div className="space-y-6">
                {hasGraph ? (
                  <div>
                    <h3 className="mb-3 text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">
                      节点图{activeNodeId ? `（已筛选节点 #${activeNodeId}，再次点击取消）` : '（点击节点筛选参数）'}
                    </h3>
                    <div className="h-[420px]">
                      <RhWorkflowGraph
                        workflowJson={(editor.config as RhWorkflowConfig).workflowJson}
                        fields={allFields}
                        activeNodeId={activeNodeId}
                        onNodeClick={onNodeClick}
                      />
                    </div>
                  </div>
                ) : null}

                <div>
                  <h3 className="mb-3 text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">
                    参数列表（{allFields.filter((f) => f.enabled).length}/{allFields.length} 已开放）
                  </h3>
                  {visibleFields.length === 0 ? (
                    <p className="rounded-2xl bg-[#131313]/50 py-10 text-center text-sm text-[#e5e2e1]/45">
                      {allFields.length === 0 ? '还没有参数，点右上角「重新拉取」从 RunningHub 获取。' : '该节点没有可编辑参数。'}
                    </p>
                  ) : (
                  <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
                    {visibleFields.map((field) => (
                      <li
                        key={field.id}
                        className={cn(
                          'flex items-center gap-3 rounded-2xl bg-[#131313]/70 px-4 py-3 outline outline-[0.5px] outline-[#45464d]/15 transition-opacity',
                          !field.enabled && 'opacity-50'
                        )}
                      >
                        <button
                          type="button"
                          role="switch"
                          aria-checked={field.enabled}
                          onClick={() => onToggleField(field.id)}
                          className={cn(
                            'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                            field.enabled ? 'bg-[#ffb866]' : 'bg-[#2a2928]'
                          )}
                        >
                          <span
                            className={cn(
                              'absolute top-0.5 h-4 w-4 rounded-full bg-[#0e0e0e] transition-transform',
                              field.enabled ? 'translate-x-4' : 'translate-x-0.5'
                            )}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => onOpenFieldEditor(field.id, e.currentTarget.getBoundingClientRect())}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm text-[#e5e2e1] hover:text-[#ffb866]">{field.label || field.fieldName}</p>
                          <p className="truncate text-[11px] text-[#e5e2e1]/40">
                            {field.group ? `${field.group} · ` : ''}
                            {field.fieldValue ? field.fieldValue.slice(0, 60) : '（空）'}
                          </p>
                        </button>
                        <span className="shrink-0 rounded-full bg-[#1c1b1b] px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-[#e5e2e1]/55">
                          {RH_FIELD_TYPE_LABELS[rhWorkflowFieldKind(field)] || field.fieldType}
                        </span>
                      </li>
                    ))}
                  </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
