import React from 'react';
import { createPortal } from 'react-dom';
import { Dice5, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { RH_FIELD_TYPE_LABELS, rhWorkflowFieldKind, type RhField, type RhFieldType } from '../lib/runningHubAdmin';

const FIELD_TYPES: RhFieldType[] = ['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'IMAGE', 'VIDEO', 'AUDIO'];
const POPOVER_WIDTH = 340;

/**
 * 悬浮字段编辑器：覆盖 TEXT/NUMBER/BOOLEAN/SELECT/IMAGE/VIDEO/AUDIO 全部控件。
 * 逻辑对齐旧版 canvas_source/static/js/api-settings.js 的 renderRhWorkflowEditorField。
 */
export function RhFieldEditorPopover({
  field,
  anchorRect,
  isWorkflowMode,
  onChange,
  onClose,
}: {
  field: RhField;
  anchorRect: DOMRect;
  isWorkflowMode: boolean;
  onChange: (patch: Partial<RhField>) => void;
  onClose: () => void;
}) {
  let left = anchorRect.right + 12;
  let top = anchorRect.top;
  if (left + POPOVER_WIDTH > window.innerWidth - 16) left = Math.max(16, anchorRect.left - POPOVER_WIDTH - 12);
  top = Math.max(74, Math.min(top, window.innerHeight - 480));

  return createPortal(
    <>
      <div className="fixed inset-0 z-[95]" onClick={onClose} />
      <div
        className="fixed z-[96] max-h-[70vh] w-[340px] overflow-y-auto custom-scrollbar rounded-2xl bg-[#1c1b1b] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)] outline outline-[0.5px] outline-[#45464d]/25"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-[#e5e2e1]">{field.label || field.fieldName}</p>
            <p className="truncate text-[11px] text-[#e5e2e1]/40">{field.fieldName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#e5e2e1]/55 hover:bg-[#262524] hover:text-[#e5e2e1]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.1em] text-[#e5e2e1]/45">显示名称</span>
            <input
              type="text"
              value={field.label}
              placeholder="显示名称"
              onChange={(e) => onChange({ label: e.target.value })}
              className="w-full rounded-xl bg-[#131313]/80 px-3 py-2 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.1em] text-[#e5e2e1]/45">字段类型</span>
            <select
              value={rhWorkflowFieldKind(field)}
              onChange={(e) => onChange({ fieldType: e.target.value })}
              className="w-full rounded-xl bg-[#131313]/80 px-3 py-2 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RH_FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => onChange({ sourceFromUpstream: !field.sourceFromUpstream })}
            className={cn(
              'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors',
              field.sourceFromUpstream ? 'bg-[#131313]/80 text-[#e5e2e1]/65' : 'bg-[#ffb866]/15 text-[#ffb866]'
            )}
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', field.sourceFromUpstream ? 'bg-[#e5e2e1]/40' : 'bg-[#ffb866]')} />
            {field.sourceFromUpstream ? '保留工作流原设置' : '暴露并覆盖参数'}
          </button>

          {isWorkflowMode && rhWorkflowFieldKind(field) === 'IMAGE' ? (
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="mb-1.5 block text-[11px] uppercase tracking-[0.1em] text-[#e5e2e1]/45">排序</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={field.imageOrder || ''}
                  onChange={(e) => onChange({ imageOrder: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-full rounded-xl bg-[#131313]/80 px-3 py-2 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
                />
              </label>
              <button
                type="button"
                onClick={() => onChange({ required: !field.required })}
                className={cn(
                  'shrink-0 rounded-xl px-3 py-2 text-xs',
                  field.required ? 'bg-[#ffb866]/15 text-[#ffb866]' : 'bg-[#131313]/80 text-[#e5e2e1]/60'
                )}
              >
                {field.required ? '必选' : '可选'}
              </button>
            </div>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.1em] text-[#e5e2e1]/45">下拉选项（每行一个）</span>
            <textarea
              rows={3}
              value={field.options.join('\n')}
              placeholder="例如 1024x1024"
              onChange={(e) =>
                onChange({
                  options: e.target.value
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="w-full resize-none rounded-xl bg-[#131313]/80 px-3 py-2 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ random_enabled: !field.random_enabled })}
              title="随机数"
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs',
                field.random_enabled ? 'bg-[#ffb866]/15 text-[#ffb866]' : 'bg-[#131313]/80 text-[#e5e2e1]/60'
              )}
            >
              <Dice5 className="h-3.5 w-3.5" />
            </button>
            <input
              type="number"
              value={field.min as number | string}
              placeholder="最小"
              onChange={(e) => onChange({ min: e.target.value })}
              className="w-full min-w-0 rounded-xl bg-[#131313]/80 px-3 py-2 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            />
            <input
              type="number"
              value={field.max as number | string}
              placeholder="最大"
              onChange={(e) => onChange({ max: e.target.value })}
              className="w-full min-w-0 rounded-xl bg-[#131313]/80 px-3 py-2 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            />
            <input
              type="number"
              value={field.step as number | string}
              placeholder="步长"
              onChange={(e) => onChange({ step: e.target.value })}
              className="w-full min-w-0 rounded-xl bg-[#131313]/80 px-3 py-2 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            />
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
