import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Folder,
  FolderPlus,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';
import { isInfiniteCanvasEditorOpen, placeImageUrlOnCanvas } from '../../lib/infiniteCanvas/canvasEngine.js';
import { readJsonResponse } from '../../lib/readJsonResponse';
import {
  addAssetItem,
  createAssetCategory,
  deleteAssetCategory,
  deleteAssetItem,
  duplicateAssetCategory,
  fetchAssetLibrary,
  moveAssetItem,
  renameAssetCategory,
  renameAssetItem,
  uploadAssetItem,
  type AssetLibraryCategory,
  type AssetLibraryDoc,
} from '../../lib/assetLibraryClient';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
const FAVORITES_ID = '__favorites__';

type LibraryScope = 'personal' | 'team';
type FavoriteItem = {
  id: string;
  thumbnail_path: string;
  preview_path?: string;
  prompt: string;
  model: string;
  shared_at: string | null;
};

type FolderMenuAction = 'new' | 'rename' | 'move' | 'duplicate' | 'delete';

const FOLDER_MENU: { id: FolderMenuAction; label: string; icon: typeof FolderPlus; danger?: boolean }[] = [
  { id: 'new', label: '新建子文件夹', icon: FolderPlus },
  { id: 'rename', label: '重命名', icon: Pencil },
  { id: 'move', label: '移动素材到…', icon: Folder },
  { id: 'duplicate', label: '创建副本', icon: Copy },
  { id: 'delete', label: '删除', icon: Trash2, danger: true },
];

type InlineDraft =
  | { kind: 'create'; parentId: string | null; value: string }
  | { kind: 'rename-folder'; id: string; value: string }
  | { kind: 'rename-item'; id: string; value: string }
  | { kind: 'confirm-delete-folder'; id: string; name: string }
  | { kind: 'confirm-delete-item'; id: string; name: string }
  | { kind: 'move-items'; fromId: string };

type Props = {
  rootRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: boolean;
};

function useCanvasEditorVisible(active: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const sync = () => setVisible(isInfiniteCanvasEditorOpen());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-infinite-canvas-editor'] });
    window.addEventListener('canvas-board-bg-change', sync);
    return () => {
      obs.disconnect();
      window.removeEventListener('canvas-board-bg-change', sync);
    };
  }, [active]);
  return visible;
}

function categoryParentId(cat: AssetLibraryCategory) {
  return cat.parent_id || null;
}

