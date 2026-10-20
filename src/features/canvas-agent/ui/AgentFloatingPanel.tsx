import {
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
import { isInfiniteCanvasEditorOpen } from '../../../lib/infiniteCanvas/canvasEngine.js';
import { CANVAS_GENERATOR_TYPES, batchApplyChanges, getCanvasSnapshot } from '../core/canvasFacade';
import { referenceClampLabels } from '../core/referencePrompt';
import { pendingExecutionFeedback, proposalWaitsForClick } from '../core/proposal';
import {
  deliverProposalDone,
  diskProposalOutcome,
  flushProposalWriteQueue,
  proposalOnReopen,
  runProposalApply,
} from '../core/proposalPersistence';
import { serializeCanvasContext } from '../core/contextSerializer';
import { streamCanvasAgent } from '../core/agentService';
import {
  deleteAgentConversation,
  listAgentConversations,
  loadAgentConversation,
  persistProposalOutcome,
  renameAgentConversation,
} from '../core/conversationService';
import {
  choiceActions,
  mentionCandidates,
  mentionChipToken,
  mentionModelCandidates,
  mentionQueryAt,
  stripMentionQuery,
  type ImpactChoice,
  type MentionCandidate,
} from '../core/operatingModel';
import { agentPlaybooks, canvasSkillRegistry } from '../tools/skillRegistry';
import { AGENT_CREATABLE_NODE_TYPES } from '../types';
import { ProposalPreviewCard } from './ProposalPreviewCard';
import { proposalDefaultOpen, proposalDisplayTier, sortProposalsForDisplay } from './proposalOrder';
import type {
  ActionProposal,
  AgentChatMessage,
  AgentConversation,
  AgentToolLog,
  CanvasAgentStreamEvent,
} from '../types';
import './canvas-agent.css';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
type AgentMode = 'confirm' | 'auto';
type ChatTurn = AgentChatMessage & {
  elapsedMs?: number;
  contextRatio?: number;
  reaction?: 'up' | 'down';
};

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [input, setInput] = useState('');
  const [playbookId, setPlaybookId] = useState('');
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
  }, [conversationId]);
  const [toolLogs, setToolLogs] = useState<AgentToolLog[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<AgentMode>('confirm');
  const [menu, setMenu] = useState<
    'plus' | 'mode' | 'more' | 'history' | 'skills' | 'apps' | ''
  >('');
  const [showAppsHint, setShowAppsHint] = useState(true);
  const [notice, setNotice] = useState('');
  const [impactChoice, setImpactChoice] = useState<ImpactChoice[] | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionChips, setMentionChips] = useState<Array<Pick<MentionCandidate, 'kind' | 'id' | 'label'>>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const chipRowRef = useRef<HTMLSpanElement | null>(null);
  const [chipIndent, setChipIndent] = useState(0);
  useLayoutEffect(() => {
    const node = chipRowRef.current;
    setChipIndent(node ? node.offsetWidth + 8 : 0);
  }, [playbookId, mentionChips]);
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
    const frame = requestAnimationFrame(() => setPortalRoot(rootRef.current));
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
    setConversationId(data.conversation.id);
    setTitle(data.conversation.title);
    setMessages(
      data.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
        elapsedMs: Number(message.metadata?.elapsedMs) || undefined,
      })),
    );
    replaceProposals(
      data.messages.flatMap((message) => {
        const proposal = message.metadata?.proposal;
        return proposal ? [proposalOnReopen(proposal)] : [];
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
      const outcome = await runProposalApply(proposal, {
        batchApply: (actions, onProgress) => batchApplyChanges(
          actions,
          onProgress,
          proposal.userMessage,
          conversationIdRef.current,
        ),
        update: updateProposal,
        current: () => proposalsRef.current.find((item) => item.id === proposal.id),
        persist: (current) => persistProposalOutcome(current.id, diskProposalOutcome(current)),
        queue: writeQueueRef.current,
      });
      if (outcome !== 'rejected' && outcome.choices.length) setImpactChoice(outcome.choices);
    },
    [updateProposal],
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
      if (kind === 'replace' && modeRef.current === 'auto') void applyRef.current(proposal);
    } catch (choiceError) {
      setError(choiceError instanceof Error ? choiceError.message : String(choiceError));
    }
  }, [impactChoice]);

  const discardProposal = useCallback(
    (proposal: ActionProposal) => updateProposal(proposal.id, { status: 'discarded' }),
    [updateProposal],
  );

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
      } else if (event.type === 'delta') {
        setMessages((items) =>
          items.map((item) =>
            item.id === assistantId ? { ...item, content: `${item.content}${event.text}` } : item,
          ),
        );
      } else if (event.type === 'proposal') {
        replaceProposals((items) => [...items, event.proposal]);
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
            (current) => persistProposalOutcome(current.id, diskProposalOutcome(current)),
          );
        });
      }
    },
    [finishTurn],
  );

  const sendText = useCallback(
    async (raw: string, history: ChatTurn[]) => {
      const text = raw.trim();
      if (streaming || (!text && !playbookId)) return;
      setMentionChips([]);
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
      setMessages((items) => (text ? [...items, userMessage, assistantMessage] : [...items, assistantMessage]));
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
      const requestMessages = feedback
        ? [
            ...history,
            {
              id: uid('feedback'),
              role: 'user' as const,
              content: feedback.content,
              createdAt: Date.now(),
            },
          ]
        : history;
      if (feedback) updateProposal(feedback.id, { feedbackDeliveredAt: Date.now() });
      try {
        await streamCanvasAgent({
          message: text,
          messages: requestMessages,
          snapshot,
          conversationId: conversationId || undefined,
          playbookId: playbookId || undefined,
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

  const addMention = useCallback((item: Pick<MentionCandidate, 'kind' | 'id' | 'label'>) => {
    const cursor = composerRef.current?.selectionStart ?? input.length;
    setInput((value) => stripMentionQuery(value, cursor));
    setMentionChips((chips) => (
      chips.some((chip) => chip.kind === item.kind && chip.id === item.id)
        ? chips
        : [...chips, { kind: item.kind, id: item.id, label: item.label }]
    ));
    setMentionQuery(null);
    composerRef.current?.focus();
  }, [input.length]);

  const sendMessage = useCallback(() => {
    const cited = mentionChips.map((chip) => mentionChipToken(chip)).join(' ');
    const text = [cited, input.trim()].filter(Boolean).join(' ');
    void sendText(text, messages);
  }, [input, mentionChips, messages, sendText]);

  const retryFrom = useCallback(
    (assistantId: string) => {
      const index = messages.findIndex((item) => item.id === assistantId);
      const previous = [...messages.slice(0, index)].reverse().find((item) => item.role === 'user');
      if (previous) void sendText(previous.content, messages.slice(0, index - 1));
    },
    [messages, sendText],
  );

  const insertCanvasSelection = useCallback(() => {
    const snapshot = getCanvasSnapshot();
    const selected = snapshot.nodes.filter((node) => snapshot.selectedNodeIds.includes(node.id));
    const line = selected.length
      ? selected.map((node) => `${node.type}#${node.id}`).join('、')
      : '当前没有选中节点';
    setInput((value) => `${value}${value ? '\n' : ''}参考画布：${line}`);
    setMenu('');
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
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
      if ((event.target as HTMLElement).closest('button,input,textarea')) return;
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
                  <p>描述镜头、节奏或工作流。默认会先给出建议，确认后才改画布。</p>
                </motion.div>
              ) : null}
              {messages.map((message) => (
                <article key={message.id} className={`canvas-agent-message is-${message.role}`}>
                  {message.role === 'user' ? <span>YOU</span> : null}
                  <p>{message.content || (streaming ? '正在构思…' : '')}</p>
                  {message.role === 'assistant' && message.elapsedMs ? (
                    <div className="canvas-agent-meta">
                      <span>总用时 {Math.max(1, Math.round(message.elapsedMs / 1000))}s</span>
                      {messages.find((item) => item.role === 'user' && item.createdAt <= message.createdAt)
                        ?.contextRatio ? (
                        <span>
                          上下文{' '}
                          {
                            [...messages]
                              .reverse()
                              .find((item) => item.role === 'user' && item.createdAt <= message.createdAt)
                              ?.contextRatio
                          }
                          %
                        </span>
                      ) : null}
                    </div>
                  ) : null}
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
                  );
                } catch {
                  clampLines = [];
                }
                return (
                  <ProposalPreviewCard
                    key={proposal.id}
                    proposal={proposal}
                    open={open}
                    clampLines={clampLines}
                    onToggle={() => setProposalOpen((current) => ({ ...current, [proposal.id]: !open }))}
                    onApply={applyProposal}
                    onDiscard={discardProposal}
                  />
                );
              })}
              {toolLogs.length ? (
                <div className="canvas-agent-processed">
                  <button type="button" onClick={() => setLogsOpen((value) => !value)}>
                    已处理
                    <ChevronDown className={logsOpen ? 'is-open' : ''} aria-hidden="true" />
                  </button>
                  {logsOpen
                    ? toolLogs.map((log) => (
                        <div key={log.id}>
                          <span>{log.label}</span>
                          <small>{log.state === 'queued' ? '等待确认' : log.state}</small>
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
                      <small>{choice.failed ? '已废弃' : choice.nodeId}</small>
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
                        <button key={item.id} type="button" onClick={() => addMention(item)}
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
                        <button key={item.id} type="button" onClick={() => addMention(item)}
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
                  {playbookId || mentionChips.length ? (
                    <span ref={chipRowRef} className="canvas-agent-chip-row">
                      {playbookId ? (
                        <span className="canvas-agent-skill-chip" contentEditable={false}>
                          {agentPlaybooks.find((item) => item.id === playbookId)?.title || playbookId}
                          <button
                            type="button"
                            aria-label="取消技能"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setPlaybookId('')}
                          >
                            ×
                          </button>
                        </span>
                      ) : null}
                      {mentionChips.map((chip) => (
                        <span key={`${chip.kind}:${chip.id}`} className="canvas-agent-skill-chip" contentEditable={false}>
                          {chip.label}
                          <button
                            type="button"
                            aria-label="移除引用"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setMentionChips((chips) => chips.filter((item) => item.id !== chip.id || item.kind !== chip.kind))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <textarea
                    ref={composerRef}
                    value={input}
                    style={chipIndent ? { textIndent: chipIndent } : undefined}
                    onChange={(event) => {
                    setInput(event.target.value);
                    setMentionQuery(mentionQueryAt(event.target.value, event.target.selectionStart));
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Backspace' && (mentionChips.length || playbookId)) {
                      const start = composerRef.current?.selectionStart ?? 0;
                      const end = composerRef.current?.selectionEnd ?? 0;
                      if (start === 0 && end === 0) {
                        event.preventDefault();
                        if (mentionChips.length) {
                          setMentionChips((chips) => chips.slice(0, -1));
                        } else {
                          setPlaybookId('');
                        }
                        return;
                      }
                    }
                    if (event.key === 'Escape' && mentionQuery !== null) {
                      event.preventDefault();
                      setMentionQuery(null);
                      return;
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      if (mentionItems.length) {
                        addMention(mentionItems[0]);
                        return;
                      }
                      sendMessage();
                    }
                  }}
                  placeholder="随心输入，@ 可引用节点或模型"
                  rows={2}
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
                    disabled={!streaming && !input.trim() && !playbookId && !mentionChips.length}
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
                      setInput('先头脑风暴三个可拍的镜头方向，先不要改画布。');
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
                            setInput(`使用「${skill.name}」处理当前选中节点。${skill.description}`);
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
                            setInput(`创建一个 ${type} 节点，并说明它在当前工作流中的作用。`);
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
                      <strong>手动确认</strong>
                      <small>Agent 在执行生成前都会寻求您的确认</small>
                    </span>
                    {mode === 'confirm' ? <Check aria-hidden="true" /> : null}
                  </button>
                  <button type="button" onClick={() => { setMode('auto'); setMenu(''); }}>
                    <Sparkles aria-hidden="true" />
                    <span>
                      <strong>自动生成</strong>
                      <small>结构建议自动落板；生成仍会单独确认</small>
                    </span>
                    {mode === 'auto' ? <Check aria-hidden="true" /> : null}
                  </button>
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
