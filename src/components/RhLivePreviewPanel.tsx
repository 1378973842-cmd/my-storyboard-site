import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Dices, FileAudio, FileVideo, GripVertical, ImageIcon, Loader2, Lock, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import { rhPreviewRandomValue, rhWorkflowFieldKey, rhWorkflowFieldKind, formatRhApiError, rhSubmitFieldValue, summarizeRhTaskError, type RhField } from '../lib/runningHubAdmin';

const cardSpring = { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.85 };

type DragSlot = { insertAt: number; x: number; y: number };

/** 按视觉位置（上→下、左→右）收集各卡片的插入锚点，用离指针最近的锚点决定落位——比包围盒碰撞更稳，宽卡片也不会误判。 */
function collectDragSlots(orderIds: string[], dragId: string, refs: Map<string, HTMLDivElement>): DragSlot[] {
  const items = orderIds
    .filter((id) => id !== dragId)
    .map((id) => {
      const el = refs.get(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { id, rect, orderIdx: orderIds.indexOf(id) };
    })
    .filter(Boolean) as { id: string; rect: DOMRect; orderIdx: number }[];

  items.sort((a, b) => {
    const rowA = Math.round(a.rect.top / 12);
    const rowB = Math.round(b.rect.top / 12);
    if (rowA !== rowB) return rowA - rowB;
    return a.rect.left - b.rect.left;
  });

  const slots: DragSlot[] = [];
  items.forEach((item) => {
    const r = item.rect;
    slots.push({ insertAt: item.orderIdx, x: r.left - 4, y: r.top + r.height / 2 });
    slots.push({ insertAt: item.orderIdx + 1, x: r.right + 4, y: r.top + r.height / 2 });
  });
  return slots;
}

function nearestInsertIndex(px: number, py: number, slots: DragSlot[]): number {
  if (!slots.length) return 0;
  let best = slots[0].insertAt;
  let bestDist = Infinity;
  slots.forEach((slot) => {
    const dist = Math.hypot(px - slot.x, py - slot.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = slot.insertAt;
    }
  });
  return best;
}

function moveIdInOrder(orderIds: string[], dragId: string, targetIndex: number): string[] {
  const fromIdx = orderIds.indexOf(dragId);
  if (fromIdx === -1) return orderIds;
  let toIdx = Math.max(0, Math.min(orderIds.length, targetIndex));
  if (toIdx > fromIdx) toIdx -= 1;
  if (toIdx === fromIdx) return orderIds;
  const next = [...orderIds];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, dragId);
  return next;
}

function buildReorderedFields(orderIds: string[], fields: RhField[], enabledFields: RhField[]): RhField[] {
  const byId = new Map(enabledFields.map((f) => [f.id, f]));
  const reordered = orderIds.map((id) => byId.get(id)).filter(Boolean) as RhField[];
  const enabledIds = new Set(reordered.map((f) => f.id));
  const rest = fields.filter((f) => !enabledIds.has(f.id));
  return [...reordered, ...rest].map((f, i) => ({ ...f, order: i }));
}

type PreviewParam = {
  value?: string;
  url?: string;
  name?: string;
  kind?: string;
  uploading?: boolean;
  randomActive?: boolean;
};

function isMediaKind(kind: string) {
  return kind === 'IMAGE' || kind === 'VIDEO' || kind === 'AUDIO';
}

function mediaAccept(kind: string) {
  if (kind === 'VIDEO') return 'video/*';
  if (kind === 'AUDIO') return 'audio/*';
  return 'image/*';
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** 把本地/远程 URL 上传到 RunningHub 素材库，返回 fileName（供 nodeInfoList 提交使用）。ponytail: 纯文本值原样透传，不做合法性校验。 */
async function uploadValueIfNeeded(value: string): Promise<string> {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text) && !text.startsWith('/output/') && !text.startsWith('/uploads/')) return text;
  const res = await fetch('/api/runninghub/upload-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ url: text }),
  });
  const data = await readJson(res);
  if (!res.ok || data.success === false) throw new Error(formatRhApiError(data.error, 'RunningHub 素材上传失败'));
  return data.data?.fileName || text;
}

