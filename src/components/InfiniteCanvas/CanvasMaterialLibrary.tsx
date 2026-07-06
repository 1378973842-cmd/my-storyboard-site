import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { isInfiniteCanvasEditorOpen } from '../../lib/infiniteCanvas/canvasEngine.js';
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

type LibraryScope = 'personal' | 'team';

type FolderMenuAction = 'new' | 'rename' | 'move' | 'duplicate' | 'delete';

const FOLDER_MENU: { id: FolderMenuAction; label: string; icon: typeof FolderPlus; danger?: boolean }[] = [
  { id: 'new', label: '新建文件夹', icon: FolderPlus },
  { id: 'rename', label: '重命名', icon: Pencil },
  { id: 'move', label: '移动到...', icon: Folder },
  { id: 'duplicate', label: '创建副本', icon: Copy },
  { id: 'delete', label: '删除', icon: Trash2, danger: true },
];

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

function promptText(title: string, value = '', placeholder = '') {
  const next = window.prompt(title, value);
  if (next == null) return null;
  const trimmed = next.trim();
  return trimmed || null;
}

function pickTargetCategory(categories: AssetLibraryCategory[], excludeId: string) {
  const options = categories.filter(c => c.id !== excludeId);
  if (!options.length) return null;
  const lines = options.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
  const raw = window.prompt(`输入目标文件夹编号：\n${lines}`);
  if (raw == null) return null;
  const index = Number(raw) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return null;
  return options[index].id;
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ character: true });
  const [selectedFolderId, setSelectedFolderId] = useState('character');
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      if (!next.categories.some(c => c.id === selectedFolderId)) {
        setSelectedFolderId(next.categories[0]?.id || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载素材库失败');
    } finally {
      setLoading(false);
    }
  }, [scope, selectedFolderId]);

  useEffect(() => {
    if (!open || scope !== 'personal') return;
    void reloadLibrary();
  }, [open, scope, reloadLibrary]);

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

  const categories = library?.categories || [];

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map(cat => {
        const nameMatch = cat.name.toLowerCase().includes(q);
        const items = cat.items.filter(item =>
          item.name.toLowerCase().includes(q) || item.url.toLowerCase().includes(q),
        );
        if (nameMatch) return cat;
        if (items.length) return { ...cat, items };
        return null;
      })
      .filter(Boolean) as AssetLibraryCategory[];
  }, [categories, query]);

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
    if (!open) closeFolderMenu();
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

  const handleFolderMenuAction = useCallback(async (action: FolderMenuAction, folderId: string) => {
    closeFolderMenu();
    if (scope !== 'personal') return;
    const folder = categories.find(c => c.id === folderId);
    try {
      if (action === 'new') {
        const name = promptText('新建文件夹名称', '', '文件夹名称');
        if (!name) return;
        await createAssetCategory(name);
      } else if (action === 'rename') {
        const name = promptText('重命名文件夹', folder?.name || '', '文件夹名称');
        if (!name) return;
        await renameAssetCategory(folderId, name);
      } else if (action === 'duplicate') {
        await duplicateAssetCategory(folderId);
      } else if (action === 'delete') {
        if (!window.confirm(`确定删除文件夹「${folder?.name || ''}」？文件夹内素材也会一并删除。`)) return;
        await deleteAssetCategory(folderId);
      } else if (action === 'move') {
        const targetId = pickTargetCategory(categories, folderId);
        if (!targetId || !folder?.items.length) return;
        for (const item of folder.items) {
          await moveAssetItem(item.id, targetId);
        }
      }
      await reloadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }, [closeFolderMenu, scope, categories, reloadLibrary]);

  const handleRenameItem = useCallback(async (itemId: string, currentName: string) => {
    const name = promptText('重命名素材', currentName, '素材名称');
    if (!name) return;
    try {
      await renameAssetItem(itemId, name);
      await reloadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名失败');
    }
  }, [reloadLibrary]);

  const handleDeleteItem = useCallback(async (itemId: string, itemName: string) => {
    if (!window.confirm(`确定删除素材「${itemName}」？`)) return;
    try {
      await deleteAssetItem(itemId);
      await reloadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  }, [reloadLibrary]);

  const stopBubble = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  if (!active || !portalRoot || !editorVisible) return null;

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
            if (scope !== 'personal' || !selectedFolderId) return;
            if (e.dataTransfer.files?.length) {
              void uploadFilesToFolder(e.dataTransfer.files, selectedFolderId);
              return;
            }
            const url = (e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list') || '').trim();
            if (url.startsWith('/uploads/')) {
              void (async () => {
                setLoading(true);
                setError(null);
                try {
                  await addAssetItem(selectedFolderId, url);
                  await reloadLibrary();
                  setExpanded(prev => ({ ...prev, [selectedFolderId]: true }));
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

          <button type="button" className="canvas-material-library-favorites" title="收藏筛选即将上线">
            <Star className="h-3.5 w-3.5" />
            <span>收藏</span>
          </button>

          {error ? <div className="canvas-material-library-status is-error">{error}</div> : null}
          {loading ? <div className="canvas-material-library-status">加载中…</div> : null}

          <div className="canvas-material-library-section-label">文件夹</div>

          <div className="canvas-material-library-folders">
            {scope === 'team' ? (
              <div className="canvas-material-library-folder-empty">团队素材即将上线</div>
            ) : (
              filteredCategories.map(folder => {
                const isExpanded = expanded[folder.id] ?? false;
                const selected = folder.id === selectedFolderId;
                const menuOpen = menuFolderId === folder.id;
                return (
                  <div
                    key={folder.id}
                    className={`canvas-material-library-folder-block${menuOpen ? ' is-menu-open' : ''}`}
                  >
                    <div className={`canvas-material-library-folder-row${selected ? ' is-selected' : ''}${menuOpen ? ' is-menu-open' : ''}`}>
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
                    {isExpanded && (
                      <div className="canvas-material-library-folder-body">
                        {folder.items.length ? (
                          <div className="canvas-material-library-items">
                            {folder.items.map(item => (
                              <div
                                key={item.id}
                                className="canvas-material-library-item"
                                draggable
                                onDragStart={e => {
                                  e.dataTransfer.effectAllowed = 'copy';
                                  e.dataTransfer.setData('text/plain', item.url);
                                  e.dataTransfer.setData('text/uri-list', item.url);
                                }}
                              >
                                <img src={item.url} alt="" loading="lazy" draggable={false} />
                                <div className="canvas-material-library-item-meta">
                                  <span title={item.name}>{item.name}</span>
                                  <div className="canvas-material-library-item-actions">
                                    <button type="button" aria-label="重命名" onClick={() => void handleRenameItem(item.id, item.name)}>
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button type="button" aria-label="删除" onClick={() => void handleDeleteItem(item.id, item.name)}>
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="canvas-material-library-folder-empty">
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
                        )}
                      </div>
                    )}
                  </div>
                );
              })
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
              if (!files?.length || !selectedFolderId) return;
              void uploadFilesToFolder(files, selectedFolderId);
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