export const CanvasMaterialLibrary = memo(function CanvasMaterialLibrary({
  rootRef,
  open,
  onOpenChange,
  active,
}: Props) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [scope, setScope] = useState<LibraryScope>('personal');
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<AssetLibraryDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedFolderId, setSelectedFolderId] = useState(''); // 空 = 无选中高亮，仅点击后才选中
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState<InlineDraft | null>(null);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritesBusyId, setFavoritesBusyId] = useState<string | null>(null);
  const [copiedFavoriteId, setCopiedFavoriteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  const editorVisible = useCanvasEditorVisible(active);

  useEffect(() => {
    setPortalRoot(rootRef.current);
  }, [rootRef, active, open]);

  const reloadLibrary = useCallback(async () => {
    if (scope !== 'personal') return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchAssetLibrary();
      setLibrary(next);
      if (
        selectedFolderId
        && selectedFolderId !== FAVORITES_ID
        && !next.categories.some(c => c.id === selectedFolderId)
      ) {
        setSelectedFolderId('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载素材库失败');
    } finally {
      setLoading(false);
    }
  }, [scope, selectedFolderId]);

  const favoritesHydratedRef = useRef(false);
  const reloadFavorites = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true || favoritesHydratedRef.current;
    if (!silent) setFavoritesLoading(true);
    try {
      const res = await fetch('/api/my-favorites', { credentials: 'same-origin' });
      const data = await readJsonResponse<{ items?: FavoriteItem[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || '加载收藏失败');
      setFavorites(Array.isArray(data.items) ? data.items : []);
      favoritesHydratedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载收藏失败');
    } finally {
      if (!silent) setFavoritesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || scope !== 'personal') return;
    void reloadLibrary();
    void reloadFavorites();
  }, [open, scope, reloadLibrary, reloadFavorites]);

  useEffect(() => {
    const onOpenLibrary = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      onOpenChange(true);
      if (detail?.view === 'favorites') {
        setSelectedFolderId(FAVORITES_ID);
        void reloadFavorites({ silent: true });
      }
    };
    window.addEventListener('canvas-open-material-library', onOpenLibrary);
    return () => window.removeEventListener('canvas-open-material-library', onOpenLibrary);
  }, [onOpenChange, reloadFavorites]);

  useEffect(() => {
    const onLibraryChanged = () => {
      if (!open || scope !== 'personal') return;
      void reloadLibrary();
      if (selectedFolderId === FAVORITES_ID) void reloadFavorites({ silent: true });
    };
    window.addEventListener('canvas-asset-library-changed', onLibraryChanged);
    return () => window.removeEventListener('canvas-asset-library-changed', onLibraryChanged);
  }, [open, scope, reloadLibrary, reloadFavorites, selectedFolderId]);

  const closeFolderMenu = useCallback(() => {
    setMenuFolderId(null);
    setMenuAnchor(null);
  }, []);

  useEffect(() => {
    if (!menuFolderId) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.canvas-material-library-folder-more')) return;
      closeFolderMenu();
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [menuFolderId, closeFolderMenu]);

  useEffect(() => {
    if (!draft) return;
    if (draft.kind === 'create' || draft.kind === 'rename-folder' || draft.kind === 'rename-item') {
      requestAnimationFrame(() => {
        draftInputRef.current?.focus();
        draftInputRef.current?.select();
      });
    }
  }, [draft]);

  const categories = library?.categories || [];

  const childrenOf = useCallback((parentId: string | null) => {
    return categories.filter(c => categoryParentId(c) === parentId);
  }, [categories]);

  const filteredRoots = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchCat = (cat: AssetLibraryCategory) => {
      if (!q) return true;
      if (cat.name.toLowerCase().includes(q)) return true;
      return cat.items.some(item =>
        item.name.toLowerCase().includes(q) || item.url.toLowerCase().includes(q),
      );
    };
    const visibleIds = new Set<string>();
    categories.forEach(cat => {
      if (!matchCat(cat)) return;
      visibleIds.add(cat.id);
      let pid = categoryParentId(cat);
      while (pid) {
        visibleIds.add(pid);
        const parent = categories.find(c => c.id === pid);
        pid = parent ? categoryParentId(parent) : null;
      }
    });
    const roots = categories.filter(c => !categoryParentId(c));
    if (!q) return roots;
    return roots.filter(c => visibleIds.has(c.id));
  }, [categories, query]);

  const filterItems = useCallback((cat: AssetLibraryCategory) => {
    const q = query.trim().toLowerCase();
    if (!q) return cat.items;
    if (cat.name.toLowerCase().includes(q)) return cat.items;
    return cat.items.filter(item =>
      item.name.toLowerCase().includes(q) || item.url.toLowerCase().includes(q),
    );
  }, [query]);

  const toggleFolder = useCallback((id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleFolderMenu = useCallback((folderId: string, trigger: HTMLButtonElement) => {
    if (menuFolderId === folderId) {
      closeFolderMenu();
      return;
    }
    const panel = panelRef.current ?? trigger.closest('.canvas-material-library');
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    setMenuAnchor({ top: triggerRect.top, left: panelRect.right - 16 });
    setMenuFolderId(folderId);
  }, [menuFolderId, closeFolderMenu]);

  useEffect(() => {
    if (!open) {
      closeFolderMenu();
      setDraft(null);
    }
  }, [open, closeFolderMenu]);

  const uploadFilesToFolder = useCallback(async (files: FileList | File[], folderId: string) => {
    const list = [...files].filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
    if (!list.length) {
      setError('仅支持上传图片');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      for (const file of list) {
        await uploadAssetItem(folderId, file);
      }
      await reloadLibrary();
      setExpanded(prev => ({ ...prev, [folderId]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLoading(false);
    }
  }, [reloadLibrary]);

  const commitDraft = useCallback(async () => {
    if (!draft || scope !== 'personal') return;
    try {
      if (draft.kind === 'create') {
        const name = draft.value.trim();
        if (!name) {
          setDraft(null);
          return;
        }
        const res = await createAssetCategory(name, draft.parentId);
        const newId = res?.category?.id as string | undefined;
        await reloadLibrary();
        if (draft.parentId) setExpanded(prev => ({ ...prev, [draft.parentId!]: true }));
        if (newId) {
          setSelectedFolderId(newId);
          setExpanded(prev => ({ ...prev, [newId]: true }));
        }
        setDraft(null);
        return;
      }
      if (draft.kind === 'rename-folder') {
        const name = draft.value.trim();
        if (!name) {
          setDraft(null);
          return;
        }
        await renameAssetCategory(draft.id, name);
        await reloadLibrary();
        setDraft(null);
        return;
      }
      if (draft.kind === 'rename-item') {
        const name = draft.value.trim();
        if (!name) {
          setDraft(null);
          return;
        }
        await renameAssetItem(draft.id, name);
        await reloadLibrary();
        setDraft(null);
        return;
      }
      if (draft.kind === 'confirm-delete-folder') {
        await deleteAssetCategory(draft.id);
        await reloadLibrary();
        setDraft(null);
        return;
      }
      if (draft.kind === 'confirm-delete-item') {
        await deleteAssetItem(draft.id);
        await reloadLibrary();
        setDraft(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }, [draft, scope, reloadLibrary]);

  const handleFolderMenuAction = useCallback(async (action: FolderMenuAction, folderId: string) => {
    closeFolderMenu();
    if (scope !== 'personal') return;
    const folder = categories.find(c => c.id === folderId);
    try {
      if (action === 'new') {
        setExpanded(prev => ({ ...prev, [folderId]: true }));
        setDraft({ kind: 'create', parentId: folderId, value: '' });
        return;
      }
      if (action === 'rename') {
        setDraft({ kind: 'rename-folder', id: folderId, value: folder?.name || '' });
        return;
      }
      if (action === 'duplicate') {
        await duplicateAssetCategory(folderId);
        await reloadLibrary();
        return;
      }
      if (action === 'delete') {
        setDraft({ kind: 'confirm-delete-folder', id: folderId, name: folder?.name || '' });
        return;
      }
      if (action === 'move') {
        setDraft({ kind: 'move-items', fromId: folderId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }, [closeFolderMenu, scope, categories, reloadLibrary]);

  const moveItemsToFolder = useCallback(async (fromId: string, targetId: string) => {
    const folder = categories.find(c => c.id === fromId);
    if (!folder?.items.length) {
      setDraft(null);
      return;
    }
    try {
      for (const item of folder.items) {
        await moveAssetItem(item.id, targetId);
      }
      await reloadLibrary();
      setExpanded(prev => ({ ...prev, [targetId]: true }));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '移动失败');
    }
  }, [categories, reloadLibrary]);

  const startRootCreate = useCallback(() => {
    if (scope !== 'personal') return;
    setDraft({ kind: 'create', parentId: null, value: '' });
  }, [scope]);

  const filteredFavorites = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return favorites;
    return favorites.filter(item =>
      `${item.prompt || ''} ${item.model || ''}`.toLowerCase().includes(q),
    );
  }, [favorites, query]);

  const removeFavorite = useCallback(async (item: FavoriteItem) => {
    setFavoritesBusyId(item.id);
    try {
      const res = await fetch(`/api/my-favorites/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || '取消收藏失败');
      setFavorites(prev => prev.filter(row => row.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消收藏失败');
    } finally {
      setFavoritesBusyId(null);
    }
  }, []);

  const toggleFavoriteShare = useCallback(async (item: FavoriteItem) => {
    setFavoritesBusyId(item.id);
    try {
      const path = item.shared_at
        ? `/api/my-favorites/${encodeURIComponent(item.id)}/unshare`
        : `/api/my-favorites/${encodeURIComponent(item.id)}/share`;
      const res = await fetch(path, { method: 'POST', credentials: 'same-origin' });
      const data = await readJsonResponse<{ item?: FavoriteItem; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || '操作失败');
      if (data.item) {
        setFavorites(prev => prev.map(row => (row.id === data.item!.id ? { ...row, ...data.item! } : row)));
      } else {
        await reloadFavorites();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setFavoritesBusyId(null);
    }
  }, [reloadFavorites]);

  const copyFavoritePrompt = useCallback(async (item: FavoriteItem) => {
    const text = String(item.prompt || '').trim();
    if (!text) {
      setError('该收藏没有提示词');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFavoriteId(item.id);
      window.setTimeout(() => {
        setCopiedFavoriteId(prev => (prev === item.id ? null : prev));
      }, 1200);
    } catch {
      setError('复制提示词失败');
    }
  }, []);

  const prevFolderIdRef = useRef('');
  const resolveDropFolderId = useCallback(() => {
    if (selectedFolderId && selectedFolderId !== FAVORITES_ID) return selectedFolderId;
    if (prevFolderIdRef.current && categories.some(c => c.id === prevFolderIdRef.current)) {
      return prevFolderIdRef.current;
    }
    return categories.find(c => !categoryParentId(c))?.id || categories[0]?.id || '';
  }, [selectedFolderId, categories]);

  const openFavoritesView = useCallback(() => {
    if (selectedFolderId && selectedFolderId !== FAVORITES_ID) {
      prevFolderIdRef.current = selectedFolderId;
    }
    setSelectedFolderId(FAVORITES_ID);
    // 已有列表时静默刷新，避免「加载中…」插行造成闪烁
    void reloadFavorites({ silent: true });
  }, [reloadFavorites, selectedFolderId]);

  const leaveFavoritesView = useCallback(() => {
    // 回到文件夹列表，不恢复选中高亮（未点击则无选中态）
    setSelectedFolderId('');
  }, []);

  const stopBubble = useCallback((e: SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const renderInlineNameRow = (opts: {
    depth: number;
    value: string;
    placeholder: string;
    onChange: (v: string) => void;
    onCancel: () => void;
  }) => (
    <div
      className="canvas-material-library-inline-row"
      style={{ paddingLeft: `${8 + opts.depth * 14}px` }}
    >
      <Folder className="h-3.5 w-3.5 canvas-material-library-inline-icon" />
      <input
        ref={draftInputRef}
        className="canvas-material-library-inline-input"
        value={opts.value}
        placeholder={opts.placeholder}
        onChange={e => opts.onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commitDraft();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            opts.onCancel();
          }
        }}
        onClick={e => e.stopPropagation()}
      />
      <button type="button" className="canvas-material-library-inline-action" aria-label="确认" onClick={() => void commitDraft()}>
        <Check className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="canvas-material-library-inline-action" aria-label="取消" onClick={opts.onCancel}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const renderFolderTree = (folder: AssetLibraryCategory, depth: number): ReactNode => {
    const isExpanded = expanded[folder.id] ?? false;
    const menuOpen = menuFolderId === folder.id;
    const childFolders = childrenOf(folder.id);
    const items = filterItems(folder);
    const renaming = draft?.kind === 'rename-folder' && draft.id === folder.id;
    const creatingChild = draft?.kind === 'create' && draft.parentId === folder.id;

    return (
      <div
        key={folder.id}
        className={`canvas-material-library-folder-block${menuOpen ? ' is-menu-open' : ''}`}
      >
        {renaming ? (
          renderInlineNameRow({
            depth,
            value: draft.value,
            placeholder: '文件夹名称',
            onChange: v => setDraft({ ...draft, value: v }),
            onCancel: () => setDraft(null),
          })
        ) : (
          <div
            className={`canvas-material-library-folder-row${menuOpen ? ' is-menu-open' : ''}`}
            style={{ paddingLeft: `${4 + depth * 14}px` }}
          >
            <button
              type="button"
              className="canvas-material-library-folder-main"
              onClick={() => {
                setSelectedFolderId(folder.id);
                toggleFolder(folder.id);
              }}
            >
              <ChevronRight className={`canvas-material-library-folder-chevron${isExpanded ? ' is-open' : ''}`} />
              <Folder className="h-3.5 w-3.5" />
              <span>{folder.name}</span>
              <span className="canvas-material-library-folder-count">{folder.items.length}</span>
            </button>
            <button
              type="button"
              className={`canvas-material-library-folder-more${menuOpen ? ' is-active' : ''}`}
              aria-label={`${folder.name} 更多操作`}
              aria-expanded={menuOpen}
              onClick={e => {
                e.stopPropagation();
                toggleFolderMenu(folder.id, e.currentTarget);
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        )}

        {draft?.kind === 'confirm-delete-folder' && draft.id === folder.id ? (
          <div className="canvas-material-library-inline-confirm" style={{ marginLeft: `${8 + depth * 14}px` }}>
            <span>删除「{draft.name}」及其子文件夹？</span>
            <button type="button" className="is-danger" onClick={() => void commitDraft()}>删除</button>
            <button type="button" onClick={() => setDraft(null)}>取消</button>
          </div>
        ) : null}

        {draft?.kind === 'move-items' && draft.fromId === folder.id ? (
          <div className="canvas-material-library-move-picker" style={{ marginLeft: `${8 + depth * 14}px` }}>
            <div className="canvas-material-library-move-title">移动素材到</div>
            {categories.filter(c => c.id !== folder.id).map(target => (
              <button
                key={target.id}
                type="button"
                className="canvas-material-library-move-option"
                onClick={() => void moveItemsToFolder(folder.id, target.id)}
              >
                <Folder className="h-3.5 w-3.5" />
                <span>{target.name}</span>
              </button>
            ))}
            <button type="button" className="canvas-material-library-move-cancel" onClick={() => setDraft(null)}>取消</button>
          </div>
        ) : null}

        {isExpanded && (
          <div className="canvas-material-library-folder-body">
            {creatingChild
              ? renderInlineNameRow({
                  depth: depth + 1,
                  value: draft.value,
                  placeholder: '子文件夹名称',
                  onChange: v => setDraft({ ...draft, value: v }),
                  onCancel: () => setDraft(null),
                })
              : null}
            {childFolders.map(child => renderFolderTree(child, depth + 1))}
            {items.length ? (
              <div className="canvas-material-library-items" style={{ marginLeft: `${depth * 8}px` }}>
                {items.map(item => {
                  const renamingItem = draft?.kind === 'rename-item' && draft.id === item.id;
                  const deletingItem = draft?.kind === 'confirm-delete-item' && draft.id === item.id;
                  return (
                    <div key={item.id} className="canvas-material-library-item-wrap">
                      {renamingItem ? (
                        <div className="canvas-material-library-inline-row is-item">
                          <input
                            ref={draftInputRef}
                            className="canvas-material-library-inline-input"
                            value={draft.value}
                            onChange={e => setDraft({ ...draft, value: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void commitDraft();
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setDraft(null);
                              }
                            }}
                          />
                          <button type="button" className="canvas-material-library-inline-action" aria-label="确认" onClick={() => void commitDraft()}>
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" className="canvas-material-library-inline-action" aria-label="取消" onClick={() => setDraft(null)}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="canvas-material-library-item"
                          draggable
                          role="button"
                          tabIndex={0}
                          title="点击放入画布，或拖到画布"
                          onDragStart={e => {
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData('application/x-canvas-asset-url', item.url);
                            e.dataTransfer.setData('text/uri-list', item.url);
                            e.dataTransfer.setData('text/plain', item.url);
                          }}
                          onClick={() => {
                            if (!isInfiniteCanvasEditorOpen()) return;
                            placeImageUrlOnCanvas(item.url, item.name || 'image');
                          }}
                          onKeyDown={e => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            if (!isInfiniteCanvasEditorOpen()) return;
                            placeImageUrlOnCanvas(item.url, item.name || 'image');
                          }}
                        >
                          <img src={item.url} alt="" loading="lazy" draggable={false} />
                          <div className="canvas-material-library-item-meta">
                            <span title={item.name}>{item.name}</span>
                            <div className="canvas-material-library-item-actions">
                              <button
                                type="button"
                                aria-label="重命名"
                                onClick={e => {
                                  e.stopPropagation();
                                  setDraft({ kind: 'rename-item', id: item.id, value: item.name });
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                aria-label="删除"
                                onClick={e => {
                                  e.stopPropagation();
                                  setDraft({ kind: 'confirm-delete-item', id: item.id, name: item.name });
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {deletingItem ? (
                        <div className="canvas-material-library-inline-confirm is-item">
                          <span>删除「{draft.name}」？</span>
                          <button type="button" className="is-danger" onClick={() => void commitDraft()}>删除</button>
                          <button type="button" onClick={() => setDraft(null)}>取消</button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : !childFolders.length && !creatingChild ? (
              <div className="canvas-material-library-folder-empty" style={{ marginLeft: `${depth * 8}px` }}>
                <span>拖入图片或点击上传素材</span>
                <button
                  type="button"
                  className="canvas-material-library-upload-btn"
                  onClick={() => {
                    setSelectedFolderId(folder.id);
                    fileInputRef.current?.click();
                  }}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  上传素材
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  if (!active || !portalRoot || !editorVisible) return null;

  const creatingRoot = draft?.kind === 'create' && draft.parentId == null;

  const panel = (
    <AnimatePresence>
      {open && (
        <motion.aside
          ref={panelRef}
          key="canvas-material-library"
          className={`canvas-material-library${dragOver ? ' is-drop-target' : ''}`}
          data-canvas-material-library
          initial={{ x: '-108%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '-108%', opacity: 0 }}
          transition={spring}
          onPointerDown={stopBubble}
          onMouseDown={stopBubble}
          onClick={stopBubble}
          onWheel={stopBubble}
          onDragOver={e => {
            if (scope !== 'personal') return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            if (scope !== 'personal') return;
            const targetId = resolveDropFolderId();
            if (!targetId) return;
            if (e.dataTransfer.files?.length) {
              void uploadFilesToFolder(e.dataTransfer.files, targetId);
              return;
            }
            const url = (e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list') || '').trim();
            if (url.startsWith('/uploads/')) {
              void (async () => {
                setLoading(true);
                setError(null);
                try {
                  await addAssetItem(targetId, url);
                  await reloadLibrary();
                  setExpanded(prev => ({ ...prev, [targetId]: true }));
                } catch (err) {
                  setError(err instanceof Error ? err.message : '保存到素材库失败');
                } finally {
                  setLoading(false);
                }
              })();
            }
          }}
        >
          <div className="canvas-material-library-head">
            <button
              type="button"
              className="canvas-material-library-icon-btn"
              aria-label="关闭素材库"
              onClick={() => onOpenChange(false)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="canvas-material-library-title">素材库</div>
            {scope === 'personal' ? (
              <button
                type="button"
                className="canvas-material-library-icon-btn"
                aria-label="新建主文件夹"
                title="新建主文件夹"
                onClick={startRootCreate}
              >
                <Plus className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="canvas-material-library-scope">
            <button
              type="button"
              className={scope === 'personal' ? 'is-active' : ''}
              onClick={() => setScope('personal')}
            >
              个人
            </button>
            <button
              type="button"
              className={scope === 'team' ? 'is-active' : ''}
              onClick={() => setScope('team')}
            >
              团队
            </button>
          </div>

          <label className="canvas-material-library-search">
            <Search className="h-3.5 w-3.5" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索"
            />
          </label>

          {error ? <div className="canvas-material-library-status is-error">{error}</div> : null}
          {loading && !library ? <div className="canvas-material-library-status">加载中…</div> : null}
          {favoritesLoading && selectedFolderId === FAVORITES_ID && !favorites.length ? (
            <div className="canvas-material-library-status">加载中…</div>
          ) : null}

          <div className="canvas-material-library-nav">
            <button
              type="button"
              className="canvas-material-library-favorites"
              onClick={() => {
                if (selectedFolderId === FAVORITES_ID) leaveFavoritesView();
                else openFavoritesView();
              }}
            >
              <Star className="h-3.5 w-3.5" />
              <span>收藏</span>
              <span className="canvas-material-library-folder-count">{favorites.length}</span>
            </button>
            <div className="canvas-material-library-nav-divider" aria-hidden />
            <div className="canvas-material-library-section-label">文件夹</div>
          </div>

          <div className="canvas-material-library-folders">
            {selectedFolderId === FAVORITES_ID ? (
              <div className="canvas-material-library-favorites-body">
                {filteredFavorites.length ? (
                  <div className="canvas-material-library-items">
                    {filteredFavorites.map(item => {
                      const url = item.preview_path || item.thumbnail_path;
                      const hasPrompt = Boolean(String(item.prompt || '').trim());
                      return (
                        <div
                          key={item.id}
                          className="canvas-material-library-item"
                          draggable
                          role="button"
                          tabIndex={0}
                          title={item.prompt || item.model || '收藏'}
                          onDragStart={e => {
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData('application/x-canvas-asset-url', url);
                            e.dataTransfer.setData('text/uri-list', url);
                            e.dataTransfer.setData('text/plain', url);
                          }}
                          onClick={() => {
                            if (!isInfiniteCanvasEditorOpen()) return;
                            placeImageUrlOnCanvas(url, item.model || 'favorite');
                          }}
                          onKeyDown={e => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            if (!isInfiniteCanvasEditorOpen()) return;
                            placeImageUrlOnCanvas(url, item.model || 'favorite');
                          }}
                        >
                          <img src={item.thumbnail_path || url} alt="" loading="lazy" draggable={false} />
                          <div className="canvas-material-library-item-meta">
                            <span title={item.prompt || item.model}>{item.prompt || item.model || '收藏'}</span>
                            <div className="canvas-material-library-item-actions">
                              <button
                                type="button"
                                aria-label="复制提示词"
                                title={copiedFavoriteId === item.id ? '已复制' : '复制提示词'}
                                disabled={!hasPrompt}
                                onClick={e => {
                                  e.stopPropagation();
                                  void copyFavoritePrompt(item);
                                }}
                              >
                                <ClipboardCopy className={`h-3 w-3${copiedFavoriteId === item.id ? ' is-copied' : ''}`} />
                              </button>
                              <button
                                type="button"
                                aria-label={item.shared_at ? '取消分享' : '分享到画廊'}
                                disabled={favoritesBusyId === item.id}
                                title={item.shared_at ? '取消分享' : '分享到画廊'}
                                onClick={e => {
                                  e.stopPropagation();
                                  void toggleFavoriteShare(item);
                                }}
                              >
                                <Share2 className={`h-3 w-3${item.shared_at ? ' is-shared' : ''}`} />
                              </button>
                              <button
                                type="button"
                                aria-label="取消收藏"
                                disabled={favoritesBusyId === item.id}
                                onClick={e => {
                                  e.stopPropagation();
                                  void removeFavorite(item);
                                }}
                              >
                                <StarOff className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="canvas-material-library-folder-empty">
                    <span>还没有收藏。在画布结果里点星标即可加入这里。</span>
                  </div>
                )}
              </div>
            ) : scope === 'team' ? (
              <div className="canvas-material-library-folder-empty">团队素材即将上线</div>
            ) : (
              <>
                {creatingRoot
                  ? renderInlineNameRow({
                      depth: 0,
                      value: draft.value,
                      placeholder: '主文件夹名称',
                      onChange: v => setDraft({ ...draft, value: v }),
                      onCancel: () => setDraft(null),
                    })
                  : null}
                {filteredRoots.map(folder => renderFolderTree(folder, 0))}
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={e => {
              const files = e.target.files;
              const targetId = resolveDropFolderId();
              if (!files?.length || !targetId) return;
              void uploadFilesToFolder(files, targetId);
              e.target.value = '';
            }}
          />
        </motion.aside>
      )}
    </AnimatePresence>
  );

  const menu = open && menuFolderId && menuAnchor ? (
    <div
      ref={menuRef}
      className="canvas-material-library-menu is-floating"
      role="menu"
      style={{ top: menuAnchor.top, left: menuAnchor.left }}
    >
      {FOLDER_MENU.map(item => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={item.danger ? 'is-danger' : ''}
          onClick={e => {
            e.stopPropagation();
            void handleFolderMenuAction(item.id, menuFolderId);
          }}
        >
          <item.icon className="h-3.5 w-3.5" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  ) : null;

  return createPortal(
    <>
      {panel}
      {menu}
    </>,
    portalRoot,
  );
});