function pruneWorkflowJson(
  workflowJson: Record<string, unknown>,
  fields: RhField[],
  submittedKeys: Set<string>
): Record<string, unknown> | null {
  const missing = fields.filter(
    (f) => f.enabled && rhWorkflowFieldKind(f) === 'IMAGE' && f.required !== true && !submittedKeys.has(rhWorkflowFieldKey(f))
  );
  if (!missing.length || !workflowJson || !Object.keys(workflowJson).length) return null;
  const workflow = JSON.parse(JSON.stringify(workflowJson)) as Record<string, any>;
  const removeIds = new Set<string>();
  missing.forEach((field) => {
    const node = workflow[String(field.nodeId)];
    if (node?.inputs && Object.prototype.hasOwnProperty.call(node.inputs, field.fieldName)) delete node.inputs[field.fieldName];
    if (node?.inputs && !Object.keys(node.inputs).length) removeIds.add(String(field.nodeId));
  });
  removeIds.forEach((id) => delete workflow[id]);
  Object.values(workflow).forEach((node: any) => {
    Object.entries(node?.inputs || {}).forEach(([name, value]) => {
      if (Array.isArray(value) && removeIds.has(String(value[0]))) delete node.inputs[name];
    });
  });
  return workflow;
}

function renderOutput(url: string, key: string) {
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) {
    return (
      <video key={key} src={url} controls muted playsInline preload="metadata" className="max-h-[420px] w-full rounded-xl bg-[#0e0e0e] object-contain" />
    );
  }
  if (/\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(url)) return <audio key={key} src={url} controls preload="metadata" className="w-full" />;
  return <img key={key} src={url} alt="" className="max-h-[420px] w-full rounded-xl bg-[#0e0e0e] object-contain" />;
}

