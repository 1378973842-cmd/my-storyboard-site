import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Hand,
  Film,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  Maximize2,
  Mic,
  MoreHorizontal,
  Move,
  Paperclip,
  PanelRight,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { isInfiniteCanvasEditorOpen, flushCanvasAgentSave, withCanvasAgentNode } from '../../../lib/infiniteCanvas/canvasEngine.js';
import { CANVAS_GENERATOR_TYPES, batchApplyChanges, getCanvasSnapshot, nodeLabelsFor } from '../core/canvasFacade';
import { inferAppliedPlaybookStage } from '../core/stageLedger';
import { referenceClampLabels, mentionTitleToStore, referenceCapsuleLabel } from '../core/referencePrompt';
import { approveRunCard, parseAskAnswer, parseAskAnswers } from '../core/askCard';
import { pendingExecutionFeedback, proposalWaitsForClick } from '../core/proposal';
import {
  deliverProposalDone,
  diskProposalOutcome,
  flushProposalWriteQueue,
  proposalOnReopen,
  runProposalApply,
} from '../core/proposalPersistence';
import { serializeCanvasContext } from '../core/contextSerializer';
import { remainingRunNodes, runNodeIdsOf } from '../core/jobPlan';
import { streamCanvasAgent, cancelAgentTurn } from '../core/agentService';
import {
  ackAgentJob,
  deleteAgentConversation,
  listAgentConversations,
  listAgentJobs,
  loadAgentConversation,
  persistProposalOutcome,
  postAgentJobObservation,
  renameAgentConversation,
  rollbackProposal as rollbackProposalApi,
  type AgentJobView,
} from '../core/conversationService';
import {
  choiceActions,
  mentionCandidates,
  mentionChipToken,
  mentionLook,
  mentionModelCandidates,
  mentionQueryAt,
  historyPieces,
  type ImpactChoice,
  type MentionCandidate,
} from '../core/operatingModel';
import { agentPlaybooks, canvasSkillRegistry } from '../tools/skillRegistry';
import { AGENT_CREATABLE_NODE_TYPES } from '../types';
import { AskCardView } from './AskCardView';
import { mergeEffectedNodes } from '../core/effectLedger';
import { AskPager } from './AskPager';
import { EffectLabels, ThinkingFold } from './TurnLabels';
import { ProposalPreviewCard } from './ProposalPreviewCard';
import { AssistantMarkdown } from './assistantMarkdown';
import { proposalDefaultOpen, proposalDisplayTier, sortProposalsForDisplay } from './proposalOrder';
import type {
  ActionProposal,
  AgentChatMessage,
  AgentConversation,
  AgentToolLog,
  CanvasAgentStreamEvent,
} from '../types';
import type { AskAnswer, AskCard } from '../core/askCard';
import { runScopeDigest, runScopeMatches, actionsReleasedForApproval, type RunScope } from '../core/runApproval';
import './canvas-agent.css';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function appliedStageOutcome(playbookId: string, current: ActionProposal) {
  const stage = current.status === 'applied'
    ? inferAppliedPlaybookStage(
      playbookId,
      current.actions,
      (id) => getCanvasSnapshot().nodes.find((node) => node.id === id)?.type || '',
    )
    : null;
  const landed = current.status === 'applied' || current.status === 'partial' || current.status === 'exec_failed';
  return {
    ...diskProposalOutcome(current),
    ...(stage != null && playbookId ? { playbookId, stage } : {}),
    ...(landed && current.effectedNodes?.length ? { effectedNodes: current.effectedNodes } : {}),
    ...(landed && current.changelog ? { changelog: current.changelog } : {}),
  };
}
type AgentMode = 'confirm' | 'auto';
type ChatTurn = AgentChatMessage & {
  elapsedMs?: number;
  contextRatio?: number;
  reaction?: 'up' | 'down';
};

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 消息头的时间：今天只给时分，更早给月/日。 */
function formatTurnTime(value: number): string {
  const date = new Date(Number(value) || Date.now());
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${hh}:${mm}`;
}

function stopEvent(event: SyntheticEvent): void {
  if ('button' in event && event.button === 1) return;
  event.stopPropagation();
}

const FLOATING_OBSTACLE_SELECTOR = [
  '.image-gen-dock-host',
  '.image-action-bar-host',
  '.selection-action-bar-host',
  '.frame-group-action-bar-host',
  '.image-batch-action-bar-host',
  '.text-format-bar-host',
  '.text-node-dock-host',
  '.video-trim-dock.active',
  '.canvas-pin-hub',
  '.minimap:not(.is-hidden)',
].join(',');

function resolveFloatingPlacement(
  root: HTMLElement,
  panel: HTMLElement,
  desired: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number; height: number } {
  const rootRect = root.getBoundingClientRect();
  const gap = 12;
  const minTop = 72;
  const minHeight = Math.min(320, Math.max(220, root.clientHeight - minTop - gap));
  const obstacles = [...root.querySelectorAll<HTMLElement>(FLOATING_OBSTACLE_SELECTOR)]
    .filter((element) => element !== panel && !panel.contains(element))
    .map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        rect.width < 2 ||
        rect.height < 2
      ) return null;
      return {
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        right: rect.right - rootRect.left,
        bottom: rect.bottom - rootRect.top,
      };
    })
    .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));
  const heights = new Set<number>([height]);
  obstacles.forEach((rect) => {
    heights.add(Math.min(height, rect.top - minTop - gap));
    heights.add(Math.min(height, root.clientHeight - rect.bottom - gap * 2));
  });
  const candidates: Array<{ x: number; y: number; height: number; score: number }> = [];
  for (const candidateHeight of [...heights].filter((value) => value >= minHeight)) {
    const maxX = Math.max(gap, root.clientWidth - width - gap);
    const maxY = Math.max(minTop, root.clientHeight - candidateHeight - gap);
    const xs = new Set<number>([desired.x, gap, maxX]);
    const ys = new Set<number>([desired.y, minTop, maxY]);
    obstacles.forEach((rect) => {
      xs.add(rect.left - width - gap);
      xs.add(rect.right + gap);
      ys.add(rect.top - candidateHeight - gap);
      ys.add(rect.bottom + gap);
    });
    for (const rawX of xs) {
      for (const rawY of ys) {
        const x = Math.min(maxX, Math.max(gap, rawX));
        const y = Math.min(maxY, Math.max(minTop, rawY));
        const right = x + width;
        const bottom = y + candidateHeight;
        const collides = obstacles.some(
          (rect) =>
            x < rect.right + gap &&
            right > rect.left - gap &&
            y < rect.bottom + gap &&
            bottom > rect.top - gap,
        );
        if (collides) continue;
        candidates.push({
          x,
          y,
          height: candidateHeight,
          score:
            Math.hypot(x - desired.x, y - desired.y) +
            Math.max(0, height - candidateHeight) * 1.5,
        });
      }
    }
  }
  return candidates.sort((a, b) => a.score - b.score)[0] || {
    x: Math.max(gap, desired.x),
    y: Math.max(minTop, desired.y),
    height,
  };
}

type MentionInsert = Pick<MentionCandidate, 'kind' | 'id' | 'label' | 'preview' | 'thumb' | 'media'>;

function composerPlainText(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || '';
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const kind = node.dataset.mentionKind;
    const id = node.dataset.mentionId;
    if ((kind === 'node' || kind === 'model') && id) {
      out += mentionChipToken({ kind, id });
      return;
    }
    if (node.dataset.skillChip) return;
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}

function caretQuery(root: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return null;
  if (sel.anchorNode?.nodeType !== Node.TEXT_NODE) return null;
  return mentionQueryAt(sel.anchorNode.textContent || '', sel.anchorOffset);
}

function closeMentionPreviews() {
  document.querySelectorAll('.canvas-agent-mention-preview').forEach((node) => node.remove());
}

function ensureSkillChip(root: HTMLElement, title: string | null) {
  const existing = root.querySelector(':scope > [data-skill-chip]');
  if (!title) {
    existing?.remove();
    return;
  }
  if (existing instanceof HTMLElement) {
    const label = existing.querySelector('span');
    if (label) label.textContent = title;
    if (existing !== root.firstChild) root.prepend(existing);
    return;
  }
  const chip = document.createElement('span');
  chip.className = 'canvas-agent-skill-chip';
  chip.contentEditable = 'false';
  chip.dataset.skillChip = '1';
  const label = document.createElement('span');
  label.textContent = title;
  chip.append(label);
  root.prepend(chip);
}

function replaceComposerText(root: HTMLElement, text: string) {
  const chip = root.querySelector(':scope > [data-skill-chip]');
  root.replaceChildren();
  if (text) root.append(document.createTextNode(text));
  if (chip) root.prepend(chip);
}

function keepCaretAfterSkill(root: HTMLElement) {
  const chip = root.querySelector(':scope > [data-skill-chip]');
  const sel = window.getSelection();
  if (!chip || !sel || !sel.isCollapsed || !sel.rangeCount || !root.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0);
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  if (!before.intersectsNode(chip)) placeCaretAfter(chip);
}

function placeCaretAfter(node: Node) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function commitMentionTitle(id: string, input: HTMLInputElement) {
  if (input.dataset.saved) return;
  const stored = mentionTitleToStore(input.value);
  if (!stored) return;
  input.dataset.saved = '1';
  withCanvasAgentNode(id, (node) => {
    node.title = stored;
  });
  flushCanvasAgentSave();
  input.replaceWith(document.createTextNode(stored));
}

function mentionPill(item: MentionInsert): HTMLSpanElement {
  const pill = document.createElement('span');
  pill.className = 'canvas-agent-skill-chip canvas-agent-mention-pill';
  pill.contentEditable = 'false';
  pill.dataset.mentionKind = item.kind;
  pill.dataset.mentionId = item.id;
  if (item.media === 'image' && (item.thumb || item.preview)) {
    const thumb = document.createElement('img');
    thumb.className = 'canvas-agent-mention-pill-thumb';
    thumb.alt = '';
    thumb.src = item.thumb || item.preview || '';
    if (item.thumb && item.preview && item.thumb !== item.preview) {
      thumb.addEventListener('error', () => {
        if (thumb.dataset.fallback) return;
        thumb.dataset.fallback = '1';
        thumb.src = item.preview || '';
      });
    }
    pill.append(thumb);
  }
  const label = document.createElement('span');
  label.className = 'canvas-agent-mention-pill-label';
  const source = item.kind === 'node'
    ? getCanvasSnapshot().nodes.find((node) => node.id === item.id)
    : undefined;
  const semantic = source ? referenceCapsuleLabel(source, 0) : '';
  const shown = semantic && semantic !== '参考图' ? semantic : item.label;
  if (item.kind === 'node' && item.media === 'image' && semantic === '参考图') {
    const nameInput = document.createElement('input');
    nameInput.className = 'canvas-agent-mention-name';
    nameInput.placeholder = '起名';
    nameInput.setAttribute('aria-label', '参考图名字');
    nameInput.addEventListener('mousedown', (event) => event.stopPropagation());
    nameInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commitMentionTitle(item.id, nameInput);
    });
    nameInput.addEventListener('blur', () => commitMentionTitle(item.id, nameInput));
    label.append(nameInput);
  } else {
    label.textContent = shown;
  }
  pill.append(label);
  const preview = document.createElement('span');
  preview.className = 'canvas-agent-mention-preview';
  if (item.media === 'video' && item.preview) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = item.preview;
    preview.append(video);
  } else if (item.preview || item.thumb) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = item.thumb || item.preview || '';
    if (item.thumb && item.preview && item.thumb !== item.preview) {
      img.addEventListener('error', () => {
        if (img.dataset.fallback) return;
        img.dataset.fallback = '1';
        img.src = item.preview || '';
      });
    }
    preview.append(img);
  }
  const caption = document.createElement('span');
  caption.textContent = shown;
  preview.append(caption);
  pill.append(preview);
  const closePreview = () => {
    preview.classList.remove('is-open');
    if (preview.parentElement !== pill) pill.append(preview);
  };
  pill.addEventListener('mouseenter', () => {
    document.body.append(preview);
    preview.classList.add('is-open');
    const rect = pill.getBoundingClientRect();
    const width = 168;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const height = preview.offsetHeight;
    let top = rect.top - height - 8;
    if (top < 8) top = Math.min(window.innerHeight - height - 8, rect.bottom + 8);
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  });
  pill.addEventListener('mouseleave', closePreview);
  return pill;
}

function insertMentionPill(root: HTMLElement, item: MentionInsert) {
  const sel = window.getSelection();
  let anchor: Text | null = null;
  if (sel && sel.rangeCount && sel.anchorNode?.nodeType === Node.TEXT_NODE && root.contains(sel.anchorNode)) {
    const textNode = sel.anchorNode as Text;
    const cursor = sel.anchorOffset;
    const raw = textNode.textContent || '';
    const before = raw.slice(0, cursor).replace(/@([^\s@{}]*)$/, '');
    const after = raw.slice(cursor);
    textNode.textContent = before;
    anchor = textNode;
    if (after) textNode.after(document.createTextNode(after));
  }
  const existing = root.querySelector(
    `[data-mention-kind="${item.kind}"][data-mention-id="${CSS.escape(item.id)}"]`,
  );
  if (existing) {
    const next = existing.nextSibling;
    placeCaretAfter(next?.nodeType === Node.TEXT_NODE ? next : existing);
    return;
  }
  const pill = mentionPill(item);
  const space = document.createTextNode(' ');
  if (anchor?.parentNode) {
    anchor.after(pill);
    pill.after(space);
  } else {
    root.append(pill, space);
  }
  const nameInput = pill.querySelector('input');
  if (nameInput instanceof HTMLInputElement) nameInput.focus();
  else placeCaretAfter(space);
}

function useCanvasEditorVisible(active: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const sync = () => setVisible(active && isInfiniteCanvasEditorOpen());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-infinite-canvas-editor'],
      subtree: true,
    });
    window.addEventListener('canvas-board-bg-change', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('canvas-board-bg-change', sync);
    };
  }, [active]);
  return visible;
}

function UserMessageBody({ content }: { content: string }) {
  const snapshot = getCanvasSnapshot();
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const models = new Map(
    mentionModelCandidates(snapshot.availableModels).map((item) => [item.id, item.label]),
  );
  const pieces = historyPieces(content);
  if (!pieces.some((piece) => piece.type !== 'text')) return <>{content}</>;
  return (
    <>
      {pieces.map((piece, index) => {
        if (piece.type === 'text') return <span key={index}>{piece.text}</span>;
        const named = piece.type === 'node' && nodes.has(piece.id) ? mentionLook(nodes.get(piece.id)!) : null;
        const label = named?.label
          || (piece.type === 'model' ? (models.get(piece.id) || piece.id) : piece.id);
        const src = named?.media === 'image' ? (named.thumb || named.preview || '') : '';
        return (
          <span key={index} className="canvas-agent-skill-chip canvas-agent-mention-pill">
            {src ? (
              <img
                className="canvas-agent-mention-pill-thumb"
                alt=""
                src={src}
                onError={(event) => {
                  const image = event.currentTarget;
                  if (image.dataset.fallback || !named?.preview) return;
                  image.dataset.fallback = '1';
                  image.src = named.preview;
                }}
              />
            ) : null}
            <span className="canvas-agent-mention-pill-label">{label}</span>
          </span>
        );
      })}
    </>
  );
}

function removeMentionBeforeCaret(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode || !root.contains(sel.anchorNode)) return false;
  const prev = sel.anchorNode.nodeType === Node.TEXT_NODE && sel.anchorOffset === 0
    ? sel.anchorNode.previousSibling
    : sel.anchorNode === root
      ? root.childNodes[sel.anchorOffset - 1] || null
      : null;
  if (!(prev instanceof HTMLElement) || !prev.classList.contains('canvas-agent-mention-pill')) return false;
  prev.remove();
  return true;
}

export function AgentFloatingPanel({
  rootRef,
  active,
}: {
  rootRef: MutableRefObject<HTMLDivElement | null>;
  active: boolean;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [floating, setFloating] = useState(false);
  const [floatingPosition, setFloatingPosition] = useState({ x: 24, y: 84 });
  const [floatingHeight, setFloatingHeight] = useState(560);
  const [width, setWidth] = useState(420);
  const [title, setTitle] = useState('探索创作方向');
  const [conversationId, setConversationId] = useState('');
  const conversationIdRef = useRef('');
  const citedNodesRef = useRef<string[]>([]);
  const effectedRef = useRef<Array<{ id: string; nodeType: string; label?: string }>>([]);
  const playbookIdRef = useRef('');
  const sessionPlaybookRef = useRef('');
  const appliedSkillRef = useRef('');
  const runApprovalRef = useRef<string[] | null>(null);
  /** 服务端作业 id：这一轮 Agent 任务的账本，不随页面刷新消失。 */
  const jobIdRef = useRef('');
  const proposalJobRef = useRef<Map<string, string>>(new Map());
  const continueCountRef = useRef<Map<string, number>>(new Map());
  /** 刷新后提案上带着 jobId；同一次会话里还有内存映射兜底。 */
  const jobIdOfProposal = useCallback((proposal: ActionProposal) => (
    proposal.jobId || proposalJobRef.current.get(proposal.id) || ''
  ), []);
  /** 审批卡发出时记下的节点集与内容。只在这一次会话的内存里，刷新即失效。 */
  const runScopeRef = useRef<Map<string, RunScope>>(new Map());
  const askHistoryRef = useRef<ChatTurn[]>([]);
  const askedRef = useRef(new Set<string>());
  const [askAnswers, setAskAnswers] = useState<Record<string, AskAnswer>>({});
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [input, setInput] = useState('');
  const [playbookId, setPlaybookId] = useState('');
  playbookIdRef.current = playbookId;
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const proposalsRef = useRef<ActionProposal[]>([]);
  const writeQueueRef = useRef<Set<string>>(new Set());
  const [proposalOpen, setProposalOpen] = useState<Record<string, boolean>>({});
  const replaceProposals = useCallback((next: ActionProposal[] | ((items: ActionProposal[]) => ActionProposal[])) => {
    const resolved = typeof next === 'function' ? next(proposalsRef.current) : next;
    proposalsRef.current = resolved;
    setProposals(resolved);
  }, []);
  /** 记下这张卡发出时指向的节点与内容。卡上是临时 id 时，落板后要再记一次。 */
  const rememberRunScope = useCallback((messageId: string, card: AskCard) => {
    const nodeIds = [...(card.node_keys || [])].filter(Boolean);
    if (!nodeIds.length) return;
    const snapshot = getCanvasSnapshot();
    runScopeRef.current.set(`${messageId}:${card.id}`, {
      nodeIds,
      digest: runScopeDigest(snapshot.nodes, nodeIds, snapshot.connections),
    });
  }, []);
  const proposalRows = useMemo(() => {
    const sorted = sortProposalsForDisplay(proposals);
    let tier12Index = 0;
    return sorted.map((proposal) => {
      const index = proposalDisplayTier(proposal.status) < 2 ? tier12Index++ : -1;
      const open = proposalOpen[proposal.id] ?? proposalDefaultOpen(proposal.status, index);
      return { proposal, open };
    });
  }, [proposalOpen, proposals]);
  useEffect(() => {
    setProposalOpen({});
    setLocalRunCards({});
    runScopeRef.current.clear();
  }, [conversationId]);

  // 关页、断网、切标签页之后，靠作业账本把「刚才那轮」找回来。
  useEffect(() => {
    if (!open || !conversationId) {
      setActiveJob(null);
      return;
    }
    let cancelled = false;
    setJobNoticeHidden(false);
    void listAgentJobs(conversationId, { activeOnly: true })
      .then((jobs) => {
        if (!cancelled) setActiveJob(jobs[0] || null);
      })
      .catch(() => {
        if (!cancelled) setActiveJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, messages.length]);
  const [toolLogs, setToolLogs] = useState<AgentToolLog[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<AgentMode>('auto');
  const [menu, setMenu] = useState<
    'plus' | 'mode' | 'more' | 'history' | 'skills' | 'apps' | ''
  >('');
  const [showAppsHint, setShowAppsHint] = useState(true);
  const [notice, setNotice] = useState('');
  /** 打开面板时找回「这轮还没结束」的作业。 */
  const [activeJob, setActiveJob] = useState<AgentJobView | null>(null);
  const [jobNoticeHidden, setJobNoticeHidden] = useState(false);
  const [rollbackConfirmId, setRollbackConfirmId] = useState('');
  const [impactChoice, setImpactChoice] = useState<ImpactChoice[] | null>(null);
  /** 本地提案（重做）自己出的审批卡。服务端不会为它发卡，卡只活在这一屏。 */
  const [localRunCards, setLocalRunCards] = useState<Record<string, AskCard>>({});
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const startedAt = useRef(0);
  const modeRef = useRef(mode);
  const loadedCanvasIdRef = useRef('');
  const visible = useCanvasEditorVisible(active);
  modeRef.current = mode;

  useLayoutEffect(() => {
    if (!active) {
      setPortalRoot(null);
      setOpen(false);
      return;
    }
    // 根节点可能晚于这一帧才挂上。只排一次 rAF 会在 current 仍为空时停住，浮窗再也出不来。
    let frame = 0;
    const sync = () => {
      const node = rootRef.current;
      if (node) {
        setPortalRoot(node);
        return;
      }
      frame = requestAnimationFrame(sync);
    };
    sync();
    return () => cancelAnimationFrame(frame);
  }, [active, rootRef]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, proposals, toolLogs, error, impactChoice]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const root = portalRoot;
    if (!root) return;
    root.classList.toggle('canvas-agent-open', open && !floating);
    root.classList.toggle('canvas-agent-floating', open && floating);
    root.classList.toggle('canvas-agent-expanded', open && expanded && !floating);
    root.style.setProperty(
      '--canvas-agent-reserved-width',
      `${open && !floating ? (expanded ? 664 : width + 32) : 0}px`,
    );
    return () => {
      root.classList.remove('canvas-agent-open', 'canvas-agent-floating', 'canvas-agent-expanded');
      root.style.removeProperty('--canvas-agent-reserved-width');
    };
  }, [expanded, floating, open, portalRoot, width]);

  useEffect(() => {
    const sync = () => {
      if (document.documentElement.classList.contains('canvas-image-edit-open')) setOpen(false);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => {
      if (window.matchMedia('(max-width: 720px)').matches) setFloating(false);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  useLayoutEffect(() => {
    if (!floating || !portalRoot || !panelRef.current) return;
    let frame = 0;
    const sync = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const panel = panelRef.current;
        if (!panel || panel.classList.contains('is-dragging')) return;
        const placement = resolveFloatingPlacement(
          portalRoot,
          panel,
          floatingPosition,
          panel.offsetWidth,
          floatingHeight,
        );
        if (
          placement.x !== floatingPosition.x ||
          placement.y !== floatingPosition.y ||
          placement.height !== floatingHeight
        ) {
          setFloatingPosition({ x: placement.x, y: placement.y });
          setFloatingHeight(placement.height);
        }
      });
    };
    const observer = new MutationObserver(sync);
    observer.observe(portalRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
    window.addEventListener('resize', sync);
    sync();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [floating, floatingHeight, floatingPosition, portalRoot]);

  const clearConversationView = useCallback(() => {
    abortRef.current?.abort();
    conversationIdRef.current = '';
    citedNodesRef.current = [];
    effectedRef.current = [];
    sessionPlaybookRef.current = '';
    askHistoryRef.current = [];
    askedRef.current = new Set();
    setAskAnswers({});
    setConversationId('');
    setTitle('探索创作方向');
    setMessages([]);
    replaceProposals([]);
    setToolLogs([]);
    setError('');
    setNotice('');
    setStreaming(false);
    setRenaming(false);
    setMenu('');
  }, []);

  const showConversation = useCallback(async (id: string) => {
    const data = await loadAgentConversation(id);
    conversationIdRef.current = data.conversation.id;
    citedNodesRef.current = Array.isArray(data.citedNodes) ? data.citedNodes : [];
    effectedRef.current = Array.isArray(data.effectedNodes) ? data.effectedNodes : [];
    setConversationId(data.conversation.id);
    setTitle(data.conversation.title);
    const restoredAnswers: Record<string, AskAnswer> = {};
    const restoredHistory: ChatTurn[] = [];
    let askMessageId = '';
    data.messages.forEach((message) => {
      if (message.role === 'assistant' && message.metadata?.asks?.length) askMessageId = message.id;
      const batch = parseAskAnswers(message.metadata?.askAnswers);
      const answer = batch.length ? null : parseAskAnswer(message.metadata?.askAnswer);
      const answers = batch.length ? batch : answer ? [answer] : [];
      if (!answers.length) return;
      answers.forEach((item) => {
        restoredAnswers[askMessageId ? `${askMessageId}:${item.cardId}` : item.cardId] = item;
      });
      restoredHistory.push({
        id: message.id,
        role: 'user',
        content: '',
        createdAt: message.created_at,
        ...(batch.length ? { askAnswers: batch } : { askAnswer: answer || undefined }),
      });
    });
    askHistoryRef.current = restoredHistory;
    askedRef.current = new Set(Object.keys(restoredAnswers));
    setAskAnswers(restoredAnswers);
    setMessages(
      data.messages.flatMap((message) => {
        if (message.role === 'user' && !message.content.trim()) return [];
        return [{
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.created_at,
          elapsedMs: Number(message.metadata?.elapsedMs) || undefined,
          thinking: typeof message.metadata?.thinking === 'string' ? message.metadata.thinking : undefined,
          asks: Array.isArray(message.metadata?.asks) ? message.metadata.asks : undefined,
        }];
      }),
    );
    replaceProposals(
      data.messages.flatMap((message) => {
        const proposal = message.metadata?.proposal;
        return proposal ? [{ ...proposalOnReopen(proposal), messageId: message.id }] : [];
      }),
    );
    setToolLogs(
      data.messages.flatMap((message) =>
        Array.isArray(message.metadata?.toolLogs) ? message.metadata.toolLogs : [],
      ),
    );
    const latestError = [...data.messages]
      .reverse()
      .map((message) => String(message.metadata?.error || ''))
      .find(Boolean);
    setError(latestError || '');
    setNotice('');
    setMenu('');
  }, []);

  const refreshConversations = useCallback(async (canvasId: string) => {
    const items = await listAgentConversations(canvasId);
    setConversations(items);
    return items;
  }, []);

  useEffect(() => {
    if (!visible) return;
    const canvasId = getCanvasSnapshot().canvasId;
    if (!canvasId || loadedCanvasIdRef.current === canvasId) return;
    loadedCanvasIdRef.current = canvasId;
    clearConversationView();
    void refreshConversations(canvasId)
      .then((items) => items[0] && showConversation(items[0].id))
      .catch((loadError) => {
        loadedCanvasIdRef.current = '';
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, [clearConversationView, refreshConversations, showConversation, visible]);

  const startNewConversation = useCallback(() => {
    clearConversationView();
    setOpen(true);
  }, [clearConversationView]);

  const removeConversation = useCallback(
    async (id: string) => {
      try {
        await deleteAgentConversation(id);
        const canvasId = getCanvasSnapshot().canvasId;
        const items = await refreshConversations(canvasId);
        if (conversationId === id) {
          if (items[0]) await showConversation(items[0].id);
          else clearConversationView();
        }
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      }
    },
    [clearConversationView, conversationId, refreshConversations, showConversation],
  );

  const persistTitle = useCallback(async () => {
    setRenaming(false);
    if (!conversationId) return;
    try {
      const conversation = await renameAgentConversation(conversationId, title);
      setTitle(conversation.title);
      setConversations((items) =>
        items.map((item) => (item.id === conversation.id ? conversation : item)),
      );
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    }
  }, [conversationId, title]);

  const updateProposal = useCallback((id: string, patch: Partial<ActionProposal>) => {
    replaceProposals((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, [replaceProposals]);

  const applyProposal = useCallback(
    async (proposal: ActionProposal) => {
      const approval = runApprovalRef.current;
      runApprovalRef.current = null;
      const released = new Set(approval || []);
      const actions = actionsReleasedForApproval(proposal.actions, released);
      if (!actions.length) return;
      const runNodeIds = runNodeIdsOf(actions);
      // 作业账本：批准即从「等用户」进「执行中」。失败不影响画布操作。
      const proposalJobId = jobIdOfProposal(proposal);
      if (proposalJobId) {
        void ackAgentJob(proposalJobId, 'execute', {
          stepTotal: runNodeIds.length || 1,
          result: { proposalId: proposal.id, runNodeIds },
        }).catch(() => { /* 账本失败不阻断 */ });
      }
      // 先把「已开始」写进库，再动画布：重开时 pending 才是可信的「一次都没开始」。
      // 写不上就照常应用；最坏情况是重开后这张 pending 复活，由用户自己判断要不要点。
      try {
        await persistProposalOutcome(proposal.id, { ...diskProposalOutcome(proposal), status: 'applying' });
      } catch {
        /* 留痕失败不阻断落板 */
      }
      const outcome = await runProposalApply({ ...proposal, actions }, {
        batchApply: async (actions, onProgress) => {
          const result = await batchApplyChanges(
            actions,
            onProgress,
            proposal.userMessage,
            conversationIdRef.current,
            [...citedNodesRef.current, ...effectedRef.current.map((node) => node.id)],
            // 每跑完一个节点就记一步：关页后从记到的步数继续，不重复执行。
            (step) => {
              if (!proposalJobId) return;
              void postAgentJobObservation(proposalJobId, {
                proposalId: proposal.id,
                nodeId: step.nodeId,
                outcome: step.status === 'failed'
                  ? 'failed'
                  : step.status === 'done' ? 'applied' : 'discarded',
                ...(step.message ? { error: step.message } : {}),
              }).catch(() => { /* 观察写不上不阻断 */ });
            },
          );
          if (result.effected.length || result.changelog) {
            updateProposal(proposal.id, { effectedNodes: result.effected, changelog: result.changelog });
            effectedRef.current = mergeEffectedNodes(effectedRef.current, result.effected);
          }
          return result;
        },
        update: updateProposal,
        current: () => proposalsRef.current.find((item) => item.id === proposal.id),
        persist: (current) => persistProposalOutcome(
          current.id,
          appliedStageOutcome(playbookIdRef.current, current),
        ),
        queue: writeQueueRef.current,
      });
      // 工具明细不能一直挂着「等」。提案结算成什么，这批日志就跟着收口。
      const settled = proposalsRef.current.find((item) => item.id === proposal.id)?.status;
      const logState = settled === 'failed' || settled === 'exec_failed'
        ? 'failed'
        : settled === 'applied' || settled === 'partial'
          ? 'done'
          : null;
      if (logState) {
        setToolLogs((items) => items.map((log) => (
          log.state === 'queued' ? { ...log, state: logState } : log
        )));
      }
      if (proposalJobId) {
        void ackAgentJob(proposalJobId, 'finish', {
          result: { proposalId: proposal.id, status: settled || '' },
        }).catch(() => { /* 账本失败不阻断 */ });
        // 有逐步观察时不再写一条总观察，免得步数对不上；只有结构提案才记一条。
        if (!runNodeIds.length) {
          void postAgentJobObservation(proposalJobId, {
            proposalId: proposal.id,
            outcome: settled === 'failed' || settled === 'exec_failed' ? 'failed' : 'applied',
            effected: proposalsRef.current.find((item) => item.id === proposal.id)?.effectedNodes?.length || 0,
          }).catch(() => { /* 观察写不上不阻断 */ });
        }
        setActiveJob((current) => (current && current.id === proposalJobId ? null : current));
      }
      if (outcome !== 'rejected' && outcome.choices.length) setImpactChoice(outcome.choices);
      if (!approval && outcome !== 'rejected' && outcome.idMap) {
        const idMap = outcome.idMap;
        setMessages((items) => items.map((item) => !item.asks ? item : {
          ...item,
          asks: item.asks.map((card) => {
            if (card.mode !== 'approve_run_node' || !card.node_keys) return card;
            const next = { ...card, node_keys: card.node_keys.map((id) => idMap[id] || id) };
            // 临时 id 落成真 id 后，这张卡的授权范围要按新 id 重新记一次。
            rememberRunScope(item.id, next);
            return next;
          }),
        }));
      }
    },
    [jobIdOfProposal, rememberRunScope, updateProposal],
  );
  const applyRef = useRef(applyProposal);
  applyRef.current = applyProposal;

  const queueImpact = useCallback((kind: 'redo' | 'replace') => {
    if (!impactChoice?.length) return;
    try {
      const actions = choiceActions(getCanvasSnapshot(), impactChoice, kind);
      const proposal: ActionProposal = {
        id: uid('proposal'),
        title: kind === 'redo' ? '原节点重做' : '新建替换',
        summary: kind === 'redo'
          ? '在原节点上再跑一次。生成仍需确认；失败或已废弃的节点不会重试。'
          : '新建节点承接原来的上游，旧节点标为废弃。新节点不会自动生成。',
        actions,
        status: 'pending',
        requiresApproval: true,
        generative: kind === 'redo',
        createdAt: Date.now(),
        inLibrary: false,
      };
      replaceProposals((items) => [...items, proposal]);
      setImpactChoice(null);
      // 重做的产出全是运行动作，服务端不会为它发审批卡；这里自己补一张，
      // 否则提案会停在「等审批卡」而根本没有卡可点。
      const nodeIds = actions.flatMap((action) => (action.type === 'execute_node_skill' ? [action.nodeId] : []));
      const card = kind === 'redo' ? approveRunCard(nodeIds) : null;
      if (card) setLocalRunCards((current) => ({ ...current, [proposal.id]: card }));
      if (kind === 'replace' && modeRef.current === 'auto') void applyRef.current(proposal);
    } catch (choiceError) {
      setError(choiceError instanceof Error ? choiceError.message : String(choiceError));
    }
  }, [impactChoice]);

  const discardProposal = useCallback(
    (proposal: ActionProposal) => {
      updateProposal(proposal.id, { status: 'discarded' });
      const jobId = jobIdOfProposal(proposal);
      if (jobId) {
        void ackAgentJob(jobId, 'finish', {
          result: { proposalId: proposal.id, status: 'discarded' },
        }).catch(() => { /* 账本失败不阻断 */ });
        void postAgentJobObservation(jobId, {
          proposalId: proposal.id,
          outcome: 'discarded',
        }).catch(() => { /* 观察写不上不阻断 */ });
        setActiveJob((current) => (current && current.id === jobId ? null : current));
      }
    },
    [updateProposal],
  );

  /**
   * 本地重做提案自己的审批卡。批准后走和聊天审批卡同一条一次性放行：
   * runApprovalRef 只给这一次 apply 用，用完即清。拒绝就放弃提案。
   */
  const answerLocalRun = useCallback((proposalId: string, approved: boolean) => {
    const card = localRunCards[proposalId];
    if (!card) return;
    setLocalRunCards((current) => {
      const next = { ...current };
      delete next[proposalId];
      return next;
    });
    const proposal = proposalsRef.current.find((item) => item.id === proposalId);
    if (!proposal) return;
    if (!approved) {
      discardProposal(proposal);
      return;
    }
    runApprovalRef.current = [...(card.node_keys || [])];
    void applyRef.current(proposal);
  }, [discardProposal, jobIdOfProposal, localRunCards]);

  const finishTurn = useCallback((assistantId: string) => {
    const elapsedMs = Math.max(0, Date.now() - startedAt.current);
    setMessages((items) =>
      items.map((item) => (item.id === assistantId ? { ...item, elapsedMs } : item)),
    );
  }, []);

  const handleAgentEvent = useCallback(
    (assistantId: string, event: CanvasAgentStreamEvent) => {
      if (event.type === 'meta') {
        if (event.conversationId) {
          conversationIdRef.current = event.conversationId;
          setConversationId(event.conversationId);
        }
        if (Array.isArray(event.citedNodes)) citedNodesRef.current = event.citedNodes;
        if (Array.isArray(event.effectedNodes)) effectedRef.current = event.effectedNodes;
        if (event.jobId) jobIdRef.current = event.jobId;
      } else if (event.type === 'delta') {
        setMessages((items) =>
          items.map((item) =>
            item.id === assistantId ? { ...item, content: `${item.content}${event.text}` } : item,
          ),
        );
      } else if (event.type === 'thinking') {
        setMessages((items) => items.map((item) => (item.id === assistantId
          ? { ...item, thinking: `${item.thinking || ''}${event.text}` }
          : item)));
      } else if (event.type === 'ask') {
        setMessages((items) => items.map((item) => (
          item.id === assistantId ? { ...item, asks: event.asks } : item
        )));
        event.asks.forEach((card) => {
          if (card.mode === 'approve_run_node') rememberRunScope(assistantId, card);
        });
      } else if (event.type === 'proposal') {
        if (jobIdRef.current) proposalJobRef.current.set(event.proposal.id, jobIdRef.current);
        replaceProposals((items) => [...items, { ...event.proposal, messageId: assistantId }]);
        if (!proposalWaitsForClick(modeRef.current, event.proposal)) {
          void applyRef.current(event.proposal);
        }
      } else if (event.type === 'tool') {
        setToolLogs((items) => {
          const exists = items.some((item) => item.id === event.log.id);
          return exists
            ? items.map((item) => (item.id === event.log.id ? event.log : item))
            : [...items, event.log];
        });
      } else if (event.type === 'error') {
        setError(event.error);
      } else if (event.type === 'done') {
        deliverProposalDone(assistantId, finishTurn, () => {
          flushProposalWriteQueue(
            writeQueueRef.current,
            (id) => proposalsRef.current.find((item) => item.id === id),
            (current) => persistProposalOutcome(
              current.id,
              appliedStageOutcome(playbookIdRef.current, current),
            ),
          );
        });
      }
    },
    [finishTurn, rememberRunScope],
  );

  const sendText = useCallback(
    async (raw: string, history: ChatTurn[], continueJobId?: string, regenerate = false) => {
      const text = raw.trim();
      if (streaming || (!text && !playbookId && !continueJobId)) return;
      if (playbookId) sessionPlaybookRef.current = playbookId;
      // 上一轮作业如果还挂着，这一条新消息就意味着它已经结束（作业账本不留悬空）。
      // 但「继续下一步」是在同一份作业上推进，不能把它收掉。
      const previousJob = jobIdRef.current;
      if (previousJob && previousJob !== continueJobId) {
        jobIdRef.current = '';
        void ackAgentJob(previousJob, 'finish', { result: { superseded: true } }).catch(() => {});
      }
      setActiveJob(null);
      setJobNoticeHidden(false);
      closeMentionPreviews();
      if (composerRef.current) replaceComposerText(composerRef.current, '');
      const snapshot = getCanvasSnapshot();
      const contextRatio = Math.min(
        100,
        Math.round((serializeCanvasContext(snapshot).length / 14_000) * 100),
      );
      const userMessage: ChatTurn = {
        id: uid('user'),
        role: 'user',
        content: text,
        createdAt: Date.now(),
        contextRatio,
      };
      const assistantMessage: ChatTurn = {
        id: uid('assistant'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      if (title === '探索创作方向' && text) setTitle(text.slice(0, 16));
      setMessages((items) => (text && !regenerate ? [...items, userMessage, assistantMessage] : [...items, assistantMessage]));
      setInput('');
      setMentionQuery(null);
      setError('');
      setNotice('');
      setToolLogs([]);
      setMenu('');
      setStreaming(true);
      startedAt.current = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;
      // 执行反馈只在同一会话内、刷新前有效。重开会话时 proposal 变为 expired 且 error 被删，失败信息不可恢复。这是已知边界，不是遗漏。
      const feedback = pendingExecutionFeedback(proposals);
      const requestMessages = [
        ...(feedback
          ? [
              ...history,
              {
                id: uid('feedback'),
                role: 'user' as const,
                content: feedback.content,
                createdAt: Date.now(),
              },
            ]
          : history),
        ...askHistoryRef.current,
      ];
      if (feedback) updateProposal(feedback.id, { feedbackDeliveredAt: Date.now() });
      try {
        await streamCanvasAgent({
          message: text,
          messages: requestMessages,
          snapshot,
          conversationId: conversationId || undefined,
          playbookId: playbookId || undefined,
          citedNodeIds: citedNodesRef.current,
          ...(continueJobId ? { continueJobId } : {}),
          ...(regenerate ? { regenerate: true } : {}),
          signal: controller.signal,
          onEvent: (event) => handleAgentEvent(assistantMessage.id, event),
        });
      } catch (streamError) {
        if (!controller.signal.aborted) {
          setError(streamError instanceof Error ? streamError.message : String(streamError));
        }
        finishTurn(assistantMessage.id);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setStreaming(false);
        void refreshConversations(snapshot.canvasId).catch(() => { /* keep current chat visible */ });
      }
    },
    [
      conversationId,
      finishTurn,
      handleAgentEvent,
      proposals,
      refreshConversations,
      playbookId,
      streaming,
      title,
      updateProposal,
    ],
  );

  const submitAsk = useCallback((messageId: string, answer: AskAnswer) => {
    const key = `${messageId}:${answer.cardId}`;
    if (streaming || askedRef.current.has(key)) return;
    askedRef.current.add(key);
    setAskAnswers((current) => ({ ...current, [key]: answer }));
    const runNodes = answer.mode === 'approve_run_node' && answer.selected[0] === '批准'
      ? (messages.find((item) => item.id === messageId)?.asks?.find((card) => card.id === answer.cardId)?.node_keys || [])
      : [];
    // 批准的对象是「那一刻看到的内容」。卡上的节点集或内容在批准前变过，这张卡就作废，
    // 不跑、也不假装批过。这一判必须在开流之前，否则会留下一条永不结束的空回复。
    if (runNodes.length) {
      const approvalSnapshot = getCanvasSnapshot();
      const live = runScopeMatches(
        runScopeRef.current.get(key),
        approvalSnapshot.nodes,
        runNodes,
        approvalSnapshot.connections,
      );
      if (!live) {
        // 卡上写的「批准」不能留着当已批准。把它标成已过期，并说明为什么没跑。
        setAskAnswers((current) => ({ ...current, [key]: { ...answer, selected: ['已过期'] } }));
        setNotice('这张审批卡已过期：页面刷新过，或节点内容在批准前变过。请让 Agent 重新提交运行再批。');
        return;
      }
    }
    // 答卡会发一次新请求；上一轮的作业到这里就算结束，别留成永远「等用户」。
    const previousJob = jobIdRef.current;
    if (previousJob) {
      jobIdRef.current = '';
      void ackAgentJob(previousJob, 'finish', { result: { answered: true } }).catch(() => {});
    }
    setActiveJob(null);
    setJobNoticeHidden(false);
    const historyItem: ChatTurn = {
      id: uid('ask'),
      role: 'user',
      content: '',
      createdAt: Date.now(),
      askAnswer: answer,
    };
    const prior = askHistoryRef.current;
    askHistoryRef.current = [...prior, historyItem];
    const assistantMessage: ChatTurn = {
      id: uid('assistant'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    setMessages((items) => [...items, assistantMessage]);
    setStreaming(true);
    setError('');
    startedAt.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    const snapshot = getCanvasSnapshot();
    void (async () => {
      if (runNodes.length) {
        const pending = proposalsRef.current.find((proposal) => (
          proposal.status === 'pending'
          && proposal.actions.some((action) => action.type === 'execute_node_skill' && runNodes.includes(action.nodeId))
        ));
        if (pending) {
          runApprovalRef.current = runNodes;
          await applyRef.current(pending);
        } else {
          // 混合提案的结构已经落板，没有 pending 提案可挂。上面那张活卡校验保证：
          // 跑的就是卡上列出的这批节点，且内容仍是发出卡时的那一份。
          await batchApplyChanges(
            runNodes.map((nodeId) => ({ type: 'execute_node_skill', nodeId })),
            undefined,
            undefined,
            conversationIdRef.current,
            [...citedNodesRef.current, ...effectedRef.current.map((node) => node.id)],
          );
        }
      }
      await streamCanvasAgent({
        message: '',
        askAnswer: answer,
        messages: [...messages, ...prior],
        snapshot,
        conversationId: conversationId || undefined,
        playbookId: sessionPlaybookRef.current || playbookId || undefined,
        citedNodeIds: citedNodesRef.current,
        signal: controller.signal,
        onEvent: (event) => handleAgentEvent(assistantMessage.id, event),
      });
    })().catch((streamError) => {
      if (!controller.signal.aborted) {
        setError(streamError instanceof Error ? streamError.message : String(streamError));
      }
      finishTurn(assistantMessage.id);
    }).finally(() => {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      void refreshConversations(snapshot.canvasId).catch(() => { /* keep current chat visible */ });
    });
  }, [
    askAnswers,
    conversationId,
    finishTurn,
    handleAgentEvent,
    messages,
    playbookId,
    refreshConversations,
    streaming,
  ]);

  const submitAsks = useCallback((messageId: string, answers: AskAnswer[]) => {
    const keys = answers.map((answer) => `${messageId}:${answer.cardId}`);
    if (streaming || !answers.length || keys.some((key) => askedRef.current.has(key))) return;
    keys.forEach((key) => askedRef.current.add(key));
    setAskAnswers((current) => {
      const next = { ...current };
      answers.forEach((answer) => { next[`${messageId}:${answer.cardId}`] = answer; });
      return next;
    });
    const historyItem: ChatTurn = {
      id: uid('ask'),
      role: 'user',
      content: '',
      createdAt: Date.now(),
      askAnswers: answers,
    };
    const prior = askHistoryRef.current;
    askHistoryRef.current = [...prior, historyItem];
    const assistantMessage: ChatTurn = {
      id: uid('assistant'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    setMessages((items) => [...items, assistantMessage]);
    setStreaming(true);
    setError('');
    startedAt.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    const snapshot = getCanvasSnapshot();
    void streamCanvasAgent({
      message: '',
      askAnswers: answers,
      messages: [...messages, ...prior],
      snapshot,
      conversationId: conversationId || undefined,
      playbookId: sessionPlaybookRef.current || playbookId || undefined,
      citedNodeIds: citedNodesRef.current,
      signal: controller.signal,
      onEvent: (event) => handleAgentEvent(assistantMessage.id, event),
    }).catch((streamError) => {
      if (!controller.signal.aborted) {
        setError(streamError instanceof Error ? streamError.message : String(streamError));
      }
      finishTurn(assistantMessage.id);
    }).finally(() => {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      void refreshConversations(snapshot.canvasId).catch(() => { /* keep current chat visible */ });
    });
  }, [
    conversationId,
    finishTurn,
    handleAgentEvent,
    messages,
    playbookId,
    refreshConversations,
    streaming,
  ]);

  const syncComposer = useCallback(() => {
    const root = composerRef.current;
    if (!root) return;
    const text = composerPlainText(root);
    const chip = root.querySelector(':scope > [data-skill-chip]');
    if (!text && !root.querySelector('.canvas-agent-mention-pill')) {
      const leftovers = [...root.childNodes].filter((node) => node !== chip);
      if (leftovers.length) {
        leftovers.forEach((node) => node.remove());
        if (document.activeElement === root) {
          if (chip) placeCaretAfter(chip);
          else {
            const range = document.createRange();
            range.setStart(root, 0);
            range.collapse(true);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
        }
      }
    }
    if (playbookIdRef.current && !root.querySelector(':scope > [data-skill-chip]')) setPlaybookId('');
    setInput(text);
    setMentionQuery(caretQuery(root));
  }, []);

  const fillComposer = useCallback((text: string) => {
    closeMentionPreviews();
    const root = composerRef.current;
    if (root) replaceComposerText(root, text);
    setInput(text);
    setMentionQuery(null);
  }, []);

  useEffect(() => {
    const root = composerRef.current;
    if (!root) return;
    const title = playbookId
      ? (agentPlaybooks.find((item) => item.id === playbookId)?.title || playbookId)
      : null;
    const skillChanged = appliedSkillRef.current !== playbookId;
    appliedSkillRef.current = playbookId;
    const hadChip = !!root.querySelector(':scope > [data-skill-chip]');
    ensureSkillChip(root, title);
    if (title && !hadChip && skillChanged) {
      root.focus();
      const chip = root.querySelector(':scope > [data-skill-chip]');
      if (chip) placeCaretAfter(chip);
    }
  }, [playbookId, visible]);

  const addMention = useCallback((item: MentionInsert) => {
    const root = composerRef.current;
    if (!root) return;
    root.focus();
    insertMentionPill(root, item);
    setInput(composerPlainText(root));
    setMentionQuery(null);
  }, []);

  const sendMessage = useCallback(() => {
    const text = composerRef.current ? composerPlainText(composerRef.current) : input.trim();
    void sendText(text, messages);
  }, [input, messages, sendText]);

  const retryFrom = useCallback(
    (assistantId: string) => {
      const index = messages.findIndex((item) => item.id === assistantId);
      const previous = [...messages.slice(0, index)].reverse().find((item) => item.role === 'user');
      if (previous) void sendText(previous.content, messages.slice(0, index - 1), undefined, true);
    },
    [messages, sendText],
  );

  /**
   * 观察完、用户点「继续下一步」：同一份作业回到 running，再规划一步。
   * 不自动续跑：每一步都由人点，和取消标记那套语义一致。
   */
  const continueJob = useCallback((proposal: ActionProposal) => {
    if (streaming) return;
    const jobId = jobIdOfProposal(proposal);
    if (!jobId) return;
    const used = continueCountRef.current.get(jobId) || 0;
    if (used >= 3) {
      setNotice('这一轮已经连续推进 3 步了。直接说下一步要做什么，比继续更准。');
      return;
    }
    continueCountRef.current.set(jobId, used + 1);
    void sendText('', messages, jobId);
  }, [jobIdOfProposal, messages, sendText, streaming]);

  /**
   * 撤销这次应用：先出差异，再点一次才写盘。
   * 快照在服务端（线上那台阿里云），只还原这份提案碰过的节点/连线。
   */
  const requestRollback = useCallback(async (proposal: ActionProposal) => {
    if (streaming) return;
    try {
      if (rollbackConfirmId !== proposal.id) {
        const preview = await rollbackProposalApi(proposal.id, true);
        const summary = preview.summary;
        setRollbackConfirmId(proposal.id);
        setNotice(
          `撤销会删 ${summary.removedNodes.length} 个节点、恢复 ${summary.restoredNodes.length} 个节点、`
          + `边 −${summary.removedEdges}/+${summary.restoredEdges}。`
          + (summary.conflicts.length
            ? `其中 ${summary.conflicts.length} 个节点在应用后改过，撤销会覆盖。`
            : '')
          + '再点一次确认。',
        );
        return;
      }
      await rollbackProposalApi(proposal.id, false);
      setRollbackConfirmId('');
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [rollbackConfirmId, streaming]);

  /**
   * 续跑：只跑观察里还没记到的节点，跑完一项记一步。
   * 关页面不会丢进度——下一次打开读的是同一份作业。
   */
  const resumeJobRun = useCallback(async (job: AgentJobView, nodes: string[]) => {
    if (!nodes.length || streaming) return;
    setJobNoticeHidden(true);
    setStreaming(true);
    setError('');
    try {
      for (const nodeId of nodes) {
        const result = await batchApplyChanges(
          [{ type: 'execute_node_skill', nodeId }],
          undefined,
          undefined,
          conversationIdRef.current,
          [...citedNodesRef.current, ...effectedRef.current.map((node) => node.id)],
          (step) => {
            void postAgentJobObservation(job.id, {
              proposalId: String(job.result?.proposalId || ''),
              nodeId: step.nodeId,
              outcome: step.status === 'failed'
                ? 'failed'
                : step.status === 'done' ? 'applied' : 'discarded',
              ...(step.message ? { error: step.message } : {}),
            }).catch(() => { /* 观察写不上不阻断 */ });
          },
        );
        if (result.failedExecution) break;
      }
      void ackAgentJob(job.id, 'finish', { result: { resumed: true } }).catch(() => { /* 账本失败不阻断 */ });
      setActiveJob(null);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : String(resumeError));
    } finally {
      setStreaming(false);
    }
  }, [streaming]);

  const insertCanvasSelection = useCallback(() => {
    const snapshot = getCanvasSnapshot();
    const selected = snapshot.nodes.filter((node) => snapshot.selectedNodeIds.includes(node.id));
    const line = selected.length
      ? selected.map((node) => `${node.type}#${node.id}`).join('、')
      : '当前没有选中节点';
    const root = composerRef.current;
    if (root) {
      const has = composerPlainText(root).length > 0;
      root.append(document.createTextNode(`${has ? '\n' : ''}参考画布：${line}`));
      setInput(composerPlainText(root));
    }
    setMenu('');
  }, []);

  const stopStreaming = useCallback(() => {
    const wasStreaming = Boolean(abortRef.current);
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    // 取消要留痕：下一轮读得到，才不会按被取消的旧计划默默续跑。
    if (wasStreaming && conversationIdRef.current) {
      void cancelAgentTurn(conversationIdRef.current).catch(() => { /* 留痕失败不阻断本地停止 */ });
    }
  }, []);

  const toggleFloating = useCallback(() => {
    if (floating) {
      setFloating(false);
      setMenu('');
      return;
    }
    const root = portalRoot;
    const panel = panelRef.current;
    if (root && panel) {
      const rootRect = root.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const desired = {
        x: Math.max(12, panelRect.left - rootRect.left),
        y: Math.max(72, panelRect.top - rootRect.top),
      };
      const nextWidth = expanded
        ? Math.min(640, Math.max(360, root.clientWidth - 24))
        : width;
      const nextHeight = Math.min(560, Math.max(320, root.clientHeight - 96));
      const placement = resolveFloatingPlacement(
        root,
        panel,
        desired,
        nextWidth,
        nextHeight,
      );
      setFloatingPosition({ x: placement.x, y: placement.y });
      setFloatingHeight(placement.height);
    }
    setFloating(true);
    setMenu('');
  }, [expanded, floating, portalRoot, width]);

  const beginPanelDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!floating || event.button !== 0) return;
      if ((event.target as HTMLElement).closest('button,input,textarea,.canvas-agent-composer-input')) return;
      const root = portalRoot;
      const panel = panelRef.current;
      if (!root || !panel) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const start = { ...floatingPosition };
      let latest = start;
      let frame = 0;
      panel.classList.add('is-dragging');
      panel.style.willChange = 'translate';
      const paint = () => {
        frame = 0;
        panel.style.translate = `${latest.x - start.x}px ${latest.y - start.y}px`;
      };
      const move = (moveEvent: PointerEvent) => {
        const maxX = Math.max(12, root.clientWidth - panel.offsetWidth - 12);
        const maxY = Math.max(72, root.clientHeight - panel.offsetHeight - 12);
        latest = {
          x: Math.min(maxX, Math.max(12, start.x + moveEvent.clientX - startX)),
          y: Math.min(maxY, Math.max(72, start.y + moveEvent.clientY - startY)),
        };
        if (!frame) frame = requestAnimationFrame(paint);
      };
      const finish = () => {
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        const placement = resolveFloatingPlacement(
          root,
          panel,
          latest,
          panel.offsetWidth,
          floatingHeight,
        );
        panel.style.left = `${placement.x}px`;
        panel.style.top = `${placement.y}px`;
        panel.style.height = `${placement.height}px`;
        panel.style.translate = 'none';
        panel.style.willChange = '';
        panel.classList.remove('is-dragging');
        setFloatingPosition({ x: placement.x, y: placement.y });
        setFloatingHeight(placement.height);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish, { once: true });
      window.addEventListener('pointercancel', finish, { once: true });
    },
    [floating, floatingHeight, floatingPosition, portalRoot],
  );

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || expanded || floating) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = width;
      const move = (moveEvent: PointerEvent) => {
        setWidth(Math.max(360, Math.min(680, startWidth + startX - moveEvent.clientX)));
      };
      const finish = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish, { once: true });
    },
    [expanded, floating, width],
  );

  const mentionQueryText = (mentionQuery || '').toLowerCase();
  const mentionMatches = (label: string, id: string) => (
    !mentionQueryText || label.toLowerCase().includes(mentionQueryText) || id.toLowerCase().includes(mentionQueryText)
  );
  const mentionSnapshot = mentionQuery === null ? null : getCanvasSnapshot();
  const mentionNodes = mentionSnapshot
    ? mentionCandidates(mentionSnapshot).filter((item) => mentionMatches(item.label, item.id))
    : [];
  const mentionModels = mentionSnapshot
    ? mentionModelCandidates(mentionSnapshot.availableModels).filter((item) => mentionMatches(item.label, item.id))
    : [];
  const mentionItems = [...mentionNodes, ...mentionModels];

  if (!portalRoot || !visible) return null;
  const floatingWidth = expanded
    ? Math.min(640, Math.max(360, portalRoot.clientWidth - 24))
    : width;
  const panelStyle = floating
    ? {
        width: floatingWidth,
        height: floatingHeight,
        left: floatingPosition.x,
        top: floatingPosition.y,
        right: 'auto',
        bottom: 'auto',
      }
    : expanded
      ? undefined
      : { width };

  return createPortal(
    <div
      className="canvas-agent-layer"
      onPointerDown={stopEvent}
      onPointerMove={stopEvent}
      onPointerUp={stopEvent}
      onPointerCancel={stopEvent}
      onMouseDown={stopEvent}
      onClick={stopEvent}
      onDoubleClick={stopEvent}
      onWheel={stopEvent}
      onKeyDownCapture={stopEvent}
      onKeyUpCapture={stopEvent}
    >
      <AnimatePresence initial={false}>
        {open ? (
          <motion.aside
            ref={panelRef}
            key="panel"
            className={`canvas-agent-panel${expanded ? ' is-expanded' : ''}${floating ? ' is-floating' : ''}`}
            style={panelStyle}
            initial={{ opacity: 0, x: 24, y: 20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 20, y: 12 }}
            transition={spring}
            aria-label="Canvas Agent"
          >
            <div className="canvas-agent-resize" onPointerDown={beginResize} />
            <header className="canvas-agent-header" onPointerDown={beginPanelDrag}>
              <button
                type="button"
                className="canvas-agent-icon"
                aria-label="新对话"
                onClick={startNewConversation}
              >
                <Square aria-hidden="true" />
              </button>
              {renaming ? (
                <input
                  className="canvas-agent-title-input"
                  value={title}
                  autoFocus
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={() => void persistTitle()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') void persistTitle();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="canvas-agent-session"
                  onClick={() => setMenu((value) => (value === 'history' ? '' : 'history'))}
                >
                  <span>{title || '未命名对话'}</span>
                  <ChevronDown aria-hidden="true" />
                </button>
              )}
              {menu === 'history' ? (
                <div className="canvas-agent-menu canvas-agent-menu-history">
                  <div className="canvas-agent-history-head">
                    <span>历史对话</span>
                    <button type="button" onClick={startNewConversation}>
                      <Plus aria-hidden="true" />
                      新建
                    </button>
                  </div>
                  <div className="canvas-agent-history-list">
                    {conversations.length ? (
                      conversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          className={conversation.id === conversationId ? 'is-active' : ''}
                        >
                          <button
                            type="button"
                            onClick={() => void showConversation(conversation.id)}
                          >
                            <span>{conversation.title}</span>
                            <small>
                              {new Date(conversation.updated_at).toLocaleDateString('zh-CN')}
                            </small>
                          </button>
                          <button
                            type="button"
                            aria-label={`删除${conversation.title}`}
                            onClick={() => void removeConversation(conversation.id)}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p>还没有已保存的对话</p>
                    )}
                  </div>
                </div>
              ) : null}
              <div className="canvas-agent-header-actions">
                <button
                  type="button"
                  className="canvas-agent-dock-toggle"
                  aria-label={floating ? '停靠在右侧' : '切换为浮窗'}
                  title={floating ? '停靠在右侧' : '切换为浮窗'}
                  onClick={toggleFloating}
                >
                  {floating ? <PanelRight aria-hidden="true" /> : <Move aria-hidden="true" />}
                  <span>{floating ? '停靠在右侧' : '切换为浮窗'}</span>
                </button>
                <button type="button" aria-label="重命名" onClick={() => setRenaming(true)}>
                  <Pencil aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={expanded ? '退出展开' : '展开'}
                  onClick={() => setExpanded((value) => !value)}
                >
                  <Maximize2 aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="更多"
                  onClick={() => setMenu((value) => (value === 'more' ? '' : 'more'))}
                >
                  <MoreHorizontal aria-hidden="true" />
                </button>
              </div>
              {menu === 'more' ? (
                <div className="canvas-agent-menu canvas-agent-menu-more">
                  <button type="button" onClick={startNewConversation}>
                    新建对话
                  </button>
                  <button type="button" onClick={() => { setOpen(false); setMenu(''); }}>
                    收起面板
                  </button>
                </div>
              ) : null}
            </header>

            <div ref={bodyRef} className="canvas-agent-body">
              {!messages.length ? (
                <motion.div
                  className="canvas-agent-empty"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={spring}
                >
                  <Sparkles aria-hidden="true" />
                  <h3>探索创作方向</h3>
                  <p>描述镜头、节奏或工作流。建/连/改按「执行模式」落板；运行一律等审批卡。</p>
                </motion.div>
              ) : null}
              {activeJob && !jobNoticeHidden && !streaming ? (() => {
                const beat = activeJob.heartbeat_at || activeJob.updated_at || 0;
                const alive = Date.now() - beat < 90_000;
                const waiting = activeJob.status === 'waiting_approval';
                const interrupted = !waiting && !alive;
                const runIds = Array.isArray(activeJob.result?.runNodeIds)
                  ? (activeJob.result?.runNodeIds as unknown[]).map(String).filter(Boolean)
                  : [];
                const remaining = runIds.length ? remainingRunNodes(runIds, activeJob.observations) : [];
                const resumable = remaining.length > 0 && !waiting;
                return (
                  <div className={`canvas-agent-job ${waiting ? 'is-waiting' : resumable || interrupted ? 'is-interrupted' : 'is-running'}`}>
                    <span>
                      {waiting
                        ? '上一轮的提案还在等你确认。'
                        : resumable
                          ? `上一轮执行到 ${runIds.length - remaining.length}/${runIds.length}，还剩 ${remaining.length} 个节点。`
                          : interrupted
                            ? '上一轮已经中断（很久没有心跳了）。'
                            : '这一轮还在进行中，可能开在另一个标签页。'}
                    </span>
                    {resumable ? (
                      <button type="button" onClick={() => void resumeJobRun(activeJob, remaining)}>
                        继续执行
                      </button>
                    ) : interrupted ? (
                      <button
                        type="button"
                        onClick={() => {
                          const lastAssistant = [...messages].reverse().find((item) => item.role === 'assistant');
                          if (lastAssistant) retryFrom(lastAssistant.id);
                        }}
                      >
                        重试上一轮
                      </button>
                    ) : null}
                    <button type="button" aria-label="忽略" onClick={() => setJobNoticeHidden(true)}>
                      <X aria-hidden="true" />
                    </button>
                  </div>
                );
              })() : null}
              {messages.map((message) => (
                <article key={message.id} className={`canvas-agent-message is-${message.role}`}>
                  <div className="canvas-agent-message-head">
                    {message.role === 'assistant' ? (
                      <span className="canvas-agent-avatar is-agent" aria-hidden="true">
                        <Sparkles />
                      </span>
                    ) : null}
                    <span className="canvas-agent-message-name">
                      {message.role === 'user' ? 'YOU' : 'Agent'}
                    </span>
                    <span className="canvas-agent-message-time">{formatTurnTime(message.createdAt)}</span>
                    {message.role === 'user' ? (
                      <span className="canvas-agent-avatar is-user" aria-hidden="true">我</span>
                    ) : null}
                  </div>
                  {message.role === 'assistant' && message.thinking ? (
                    <ThinkingFold text={message.thinking}>
                      <AssistantMarkdown text={message.thinking} />
                    </ThinkingFold>
                  ) : null}
                  {message.role === 'user' ? (
                    <p>{message.content ? <UserMessageBody content={message.content} /> : null}</p>
                  ) : message.content ? (
                    <AssistantMarkdown text={message.content} />
                  ) : (
                    <AssistantMarkdown text={streaming && !message.asks?.length ? '正在构思…' : ''} />
                  )}
                  {message.asks?.length ? <p className="canvas-agent-turn-kicker">已询问</p> : null}
                  {proposals.filter((item) => item.messageId === message.id && item.effectedNodes?.length).map((item) => (
                    <EffectLabels key={item.id} nodes={item.effectedNodes || []} />
                  ))}
                  {message.asks?.some((card) => card.mode !== 'approve_run_node') ? (
                    <AskPager
                      cards={message.asks.filter((card) => card.mode !== 'approve_run_node')}
                      answers={message.asks.filter((card) => card.mode !== 'approve_run_node').every((card) => askAnswers[`${message.id}:${card.id}`])
                        ? message.asks.filter((card) => card.mode !== 'approve_run_node').flatMap((card) => {
                          const answer = askAnswers[`${message.id}:${card.id}`];
                          return answer ? [answer] : [];
                        })
                        : undefined}
                      onSubmit={(answers) => submitAsks(message.id, answers)}
                    />
                  ) : null}
                  {message.asks?.filter((card) => card.mode === 'approve_run_node').map((card) => (
                    <AskCardView
                      key={card.id}
                      card={card}
                      nodeLabels={nodeLabelsFor(card.node_keys || [])}
                      answer={askAnswers[`${message.id}:${card.id}`]}
                      onSubmit={(answer) => submitAsk(message.id, answer)}
                    />
                  ))}
                  {message.role === 'assistant' && message.content ? (
                    <div className="canvas-agent-message-tools">
                      <button
                        type="button"
                        aria-label="复制"
                        onClick={() => void navigator.clipboard.writeText(message.content)}
                      >
                        <Copy aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="有帮助"
                        className={message.reaction === 'up' ? 'is-active' : ''}
                        onClick={() =>
                          setMessages((items) =>
                            items.map((item) =>
                              item.id === message.id
                                ? { ...item, reaction: item.reaction === 'up' ? undefined : 'up' }
                                : item,
                            ),
                          )
                        }
                      >
                        <ThumbsUp aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="没帮助"
                        className={message.reaction === 'down' ? 'is-active' : ''}
                        onClick={() =>
                          setMessages((items) =>
                            items.map((item) =>
                              item.id === message.id
                                ? { ...item, reaction: item.reaction === 'down' ? undefined : 'down' }
                                : item,
                            ),
                          )
                        }
                      >
                        <ThumbsDown aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="重试" onClick={() => retryFrom(message.id)}>
                        <RotateCcw aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
              {proposalRows.map(({ proposal, open }) => {
                let clampLines: string[] = [];
                try {
                  const snapshot = getCanvasSnapshot();
                  clampLines = referenceClampLabels(
                    proposal.actions,
                    snapshot.nodes,
                    CANVAS_GENERATOR_TYPES,
                    proposal.userMessage,
                    snapshot.connections,
                    conversationId,
                    citedNodesRef.current,
                  );
                } catch {
                  clampLines = [];
                }
                const touchedIds = proposal.actions.flatMap((action) => {
                  if (action.type === 'execute_node_skill' || action.type === 'update_node_params') return [action.nodeId];
                  if (action.type === 'connect_nodes') return [action.sourceNodeId, action.targetNodeId];
                  return [];
                });
                return (
                  <Fragment key={proposal.id}>
                    <ProposalPreviewCard
                      proposal={proposal}
                      open={open}
                      clampLines={clampLines}
                      nodeLabels={nodeLabelsFor(touchedIds)}
                      canContinue={Boolean(jobIdOfProposal(proposal))}
                      onContinue={() => continueJob(proposal)}
                      canRollback={proposal.status === 'applied' || proposal.status === 'partial'}
                      rollbackConfirm={rollbackConfirmId === proposal.id}
                      onRollback={() => void requestRollback(proposal)}
                      onToggle={() => setProposalOpen((current) => ({ ...current, [proposal.id]: !open }))}
                      onApply={applyProposal}
                      onDiscard={discardProposal}
                    />
                    {localRunCards[proposal.id] && proposal.status === 'pending' ? (
                      <AskCardView
                        card={localRunCards[proposal.id]}
                        nodeLabels={nodeLabelsFor(localRunCards[proposal.id].node_keys || [])}
                        onSubmit={(answer) => answerLocalRun(proposal.id, answer.selected[0] === '批准')}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
              {toolLogs.length ? (
                <div className="canvas-agent-processed">
                  <button type="button" onClick={() => setLogsOpen((value) => !value)}>
                    工具调用明细
                    <ChevronDown className={logsOpen ? 'is-open' : ''} aria-hidden="true" />
                  </button>
                  {logsOpen
                    ? toolLogs.map((log) => (
                        <div key={log.id}>
                          <span>{log.label}</span>
                          {log.state === 'queued' ? null : (
                            <small>{log.state === 'running' ? '运行中' : log.state === 'done' ? '已执行' : '失败'}</small>
                          )}
                        </div>
                      ))
                    : null}
                </div>
              ) : null}
              {impactChoice?.length ? (
                <section className="canvas-agent-impact" aria-label="下游处理">
                  <h4>下游已有成片</h4>
                  <p>上游变了。这些节点不会自动重跑，请选择怎么处理。</p>
                  {impactChoice.map((choice) => (
                    <div key={choice.nodeId}>
                      <span>{choice.label}</span>
                      <small title={choice.nodeId}>{choice.failed ? '已废弃' : ''}</small>
                    </div>
                  ))}
                  <div className="canvas-agent-proposal-buttons">
                    <button type="button" onClick={() => queueImpact('redo')}>原节点重做</button>
                    <button type="button" onClick={() => queueImpact('replace')}>新建替换</button>
                  </div>
                  <button type="button" className="canvas-agent-impact-skip" onClick={() => setImpactChoice(null)}>
                    先不动
                  </button>
                </section>
              ) : null}
              {error ? <div className="canvas-agent-error">{error}</div> : null}
              {notice ? <div className="canvas-agent-notice">{notice}</div> : null}
            </div>

            <footer className="canvas-agent-dock">
              {showAppsHint ? (
                <button type="button" className="canvas-agent-apps-hint" onClick={() => setMenu('plus')}>
                  <Sparkles aria-hidden="true" />
                  <span>使用应用拓展 Agent 能力</span>
                  <X
                    aria-hidden="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowAppsHint(false);
                    }}
                  />
                </button>
              ) : null}
              {mentionItems.length ? (
                <div className="canvas-agent-mentions" role="listbox" aria-label="引用节点或模型">
                  {mentionNodes.length ? (
                    <section>
                      <h5>节点</h5>
                      {mentionNodes.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => addMention(item)}
                        >
                          <span className="canvas-agent-mention-thumb">
                            {item.media === 'video' && item.preview ? (
                              <video src={item.preview} muted playsInline preload="metadata" />
                            ) : item.thumb || item.preview ? (
                              <img
                                src={item.thumb || item.preview}
                                alt=""
                                onError={(event) => {
                                  const image = event.currentTarget;
                                  if (image.dataset.fallback || !item.preview) return;
                                  image.dataset.fallback = '1';
                                  image.src = item.preview;
                                }}
                              />
                            ) : item.media === 'video' ? <Film aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
                          </span>
                          <span>{item.label}</span>
                          {item.lifecycle === 'discarded' ? <small>已废弃</small> : null}
                        </button>
                      ))}
                    </section>
                  ) : null}
                  {mentionModels.length ? (
                    <section>
                      <h5>模型</h5>
                      {mentionModels.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => addMention(item)}
                        >
                          <span className="canvas-agent-mention-thumb is-model">
                            {item.group === '视频' ? <Film aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
                          </span>
                          <span>{item.label}</span>
                          <small>{item.group}</small>
                        </button>
                      ))}
                    </section>
                  ) : null}
                </div>
              ) : null}
              <div className="canvas-agent-composer">
                <div className="canvas-agent-field">
                  <div
                    ref={composerRef}
                    className={`canvas-agent-composer-input${input.trim() ? '' : ' is-empty'}`}
                    contentEditable
                    role="textbox"
                    aria-multiline="true"
                    spellCheck={false}
                    data-placeholder="随心输入，@ 可引用节点或模型"
                    suppressContentEditableWarning
                    onInput={syncComposer}
                    onScroll={() => {
                      document.querySelectorAll('.canvas-agent-mention-preview.is-open').forEach((node) => {
                        node.classList.remove('is-open');
                      });
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      const text = event.clipboardData.getData('text/plain');
                      const sel = window.getSelection();
                      if (!sel || !sel.rangeCount) return;
                      const range = sel.getRangeAt(0);
                      range.deleteContents();
                      const node = document.createTextNode(text);
                      range.insertNode(node);
                      placeCaretAfter(node);
                      syncComposer();
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (
                        composerRef.current
                        && event.key.length === 1
                        && !event.metaKey
                        && !event.ctrlKey
                        && !event.altKey
                      ) keepCaretAfterSkill(composerRef.current);
                      if (event.key === 'Backspace' && composerRef.current && removeMentionBeforeCaret(composerRef.current)) {
                        event.preventDefault();
                        syncComposer();
                        return;
                      }
                      if (event.key === 'Backspace' && playbookId && !input.trim()) {
                        event.preventDefault();
                        setPlaybookId('');
                        return;
                      }
                      if (event.key === 'Escape' && mentionQuery !== null) {
                        event.preventDefault();
                        setMentionQuery(null);
                        return;
                      }
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        if (mentionItems.length) {
                          addMention(mentionItems[0]);
                          return;
                        }
                        sendMessage();
                      }
                    }}
                  />
                </div>
                <div className="canvas-agent-composer-bar">
                  <button
                    type="button"
                    aria-label="添加"
                    onClick={() => setMenu((value) => (value === 'plus' ? '' : 'plus'))}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="执行模式"
                    onClick={() => setMenu((value) => (value === 'mode' ? '' : 'mode'))}
                  >
                    <Hand aria-hidden="true" />
                  </button>
                  <span className="canvas-agent-shortcut">K</span>
                  <button
                    type="button"
                    aria-label="语音输入暂未接入"
                    onClick={() => setNotice('语音输入暂未接入')}
                  >
                    <Mic aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="canvas-agent-send"
                    onClick={streaming ? stopStreaming : sendMessage}
                    disabled={!streaming && !input.trim() && !playbookId}
                    aria-label={streaming ? '停止生成' : '发送'}
                  >
                    {streaming ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
                  </button>
                </div>
              </div>
              {menu === 'plus' || menu === 'skills' || menu === 'apps' ? (
                <div className="canvas-agent-menu canvas-agent-menu-plus">
                  <button type="button" onClick={insertCanvasSelection}>
                    <ImagePlus aria-hidden="true" />
                    从画布添加
                  </button>
                  <button type="button" disabled title="附件上传尚未接入">
                    <Paperclip aria-hidden="true" />
                    上传附件
                  </button>
                  <button type="button" onClick={() => setMenu('skills')}>
                    <Sparkles aria-hidden="true" />
                    技能
                    <ChevronDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fillComposer('先头脑风暴三个可拍的镜头方向，先不要改画布。');
                      setMenu('');
                    }}
                  >
                    <Sparkles aria-hidden="true" />
                    头脑风暴
                  </button>
                  <button type="button" onClick={() => setMenu('apps')}>
                    <LayoutGrid aria-hidden="true" />
                    全部应用
                    <ChevronDown aria-hidden="true" />
                  </button>
                  {menu === 'skills' ? (
                    <div className="canvas-agent-submenu">
                      {agentPlaybooks.length
                        ? agentPlaybooks.map((playbook) => (
                            <button
                              key={playbook.id}
                              type="button"
                              onClick={() => {
                                setPlaybookId(playbook.id);
                                setMenu('');
                              }}
                            >
                              <span>
                                {playbook.title}
                                <small>{playbook.when}</small>
                              </span>
                            </button>
                          ))
                        : (
                            <button type="button" disabled title="技能稍后接入">
                              技能稍后接入
                            </button>
                          )}
                      {canvasSkillRegistry.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => {
                            fillComposer(`使用「${skill.name}」处理当前选中节点。${skill.description}`);
                            setMenu('');
                          }}
                        >
                          {skill.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {menu === 'apps' ? (
                    <div className="canvas-agent-submenu">
                      {AGENT_CREATABLE_NODE_TYPES.slice(0, 12).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            fillComposer(`创建一个 ${type} 节点，并说明它在当前工作流中的作用。`);
                            setMenu('');
                          }}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {menu === 'mode' ? (
                <div className="canvas-agent-menu canvas-agent-menu-mode">
                  <button type="button" onClick={() => { setMode('confirm'); setMenu(''); }}>
                    <Hand aria-hidden="true" />
                    <span>
                      <strong>手动确认（只批生成）</strong>
                      <small>建/连/改自动落板，只有生成等审批卡</small>
                    </span>
                    {mode === 'confirm' ? <Check aria-hidden="true" /> : null}
                  </button>
                  <button type="button" onClick={() => { setMode('auto'); setMenu(''); }}>
                    <Sparkles aria-hidden="true" />
                    <span>
                      <strong>逐步确认</strong>
                      <small>建/连/改也停在待确认，点应用才落板</small>
                    </span>
                    {mode === 'auto' ? <Check aria-hidden="true" /> : null}
                  </button>
                  <p className="canvas-agent-menu-note">
                    手动确认：建/连/改直接落板，只有运行等审批卡。逐步确认：每一步都停在待确认。
                    运行在任何模式下都要审批卡，和这个开关无关。
                  </p>
                </div>
              ) : null}
            </footer>
          </motion.aside>
        ) : (
          <motion.button
            key="toggle"
            type="button"
            className="canvas-agent-toggle"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, x: 18, y: 20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 14 }}
            transition={spring}
            aria-label="打开 Canvas Agent"
          >
            <Bot aria-hidden="true" />
            <span>Agent</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>,
    portalRoot,
  );
}