export function RhLivePreviewPanel({
  mode,
  refId,
  title,
  fields,
  workflowJson,
  optionalImageMode,
  onOptionalImageModeChange,
  onReorderFields,
  onFieldNoteChange,
}: {
  mode: 'app' | 'workflow';
  refId: string;
  title: string;
  fields: RhField[];
  workflowJson?: Record<string, unknown>;
  optionalImageMode?: string;
  onOptionalImageModeChange?: (mode: string) => void;
  /** 测试面板里拖拽卡片调整顺序后，把完整字段数组（已重新赋值 order）回传给上层，随「保存」一并持久化。 */
  onReorderFields?: (fields: RhField[]) => void;
  /** 卡片下方「参数说明」直接可编辑，随「保存」一并持久化到 field.note（测试面板与画布 RH 节点共用同一份说明）。 */
  onFieldNoteChange?: (fieldId: string, note: string) => void;
}) {
  const [params, setParams] = useState<Record<string, PreviewParam>>({});
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [outputs, setOutputs] = useState<string[]>([]);
  const stopRef = useRef(false);

  const enabledFields = useMemo(
    () => fields.filter((f) => f.enabled).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [fields]
  );

  // 拖拽排序：拖动过程中只在组件内维护 orderIds，松手后再一次性写回上层。
  // 这样拖动时不会触发父组件重渲染，浮动镖片跟手、网格 FLIP 动画都不会被打断。
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ id: string; startRect: DOMRect; startX: number; startY: number } | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOrderIds, setDragOrderIds] = useState<string[] | null>(null);
  const [dragHoverId, setDragHoverId] = useState<string | null>(null);

  const displayFields = useMemo(() => {
    const orderIds = dragOrderIds ?? enabledFields.map((f) => f.id);
    const byId = new Map(enabledFields.map((f) => [f.id, f]));
    return orderIds.map((id) => byId.get(id)).filter(Boolean) as RhField[];
  }, [enabledFields, dragOrderIds]);

  const prevUserSelectRef = useRef<string | null>(null);
  const suppressSelection = (on: boolean) => {
    if (on) {
      prevUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      (document.body.style as any).webkitUserSelect = 'none';
    } else {
      document.body.style.userSelect = prevUserSelectRef.current || '';
      (document.body.style as any).webkitUserSelect = prevUserSelectRef.current || '';
      prevUserSelectRef.current = null;
    }
  };

  const commitDragOrder = () => {
    const orderIds = dragOrderRef.current;
    if (!orderIds || !onReorderFields) return;
    const baseline = enabledFields.map((f) => f.id).join('|');
    const next = orderIds.join('|');
    if (baseline !== next) onReorderFields(buildReorderedFields(orderIds, fields, enabledFields));
  };

  const endDrag = (commit = false) => {
    if (commit) commitDragOrder();
    dragStateRef.current = null;
    dragOrderRef.current = null;
    setDragId(null);
    setDragOrderIds(null);
    setDragHoverId(null);
    suppressSelection(false);
  };

  const handleGripPointerDown = (e: React.PointerEvent<HTMLButtonElement>, fieldId: string) => {
    e.preventDefault();
    e.stopPropagation();
    window.getSelection?.()?.removeAllRanges();
    const rect = cardRefs.current.get(fieldId)?.getBoundingClientRect();
    if (!rect) return;
    const order = enabledFields.map((f) => f.id);
    suppressSelection(true);
    try {
      (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragStateRef.current = { id: fieldId, startRect: rect, startX: e.clientX, startY: e.clientY };
    dragOrderRef.current = order;
    setDragOrderIds(order);
    setDragId(fieldId);
  };

  const handleGripPointerMove = (e: React.PointerEvent<HTMLButtonElement>, fieldId: string) => {
    const drag = dragStateRef.current;
    const order = dragOrderRef.current;
    if (!drag || !order || drag.id !== fieldId) return;
    e.preventDefault();
    if (ghostRef.current) {
      ghostRef.current.style.transform = `translate(${e.clientX - drag.startX}px, ${e.clientY - drag.startY}px)`;
    }
    const slots = collectDragSlots(order, fieldId, cardRefs.current);
    const insertAt = nearestInsertIndex(e.clientX, e.clientY, slots);
    const nextOrder = moveIdInOrder(order, fieldId, insertAt);
    if (nextOrder.join('|') !== order.join('|')) {
      dragOrderRef.current = nextOrder;
      setDragOrderIds(nextOrder);
    }
    let hoverId: string | null = null;
    let hoverDist = Infinity;
    order
      .filter((id) => id !== fieldId)
      .forEach((id) => {
        const el = cardRefs.current.get(id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (dist < hoverDist) {
          hoverDist = dist;
          hoverId = id;
        }
      });
    setDragHoverId(hoverId);
  };

  const handleGripPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    try {
      (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    endDrag(true);
  };

  useEffect(() => {
    if (!dragId) return;
    const release = () => endDrag(true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('blur', release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);
  const counts = useMemo(
    () =>
      enabledFields.reduce(
        (acc, f) => {
          const kind = rhWorkflowFieldKind(f);
          if (kind === 'IMAGE') acc.image += 1;
          else if (kind === 'VIDEO') acc.video += 1;
          else if (kind === 'AUDIO') acc.audio += 1;
          else acc.setting += 1;
          return acc;
        },
        { image: 0, video: 0, audio: 0, setting: 0 }
      ),
    [enabledFields]
  );

  const updateValue = (key: string, value: string) => {
    setParams((prev) => ({ ...prev, [key]: { ...prev[key], value, randomActive: false } }));
  };

  const toggleRandom = (key: string, field: RhField) => {
    setParams((prev) => {
      const state = prev[key] || {};
      return { ...prev, [key]: { ...state, value: state.value ?? field.fieldValue ?? '', randomActive: state.randomActive === false } };
    });
  };

  const pickMedia = (key: string, kind: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = mediaAccept(kind);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const localUrl = URL.createObjectURL(file);
      setParams((prev) => ({ ...prev, [key]: { ...prev[key], url: localUrl, name: file.name, uploading: true } }));
      const form = new FormData();
      form.append('files', file);
      try {
        const data = await fetch('/api/ai/upload', { method: 'POST', credentials: 'same-origin', body: form }).then(async (r) => {
          const json = await readJson(r);
          if (!r.ok) throw new Error(formatRhApiError(json.error, '上传失败'));
          return json;
        });
        const uploaded = data.files?.[0];
        setParams((prev) => ({
          ...prev,
          [key]: { ...prev[key], url: uploaded?.url || localUrl, name: uploaded?.name || file.name, kind: uploaded?.kind || kind.toLowerCase(), uploading: false },
        }));
      } catch (e) {
        setParams((prev) => ({ ...prev, [key]: { ...prev[key], uploading: false } }));
        window.alert(formatRhApiError(e, '上传失败'));
      }
    };
    input.click();
  };

  const buildNodeInfoList = async (): Promise<{ nodeId: string; fieldName: string; fieldValue: unknown }[]> => {
    const result: { nodeId: string; fieldName: string; fieldValue: unknown }[] = [];
    for (const field of enabledFields) {
      const key = rhWorkflowFieldKey(field);
      const kind = rhWorkflowFieldKind(field);
      if (field.sourceFromUpstream === false && !isMediaKind(kind)) continue;
      const preview = params[key] || {};
      let value: unknown = preview.value ?? field.fieldValue ?? '';
      if (isMediaKind(kind)) {
        if (mode === 'workflow' && kind === 'IMAGE' && field.required !== true && !preview.url) continue;
        if (mode === 'workflow' && kind === 'IMAGE' && field.required === true && !preview.url && !value) {
          throw new Error(`缺少必选图片：${field.label || field.fieldName}`);
        }
        if (mode === 'app' && !preview.url && !String(value).trim()) {
          throw new Error(`请先上传：${field.label || field.fieldName}`);
        }
        value = await uploadValueIfNeeded(String(preview.url || value));
      } else if (kind === 'NUMBER' && field.random_enabled === true && preview.randomActive !== false) {
        value = rhPreviewRandomValue(field);
      }
      if (typeof value === 'string' && /[\r\n]/.test(value)) {
        value = value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
      }
      result.push({ nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: rhSubmitFieldValue(value) });
    }
    return result;
  };

  const runTest = async () => {
    if (running) return;
    setRunning(true);
    setStatus('正在提交 RunningHub 任务...');
    setOutputs([]);
    stopRef.current = false;
    try {
      const nodeInfoList = await buildNodeInfoList();
      const endpoint = mode === 'workflow' ? '/api/runninghub/workflow-submit' : '/api/runninghub/submit';
      let body: Record<string, unknown>;
      if (mode === 'workflow') {
        if (!refId) throw new Error('workflowId 为空');
        const mode2 = optionalImageMode || 'prune-workflow';
        const prunedWorkflow = mode2 === 'prune-workflow' && workflowJson
          ? pruneWorkflowJson(workflowJson, fields, new Set(nodeInfoList.map((n) => `${n.nodeId}::${n.fieldName}`)))
          : null;
        body = { workflowId: refId, nodeInfoList, ...(prunedWorkflow ? { workflow: prunedWorkflow } : {}) };
      } else {
        if (!refId) throw new Error('webappId 为空');
        body = { webappId: refId, nodeInfoList };
      }
      const submit = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      }).then(async (r) => {
        const data = await readJson(r);
        if (!r.ok || data.success === false) throw new Error(formatRhApiError(data.error, 'RunningHub 提交失败'));
        return data.data || data;
      });
      const taskId = rhSubmitFieldValue(submit?.taskId).trim();
      if (!taskId) throw new Error('RunningHub 没有返回 taskId');
      setStatus(`任务已提交：${taskId}`);
      let result: any = null;
      for (let i = 0; i < 720; i++) {
        if (stopRef.current) return;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const data = await fetch(`/api/runninghub/query?taskId=${encodeURIComponent(taskId)}`, { credentials: 'same-origin' }).then(async (r) => {
          const json = await readJson(r);
          if (!r.ok || json.success === false) throw new Error(formatRhApiError(json.error, 'RunningHub 查询失败'));
          return json.data || json;
        });
        if (data.status === 'SUCCESS') {
          result = data;
          break;
        }
        if (data.status === 'FAILED') throw new Error(summarizeRhTaskError(data.failReason || data.raw));
        if (data.status === 'QUEUED' || data.status === 'RUNNING') {
          setStatus(data.status === 'QUEUED' ? '排队中...' : '运行中...');
          continue;
        }
        throw new Error(
          summarizeRhTaskError(data.failReason || data.raw)
          || `RunningHub 状态异常 ${data.status || 'UNKNOWN'}（code=${data.code ?? '?'}）`
        );
      }
      if (!result) throw new Error('RunningHub 任务超时');
      const resultUrls: string[] = Array.isArray(result.urls) ? result.urls : [];
      if (!resultUrls.length) throw new Error('RunningHub 没有返回产物');
      setOutputs(resultUrls);
      setStatus('测试完成');
    } catch (e) {
      const msg = summarizeRhTaskError(e instanceof Error ? e.message : e);
      setStatus(msg);
    } finally {
      setRunning(false);
    }
  };

  const buildFieldCard = (field: RhField) => {
    const key = rhWorkflowFieldKey(field);
    const kind = rhWorkflowFieldKind(field);
    const label = field.label || field.fieldName;
    const meaning = field.note && field.note !== label ? field.note : '';
    const preview = params[key] || {};

    let wide = false;
    let inner: React.ReactNode;

    if (field.sourceFromUpstream === false && !isMediaKind(kind)) {
      inner = (
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-xs text-[#e5e2e1]/70">{label}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[#e5e2e1]/35">
            <Lock className="h-3 w-3" />
            保留原设置
          </span>
        </div>
      );
    } else if (isMediaKind(kind)) {
      const Icon = kind === 'VIDEO' ? FileVideo : kind === 'AUDIO' ? FileAudio : ImageIcon;
      inner = (
        <>
          <div className="mb-2 flex items-center justify-between text-xs text-[#e5e2e1]/70">
            <span className="truncate">{label}</span>
            {mode === 'workflow' && kind === 'IMAGE' ? (
              <span className="shrink-0 text-[10px] text-[#e5e2e1]/40">
                图 {field.imageOrder || 1} · {field.required ? '必选' : '可选'}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => pickMedia(key, kind)}
            className={cn(
              'flex h-24 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-[#1c1b1b] text-xs text-[#e5e2e1]/50 hover:text-[#e5e2e1]',
              preview.url && 'p-0'
            )}
          >
            {preview.uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : preview.url ? (
              kind === 'VIDEO' ? (
                <video src={preview.url} muted preload="metadata" playsInline controls className="h-full w-full object-contain" />
              ) : kind === 'AUDIO' ? (
                <span className="flex items-center gap-2 px-2">
                  <FileAudio className="h-5 w-5" />
                  {preview.name || '音频'}
                </span>
              ) : (
                <img src={preview.url} alt="" className="h-full w-full object-contain" />
              )
            ) : (
              <>
                <Icon className="h-5 w-5" />
                点击上传
              </>
            )}
          </button>
        </>
      );
    } else if (kind === 'BOOLEAN') {
      const on = String(preview.value ?? field.fieldValue ?? '').toLowerCase() === 'true';
      inner = (
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-xs text-[#e5e2e1]/70">{label}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => updateValue(key, on ? 'false' : 'true')}
            className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-[#ffb866]' : 'bg-[#2a2928]')}
          >
            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-[#0e0e0e] transition-transform', on ? 'translate-x-4' : 'translate-x-0.5')} />
          </button>
        </div>
      );
    } else if (field.options?.length || kind === 'SELECT') {
      const options = field.options?.length ? field.options : [field.fieldValue || '选项'];
      const value = preview.value ?? field.fieldValue ?? options[0];
      inner = (
        <>
          <p className="mb-1.5 truncate text-xs text-[#e5e2e1]/70">{label}</p>
          <select
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            className="w-full rounded-lg bg-[#1c1b1b] px-3 py-2 text-xs text-[#e5e2e1] outline-none"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </>
      );
    } else {
      const randomActive = field.random_enabled === true && preview.randomActive !== false;
      const value = preview.value ?? field.fieldValue ?? '';
      wide = kind !== 'NUMBER';
      inner = (
        <>
          <p className="mb-1.5 truncate text-xs text-[#e5e2e1]/70">{label}</p>
          <div className="flex items-center gap-2">
            <input
              type={kind === 'NUMBER' ? 'number' : 'text'}
              value={randomActive ? '' : value}
              disabled={randomActive}
              placeholder={kind === 'NUMBER' && randomActive ? '随机数' : ''}
              onChange={(e) => updateValue(key, e.target.value)}
              className="min-w-0 flex-1 rounded-lg bg-[#1c1b1b] px-3 py-2 text-xs text-[#e5e2e1] outline-none disabled:opacity-50"
            />
            {kind === 'NUMBER' && field.random_enabled ? (
              <button
                type="button"
                onClick={() => toggleRandom(key, field)}
                title={randomActive ? '使用随机数' : '使用固定数'}
                className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', randomActive ? 'bg-[#ffb866] text-[#1a1208]' : 'bg-[#1c1b1b] text-[#e5e2e1]/50')}
              >
                <Dices className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </>
      );
    }

    return { wide, inner, meaning };
  };

  const dragField = dragId ? enabledFields.find((f) => f.id === dragId) || null : null;
  const dragCard = dragField ? buildFieldCard(dragField) : null;

  return (
    <div className="rounded-[1.25rem] bg-[#131313]/80 p-5 outline outline-[0.5px] outline-[#45464d]/20">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1c1b1b] text-[#ffb866]">
          <Play className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-[#e5e2e1]">{title}</p>
          <p className="truncate text-[11px] text-[#e5e2e1]/40">{mode === 'app' ? `/run/ai-app/${refId}` : `/run/workflow/${refId}`}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#e5e2e1]/45">
        <span>图片 {counts.image}</span>
        <span>视频 {counts.video}</span>
        <span>音频 {counts.audio}</span>
        <span>参数 {counts.setting}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3" onDragStartCapture={(e) => e.preventDefault()}>
        {displayFields.length === 0 ? (
          <p className="col-span-2 rounded-xl bg-[#0e0e0e]/50 py-6 text-center text-xs text-[#e5e2e1]/40">勾选左侧参数后，这里会显示测试输入</p>
        ) : (
          displayFields.map((field) => {
            const { wide, inner, meaning } = buildFieldCard(field);
            const isDragging = dragId === field.id;
            const isHoverTarget = dragHoverId === field.id;
            return (
              <motion.div
                key={field.id}
                layout={isDragging ? false : 'position'}
                transition={cardSpring}
                ref={(el) => {
                  if (el) cardRefs.current.set(field.id, el);
                  else cardRefs.current.delete(field.id);
                }}
                data-field-id={field.id}
                className={cn(
                  'group relative rounded-xl bg-[#0e0e0e]/40 py-2.5 pl-3.5 pr-7 transition-[opacity,box-shadow] duration-150',
                  wide && 'col-span-2',
                  isDragging && 'pointer-events-none opacity-0',
                  isHoverTarget && 'shadow-[inset_0_0_0_1px_rgba(255,184,102,0.45)]'
                )}
              >
                <button
                  type="button"
                  onPointerDown={(e) => handleGripPointerDown(e, field.id)}
                  onPointerMove={(e) => handleGripPointerMove(e, field.id)}
                  onPointerUp={handleGripPointerUp}
                  onPointerCancel={handleGripPointerUp}
                  title="拖拽调整顺序"
                  className="absolute right-1.5 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 cursor-grab touch-none select-none items-center justify-center rounded text-[#e5e2e1]/0 transition-colors group-hover:text-[#e5e2e1]/30 hover:!text-[#ffb866] active:cursor-grabbing"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
                {inner}
                {onFieldNoteChange ? (
                  <input
                    type="text"
                    defaultValue={meaning}
                    placeholder="写一句参数说明，画布节点里也会显示…"
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => onFieldNoteChange(field.id, e.target.value.trim())}
                    className="mt-1.5 w-full truncate bg-transparent text-[10px] leading-relaxed text-[#e5e2e1]/40 outline-none placeholder:text-[#e5e2e1]/25 focus:text-[#ffb866]/80"
                  />
                ) : meaning ? (
                  <p className="mt-1.5 truncate text-[10px] leading-relaxed text-[#e5e2e1]/35">{meaning}</p>
                ) : null}
              </motion.div>
            );
          })
        )}
      </div>

      {dragField && dragCard && dragStateRef.current
        ? createPortal(
            <div
              ref={ghostRef}
              style={{
                position: 'fixed',
                left: dragStateRef.current.startRect.left,
                top: dragStateRef.current.startRect.top,
                width: dragStateRef.current.startRect.width,
                height: dragStateRef.current.startRect.height,
                zIndex: 200,
                pointerEvents: 'none',
              }}
              className="scale-[1.03] rounded-xl bg-[#1c1b1b] py-2.5 pl-3.5 pr-7 shadow-[0_28px_60px_-24px_rgba(0,0,0,.65)] ring-1 ring-[#ffb866]/55"
            >
              {dragCard.inner}
              {dragCard.meaning ? <p className="mt-1.5 truncate text-[10px] leading-relaxed text-[#e5e2e1]/35">{dragCard.meaning}</p> : null}
            </div>,
            document.body
          )
        : null}

      {mode === 'workflow' ? (
        <div className="mt-4 rounded-xl bg-[#0e0e0e]/40 px-3.5 py-2.5">
          <label className="flex items-center justify-between gap-3 text-xs text-[#e5e2e1]/70">
            <span>空可选图</span>
            <select
              value={optionalImageMode || 'prune-workflow'}
              onChange={(e) => onOptionalImageModeChange?.(e.target.value)}
              className="rounded-lg bg-[#1c1b1b] px-3 py-1.5 text-xs text-[#e5e2e1] outline-none"
            >
              <option value="prune-workflow">裁剪 workflow JSON</option>
              <option value="skip">不提交字段</option>
            </select>
          </label>
          <p className="mt-1.5 text-[10px] leading-relaxed text-[#e5e2e1]/35">可选图片为空时，裁剪模式会移除该图片输入及相关连接。</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void runTest()}
        disabled={running}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#ffb866] to-[#b77100] py-2.5 text-xs font-medium text-[#1a1208] disabled:opacity-60"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {running ? '测试中...' : '测试'}
      </button>

      {status ? (
        <p className={cn('mt-3 text-xs leading-relaxed', status.includes('没有收到输入') || status.includes('执行失败') || status.includes('失败') ? 'text-red-300/90' : 'text-[#e5e2e1]/55')}>
          {status}
        </p>
      ) : null}
      {outputs.length ? (
        <div className="mt-3 space-y-2 rounded-xl bg-[#0e0e0e]/40 p-3">
          <p className="text-[11px] uppercase tracking-[0.1em] text-[#e5e2e1]/40">生成结果</p>
          {outputs.map((url, i) => renderOutput(url, `${url}-${i}`))}
        </div>
      ) : null}
    </div>
  );
}
