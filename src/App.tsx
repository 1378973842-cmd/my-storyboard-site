import React, { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { useStore } from './store/useStore';
import { 
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Play, 
  Loader2, 
  Film, 
  Sparkles, 
  Info,
  Upload,
  User,
  Map,
  X,
  Plus,
  PenTool,
  Maximize2,
  History,
  LayoutGrid,
  List,
  Download,
  Layout,
  CheckCircle2,
  Image as ImageIcon,
  FileText
} from 'lucide-react';
import { cn } from './lib/utils';
import { StyleBase, ReferenceImage } from './types';
import { STYLES, STORYBOARD_TEXT_MODEL } from './constants';
import { StoryboardCard } from './components/StoryboardCard';
import { StoryboardGridCard } from './components/StoryboardGridCard';
import { ProjectManager } from './components/ProjectManager';
import { CoverPage } from './components/CoverPage';
import { StudioTopNav } from './components/StudioTopNav';
import { FrameDetail } from './components/FrameDetail';
import { ImageEditorModal } from './components/ImageEditorModal';
import { StandaloneImageEditorPage } from './components/StandaloneImageEditorPage';
import { NineGridPage } from './components/NineGridPage';
import { DirectorWorkbenchPage } from './pages/DirectorWorkbenchPage';
import { InfiniteCanvasPage } from './pages/InfiniteCanvasPage';
import { MyFavoritesPage } from './pages/MyFavoritesPage';
import { GalleryPage } from './pages/GalleryPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { ZoomableLightboxImage } from './components/ZoomableLightboxImage';
import { GlobalNoticeCenter } from './components/GlobalNoticeCenter';
import { Folder, Save } from 'lucide-react';
import { parseApiResponse } from './lib/http';
import { SystemNotice } from './types';
import { useShellNavigation } from './shell/ShellNavigation';
import { useStudioCoverEnterKeys } from './shell/useStudioCoverEnterKeys';
import { resolveStudioNavActive } from './shell/resolveStudioNavActive';
import { StudioHeroShell } from './components/StudioHeroShell';
import { StudioConvergePiece } from './components/motion/StudioConverge';
import { CoverPageTransition } from './components/motion/CoverPageTransition';
import { isInfiniteCanvasEditorOpen } from './lib/infiniteCanvas/canvasEngine.js';

const ReferenceItem = ({ 
  asset, 
  index, 
  total, 
  draggedItemIndex,
  setDraggedItemIndex,
  handleDrag,
  handleDrop,
  replaceTargetId,
  removeReference,
  updateReferenceName,
  reorderReferences,
  setPreviewImage,
  allReferences
}: { 
  asset: ReferenceImage, 
  index: number, 
  total: number,
  draggedItemIndex: number | null,
  setDraggedItemIndex: (index: number | null) => void,
  handleDrag: any,
  handleDrop: any,
  replaceTargetId: string | null,
  removeReference: (id: string) => void,
  updateReferenceName: (id: string, name: string) => void,
  reorderReferences: (start: number, end: number) => void,
  setPreviewImage: (img: ReferenceImage) => void,
  allReferences: ReferenceImage[],
  key?: string
}) => {
  const [tempName, setTempName] = useState(asset.name);
  const itemRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const openImageEditor = useStore((s) => s.openImageEditor);

  // Keep local input in sync when external name changes
  React.useEffect(() => {
    setTempName(asset.name);
  }, [asset.name]);

  return (
    <Reorder.Item 
      as="div"
      value={asset}
      id={asset.id}
      ref={itemRef}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98, zIndex: 50 }}
      transition={{
        layout: { type: "spring", stiffness: 300, damping: 30 },
        y: { type: "spring", stiffness: 300, damping: 30 },
        opacity: { duration: 0.2 },
      }}
      onDragStart={() => {
        setDraggedItemIndex(index);
        isDraggingRef.current = true;
      }}
      onDragEnd={() => {
        setDraggedItemIndex(null);
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 100);
      }}
      // Keep native drop events for file replacement
      onDragEnter={(e) => handleDrag(e, null, true, asset.id)}
      onDragOver={(e) => {
        e.preventDefault();
        handleDrag(e, null, true, asset.id);
      }}
      onDragLeave={(e) => handleDrag(e, null, true, null as any)}
      onDrop={(e) => handleDrop(e, asset.type, true, asset.id, index)}
      className={cn(
        "group relative shrink-0 w-24 cursor-grab active:cursor-grabbing",
        draggedItemIndex === index && "z-50"
      )}
    >
      {/* Drag Tooltip */}
      {draggedItemIndex === index && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-white text-xs px-2.5 py-1 rounded-md whitespace-nowrap pointer-events-none z-[60] shadow-lg flex items-center justify-center">
          {asset.name || `图片${index + 1}`}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-black rotate-45" />
        </div>
      )}

      <div className={cn(
        "w-full rounded-xl overflow-hidden transition-all duration-200 ai-editor-ref-tile flex flex-col",
        replaceTargetId === asset.id 
          ? "ring-2 ring-white/30 scale-[1.02]" 
          : "hover:outline-white/16",
        draggedItemIndex === index ? "opacity-60 scale-90 shadow-xl" : "opacity-100 scale-100"
      )}>
        {/* Image Area */}
        <div
          className="relative h-24 cursor-pointer overflow-hidden"
          data-theme-preserve="dark"
          onClick={(e) => {
          if (isDraggingRef.current) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          setPreviewImage(asset);
        }}
        >
          <img src={asset.url} className="w-full h-full object-cover pointer-events-none" draggable={false} />
          
          {/* Overlay Badges */}
          <div className="absolute top-1 left-1 flex gap-1">
            <span className="px-1.5 py-0.5 bg-black/80 backdrop-blur-md rounded text-[8px] font-black text-white outline outline-[0.5px] outline-white/15">
              #{index + 1}
            </span>
          </div>

          {/* Quick Actions Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="absolute top-1 right-1 flex gap-1 opacity-90 group-hover:opacity-100 transition-opacity z-20">
            <button
              onClick={(e) => {
                e.stopPropagation();
                openImageEditor({ kind: 'reference', id: asset.id, url: asset.url, title: asset.name });
              }}
              className="p-1 bg-black/75 backdrop-blur-md text-white rounded-full hover:bg-primary hover:text-black transition-all outline outline-[0.5px] outline-white/15"
              title="编辑"
            >
              <PenTool className="w-2.5 h-2.5" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); removeReference(asset.id); }}
              className="p-1 bg-black/75 backdrop-blur-md text-white rounded-full hover:bg-red-500 hover:text-white transition-all outline outline-[0.5px] outline-white/15"
              title="删除"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>

        {/* Name Editor */}
        <div className="h-8 bg-black/40 backdrop-blur-sm px-1.5">
          <input
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={() => {
              const next = tempName.trim() || `图片${index + 1}`;
              if (next !== asset.name) updateReferenceName(asset.id, next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const next = tempName.trim() || `图片${index + 1}`;
                if (next !== asset.name) updateReferenceName(asset.id, next);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder={`图片${index + 1}`}
            className="w-full h-full bg-transparent text-[11px] text-[var(--cover-fg-warm)] placeholder:text-[color-mix(in_srgb,var(--cover-fg-warm)_55%,transparent)] focus:outline-none text-center font-medium"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
        
        {replaceTargetId === asset.id && (
          <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center backdrop-blur-[2px] pointer-events-none z-20">
            <div className="bg-blue-500 p-2 rounded-full shadow-2xl animate-bounce">
              <Sparkles className="w-4 h-4 text-black" />
            </div>
          </div>
        )}
      </div>
    </Reorder.Item>
  );
};

export default function App() {
  const { 
    context,
    setContext,
    script, 
    setScript, 
    selectedStyle, 
    setStyle, 
    imageSize,
    setImageSize,
    aspectRatio,
    setAspectRatio,
    isGeneratingScript, 
    setGeneratingScript,
    data, 
    setData,
    references,
    selectedShotNumber,
    setSelectedShotNumber,
    addReference,
    updateReferenceName,
    reorderReferences,
    removeReference,
    projectTitle
  } = useStore();
  const imageEditor = useStore((s) => s.imageEditor);
  const closeImageEditor = useStore((s) => s.closeImageEditor);
  const openImageEditor = useStore((s) => s.openImageEditor);
  const updateGlobalSceneImage = useStore((s) => s.updateGlobalSceneImage);

  const {
    screen,
    studioKeepAlive,
    imageEditorKeepAlive,
    nineGridKeepAlive,
    directorWorkbenchKeepAlive,
    infiniteCanvasKeepAlive,
    openCover,
    openStudio,
    openImageEditor: openImageEditorScreen,
    openNineGrid,
    openDirectorWorkbench,
    openInfiniteCanvas,
  } = useShellNavigation();

  const showCoverPage = screen === 'cover';
  const showImageEditorPage = screen === 'image-editor';
  const showNineGridPage = screen === 'nine-grid';
  const showDirectorWorkbenchPage = screen === 'director';
  const showInfiniteCanvasPage = screen === 'infinite-canvas';
  const showMainStudio = screen === 'studio';
  const showMyFavoritesPage = screen === 'my-favorites';
  const showGalleryPage = screen === 'gallery';
  const showAdminUsersPage = screen === 'admin-users';
  const subPage = showMyFavoritesPage
    ? 'my-favorites'
    : showGalleryPage
      ? 'gallery'
      : showAdminUsersPage
        ? 'admin-users'
        : undefined;

  /** 回到首页时确保画布层不挡滚轮（z-index + body 标记） */
  useEffect(() => {
    if (showCoverPage) {
      document.body.dataset.infiniteCanvasEditor = '0';
    }
  }, [showCoverPage]);

  const jumpByNotice = (notice: SystemNotice) => {
    const action = notice.action;
    if (!action) return;
    if (action.type === 'open-editor') {
      openImageEditorScreen();
      return;
    }
    if (action.type === 'open-nine-grid') {
      openNineGrid();
      return;
    }
    if (action.type === 'open-shot') {
      openStudio();
      setSelectedShotNumber(action.shotNumber);
      return;
    }
    openStudio();
  };

  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<'character' | 'scene'>('character');
  const [dragActiveType, setDragActiveType] = useState<'character' | 'scene' | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<ReferenceImage | null>(null);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingGlobalAsset, setIsGeneratingGlobalAsset] = useState<string | null>(null);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState<string | null>(null);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [sceneImageSize, setSceneImageSize] = useState('2K');
  const [sceneAspectRatio, setSceneAspectRatio] = useState('16:9');
  const [isScenePreviewOpen, setIsScenePreviewOpen] = useState(false);
  const [isSceneHistoryOpen, setIsSceneHistoryOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [showLibrary, setShowLibrary] = useState(false);
  const studioTransitionKeys = useStudioCoverEnterKeys(screen);

  const handleCanvasExitHome = () => {
    if (isInfiniteCanvasEditorOpen() && !window.confirm('确定退出无限画布并返回网站首页？')) {
      return;
    }
    openCover();
  };

  const PRESET_IMAGES = [
    { id: 'p1', name: '赛博都市', url: 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&q=80', type: 'scene' as const },
    { id: 'p2', name: '荒野实验室', url: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80', type: 'scene' as const },
    { id: 'p3', name: '主角设定', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80', type: 'character' as const },
    { id: 'p4', name: '反派设定', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80', type: 'character' as const },
  ];

  // 当数据更新时，重置选中的场景索引
  React.useEffect(() => {
    setSelectedSceneIndex(0);
  }, [data]);

  const characterRefs = useMemo(() => references.filter(r => r.type === 'character'), [references]);
  const sceneRefs = useMemo(() => references.filter(r => r.type === 'scene'), [references]);

  const filteredStoryboards = useMemo(() => {
    if (!data?.storyboards) return [];
    if (activeFilter === 'All') return data.storyboards;
    
    return data.storyboards.filter(shot => {
      const text = (shot.summary + ' ' + (shot.director_notes || '')).toLowerCase();
      if (activeFilter === 'Action') return text.includes('动作') || text.includes('跑') || text.includes('打') || text.includes('action');
      if (activeFilter === 'Dialogue') return text.includes('对话') || text.includes('说') || text.includes('dialogue');
      if (activeFilter === 'Establishing') return text.includes('全景') || text.includes('空镜') || text.includes('establishing') || text.includes('远景');
      return true;
    });
  }, [data?.storyboards, activeFilter]);

  const handleUpdateSceneDescription = (index: number, newDescription: string) => {
    if (data) {
      const newData = {
        ...data,
        global_assets: {
          ...data.global_assets,
          scenes: data.global_assets.scenes.map((scene, i) => {
            if (i === index) {
              return {
                ...scene,
                description: newDescription
              };
            }
            return scene;
          })
        }
      };
      setData(newData);
    }
  };

  const handleGenerateSceneDescription = async (index: number) => {
    setIsGeneratingDescription(index.toString());
    setError(null);
    try {
      const res = await fetch('/api/generate-scene-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          context,
          style: selectedStyle,
          index,
          textModel: STORYBOARD_TEXT_MODEL,
        })
      });
      const result = await parseApiResponse(res);
      if (!res.ok) throw new Error(result.error || '描述生成失败');
      
      if (data) {
        const newData = {
          ...data,
          global_assets: {
            ...data.global_assets,
            scenes: data.global_assets.scenes.map((scene, i) => {
              if (i === index) {
                return {
                  ...scene,
                  description: result.description
                };
              }
              return scene;
            })
          }
        };
        setData(newData);
      }
    } catch (err) {
      console.error('Scene description generation error:', err);
      setError(err instanceof Error ? err.message : '生成描述失败');
    } finally {
      setIsGeneratingDescription(null);
    }
  };

  const handleGenerateGlobalAsset = async (prompt: string, index: number) => {
    setIsGeneratingGlobalAsset(index.toString());
    setError(null);
    try {
      // 移除类似 "@资产1_核心场景空境：" 的前缀，避免干扰生图 API
      // 同时移除换行符和控制字符，确保提示词纯净
      let cleanPrompt = prompt
        .replace(/@资产\d+[^：:]*[：:]\s*/g, '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim();
      
      // 传完整 references：服务端按提示词中的图N 下标挂载参考图；前端预过滤会破坏「图2」与数组下标对齐

      // 如果是 Pixar 画风，且提示词中没有包含该风格，则自动增强提示词
      const pixarPrefix = "迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色。";
      const finalPrompt = selectedStyle === 'Pixar' && !cleanPrompt.includes('迪士尼皮克斯')
        ? `${pixarPrefix}${cleanPrompt}`
        : cleanPrompt;

      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          image_size: sceneImageSize,
          aspect_ratio: sceneAspectRatio,
          references,
        })
      });
      const result = await parseApiResponse(res);
      if (!res.ok) throw new Error(result.error || '生成失败');
      
      if (data) {
        const newData = {
          ...data,
          global_assets: {
            ...data.global_assets,
            scenes: data.global_assets.scenes.map((scene, i) => {
              if (i === index) {
                return {
                  ...scene,
                  image_url: result.url,
                  image_history: [result.url, ...(scene.image_history || [])]
                };
              }
              return scene;
            })
          }
        };
        setData(newData);
      }
    } catch (err) {
      console.error('Global asset generation error:', err);
      setError(err instanceof Error ? err.message : '生成资产图失败');
    } finally {
      setIsGeneratingGlobalAsset(null);
    }
  };

  const handleQuickSave = async () => {
    const { currentProjectId, projectTitle, script, selectedStyle, imageSize, aspectRatio, references, data, setCurrentProjectId } = useStore.getState();
    
    setIsSaving(true);
    const id = currentProjectId || Math.random().toString(36).substr(2, 9);
    
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id,
          title: projectTitle,
          script,
          selectedStyle,
          imageSize,
          aspectRatio,
          references,
          data
        })
      });

      if (res.ok) {
        setCurrentProjectId(id);
      }
    } catch (error) {
      console.error('Failed to quick save', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!script.trim()) return;
    
    setError(null);
    setGeneratingScript(true);
    setData(null); // 立即清空旧数据，触发右侧 Loading 视图
    setIsSidebarCollapsed(true); // 自动收起侧边栏，凸显高级感

    try {
      const res = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          script: `[镜头0: 核心场景空境] ${data?.global_assets.scenes[0].description || ''}\n\n${script}`, 
          context,
          style: selectedStyle,
          references: references.map((r, index) => ({
            index: index + 1,
            name: r.name,
            type: r.type
          })),
          textModel: STORYBOARD_TEXT_MODEL,
        }),
      });
      
      const result = await parseApiResponse(res);

      if (!res.ok) {
        throw new Error(result.error || '导演大脑连接失败');
      }

      setData(result);
    } catch (error) {
      console.error('Generation failed', error);
      setError(error instanceof Error ? error.message : '生成失败，请稍后重试');
    } finally {
      setGeneratingScript(false);
    }
  };

  const processFile = (file: File, type: 'character' | 'scene', replaceId?: string) => {
    if (!file.type.startsWith('image/')) return;
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      if (replaceId) {
        useStore.getState().updateReference(replaceId, base64);
      } else {
        const { references: refs } = useStore.getState();
        const n = refs.filter((r) => r.type === type).length + 1;
        const label = type === 'character' ? '角色' : '场景';
        const name = `${label} ${String(n).padStart(2, '0')}`;
        addReference({
          id: Math.random().toString(36).substr(2, 9),
          url: base64,
          name,
          type: type
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file, uploadType);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrag = (e: React.DragEvent, type: 'character' | 'scene' | null, isReplace = false, id?: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only show upload UI if it's a file drag
    const isFile = e.dataTransfer.types.includes('Files');
    if (!isFile) return;

    if (e.type === "dragenter" || e.type === "dragover") {
      if (isReplace) setReplaceTargetId(id || null);
      else setDragActiveType(type);
    } else if (e.type === "dragleave") {
      if (isReplace) setReplaceTargetId(null);
      else setDragActiveType(null);
    }
  };

  const handleDrop = (e: React.DragEvent, type: 'character' | 'scene', isReplace = false, id?: string, targetIndex?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveType(null);
    setReplaceTargetId(null);
    
    // Handle file drop
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file, type, id);
      return;
    }
  };

  const triggerUpload = (type: 'character' | 'scene') => {
    setUploadType(type);
    fileInputRef.current?.click();
  };

  return (
    <>
      <GlobalNoticeCenter onNoticeClick={jumpByNotice} />
      <StudioTopNav
        active={resolveStudioNavActive(screen)}
        variant="overlay"
        hideFeatureNav={!showCoverPage}
        subPage={subPage}
        showCanvasTopbarSlot={showInfiniteCanvasPage && !showCoverPage}
        onHome={showInfiniteCanvasPage && !showCoverPage ? handleCanvasExitHome : undefined}
      />
      <MyFavoritesPage shellActive={showMyFavoritesPage} />
      <GalleryPage shellActive={showGalleryPage} />
      <AdminUsersPage shellActive={showAdminUsersPage} />
      {/* Keep editor mounted after first open (cover / main studio), so draft persists */}
      {(showImageEditorPage || imageEditorKeepAlive) && (
        <StudioHeroShell active={showImageEditorPage && !showCoverPage}>
          <StandaloneImageEditorPage enterKey={studioTransitionKeys['image-editor']} />
        </StudioHeroShell>
      )}

      {(showDirectorWorkbenchPage || directorWorkbenchKeepAlive) && (
        <StudioHeroShell active={showDirectorWorkbenchPage && !showCoverPage}>
          <DirectorWorkbenchPage enterKey={studioTransitionKeys.director} />
        </StudioHeroShell>
      )}

      {(infiniteCanvasKeepAlive || showInfiniteCanvasPage) && (
        <StudioHeroShell
          active={showInfiniteCanvasPage && !showCoverPage}
          className="studio-shell-canvas"
        >
          <InfiniteCanvasPage
            enterKey={studioTransitionKeys['infinite-canvas']}
            shellActive={showInfiniteCanvasPage && !showCoverPage}
            onBack={openCover}
          />
        </StudioHeroShell>
      )}

      {(showNineGridPage || nineGridKeepAlive) && (
        <StudioHeroShell active={showNineGridPage && !showCoverPage}>
          <NineGridPage enterKey={studioTransitionKeys['nine-grid']} />
        </StudioHeroShell>
      )}

      <CoverPageTransition
        show={showCoverPage}
        instantExit={showInfiniteCanvasPage && !showCoverPage}
        enterKey={studioTransitionKeys.cover}
        onStart={openStudio}
        onOpenImageEditor={openImageEditorScreen}
        onOpenNineGrid={openNineGrid}
        onOpenDirectorWorkbench={openDirectorWorkbench}
        onOpenInfiniteCanvas={openInfiniteCanvas}
      />

      {(showMainStudio || studioKeepAlive) && (
        <StudioHeroShell active={showMainStudio && !showCoverPage}>
        <div
          className="h-full min-h-0 overflow-hidden relative ai-editor-page storyboard-page studio-page-shell flex flex-col"
          data-ui-root
          data-cover-page
          data-studio-page
        >
          <div className="studio-page-bg pointer-events-none fixed inset-0 z-0" aria-hidden />
          <div className="studio-page-scrim pointer-events-none fixed inset-0 z-0" aria-hidden />
          <div className="studio-page-glow pointer-events-none fixed inset-0 z-0 cover-ambient" aria-hidden />

          <div className="studio-page-content ai-editor-layout relative z-10 flex flex-col flex-1 min-h-0 w-full mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pb-4 md:pb-5">
            <StudioConvergePiece origin="top" enterKey={studioTransitionKeys.studio} delay={0.03}>
              <header className="shrink-0 mb-3 lg:mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                <div>
                  <h1 className="cover-tools-headline text-[1.75rem] sm:text-[2rem] lg:text-[2.15rem] tracking-[-0.035em] leading-[1.08]">
                    分镜
                  </h1>
                  <p className="cover-tools-subhead mt-1 text-[14px] sm:text-[15px] leading-snug">
                    剧本拆解、场景配置与镜头序列编排。
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleQuickSave}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full ai-editor-btn-secondary text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                    title="快速保存"
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    保存
                  </button>
                  <button
                    onClick={() => setIsProjectManagerOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full cover-hero-cta text-[12px] font-medium cursor-pointer"
                    title="项目管理"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    项目
                  </button>
                </div>
              </header>
            </StudioConvergePiece>

            <div className="ai-editor-workspace flex-1 min-h-0 flex gap-4 lg:gap-5 xl:gap-6 min-h-0">
          <ProjectManager isOpen={isProjectManagerOpen} onClose={() => setIsProjectManagerOpen(false)} />
          
          {/* Left Panel */}
          <StudioConvergePiece
            origin="left"
            enterKey={studioTransitionKeys.studio}
            delay={0.07}
            className="shrink-0 min-h-0"
          >
          <motion.aside 
            initial={false}
            animate={{ 
              width: isSidebarCollapsed ? 0 : "30%",
              minWidth: isSidebarCollapsed ? 0 : "380px",
              opacity: isSidebarCollapsed ? 0 : 1,
              pointerEvents: isSidebarCollapsed ? 'none' : 'auto'
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="ai-editor-sidebar storyboard-sidebar-shell relative overflow-hidden shrink-0"
          >
            <div className="ai-editor-panel ai-editor-sidebar-panel rounded-[1.15rem] h-full min-h-0 flex flex-col overflow-hidden min-w-[380px]">
              <div className="shrink-0 p-4 md:p-5 outline outline-[0.5px] outline-white/[0.06]">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="min-w-0 flex-1">
                    <div className="cover-section-label mb-1">当前项目</div>
                    <h2 className="text-[14px] font-medium truncate text-[var(--cover-fg-warm)]">{projectTitle}</h2>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button 
                      onClick={() => setIsSidebarCollapsed(true)}
                      className="p-2 rounded-full ai-editor-btn-secondary transition-colors cursor-pointer"
                      title="收起侧边栏"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => setIsProjectManagerOpen(true)}
                      className="p-2 rounded-full ai-editor-btn-secondary transition-colors cursor-pointer"
                      title="编辑项目"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 md:p-5 pt-0 space-y-6 custom-scrollbar">
                {/* Configuration Section */}
                <section className="space-y-3">
                  <div className="cover-section-label">项目配置</div>
                  
                  <div className="space-y-3 rounded-xl p-3 ai-editor-panel">
                    <div className="space-y-2">
                      <label className="cover-section-label mb-0 text-[12px]">视觉风格</label>
                      <div className="relative">
                        <select 
                          value={selectedStyle}
                          onChange={(e) => setStyle(e.target.value as any)}
                          className="w-full ai-editor-select rounded-xl px-4 py-2.5 text-[13px] font-medium focus:outline-none focus-visible:ring-2 accent-focus-ring appearance-none cursor-pointer"
                        >
                          {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50 pointer-events-none" />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="cover-section-label mb-0 text-[12px]">全局语境</label>
                      <textarea 
                        value={context}
                        onChange={(e) => setContext(e.target.value)}
                        placeholder="定义世界观、时间与氛围…"
                        className="w-full ai-editor-input rounded-xl p-3 resize-none focus:outline-none focus-visible:ring-2 accent-focus-ring text-[13px] leading-relaxed h-24"
                      />
                    </div>
                  </div>
                </section>

                {/* Reference Assets Section */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="cover-section-label mb-0">参考素材</div>
                    <button 
                      onClick={() => setShowLibrary(!showLibrary)}
                      className={cn(
                        "text-[12px] font-medium transition-colors flex items-center gap-1.5",
                        showLibrary ? "text-[var(--cover-fg-warm)]" : "ai-editor-body hover:text-[var(--cover-fg-warm)]"
                      )}
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      {showLibrary ? '收起库' : '素材库'}
                    </button>
                  </div>

                  {showLibrary && (
                    <div className="grid grid-cols-4 gap-2 p-3 ai-editor-panel animate-in fade-in slide-in-from-top-2">
                      {PRESET_IMAGES.map(img => (
                        <button
                          key={img.id}
                          onClick={() => addReference({
                            id: Math.random().toString(36).substr(2, 9),
                            url: img.url,
                            name: img.name,
                            type: img.type
                          })}
                          className="relative aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-primary transition-all group"
                        >
                          <img src={img.url} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-primary/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Plus className="w-4 h-4 text-black" />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-6">
                    {/* Character Zone */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 opacity-70" />
                          <span className="cover-section-label mb-0 text-[12px]">角色</span>
                        </div>
                        <span className="ai-editor-stat text-[12px]">{characterRefs.length} 张</span>
                      </div>

                      <Reorder.Group 
                        as="div"
                        axis="x"
                        values={characterRefs}
                        onReorder={(newOrder) => {
                          const otherRefs = references.filter(r => r.type !== 'character');
                          useStore.setState({ references: [...newOrder, ...otherRefs] });
                        }}
                        className={cn(
                          "flex flex-row gap-3 p-3 ai-editor-dropzone ai-editor-dropzone--compact transition-all relative min-h-[7.5rem] overflow-x-auto items-center custom-scrollbar",
                          dragActiveType === 'character' && "outline-white/20"
                        )}
                        onDragEnter={(e: any) => handleDrag(e, 'character')}
                        onDragOver={(e: any) => handleDrag(e, 'character')}
                        onDragLeave={(e: any) => handleDrag(e, null)}
                        onDrop={(e: any) => handleDrop(e, 'character')}
                      >
                        {characterRefs.map((ref) => (
                          <ReferenceItem 
                            key={ref.id} 
                            asset={ref} 
                            index={references.indexOf(ref)} 
                            total={references.length}
                            draggedItemIndex={draggedItemIndex}
                            setDraggedItemIndex={setDraggedItemIndex}
                            handleDrag={handleDrag}
                            handleDrop={handleDrop}
                            replaceTargetId={replaceTargetId}
                            removeReference={removeReference}
                            updateReferenceName={updateReferenceName}
                            reorderReferences={reorderReferences}
                            setPreviewImage={setPreviewImage}
                            allReferences={references}
                          />
                        ))}
                        
                        <button 
                          onClick={() => triggerUpload('character')}
                          className="shrink-0 w-20 h-20 flex flex-col items-center justify-center gap-1 rounded-xl ai-editor-upload-tile cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-[10px] font-medium">上传</span>
                        </button>
                      </Reorder.Group>
                    </div>

                    {/* Scene Zone */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <Map className="w-3.5 h-3.5 opacity-70" />
                          <span className="cover-section-label mb-0 text-[12px]">场景</span>
                        </div>
                        <span className="ai-editor-stat text-[12px]">{sceneRefs.length} 张</span>
                      </div>

                      <Reorder.Group 
                        as="div"
                        axis="x"
                        values={sceneRefs}
                        onReorder={(newOrder) => {
                          const otherRefs = references.filter(r => r.type !== 'scene');
                          useStore.setState({ references: [...otherRefs, ...newOrder] });
                        }}
                        className={cn(
                          "flex flex-row gap-3 p-3 ai-editor-dropzone ai-editor-dropzone--compact transition-all relative min-h-[7.5rem] overflow-x-auto items-center custom-scrollbar",
                          dragActiveType === 'scene' && "outline-white/20"
                        )}
                        onDragEnter={(e: any) => handleDrag(e, 'scene')}
                        onDragOver={(e: any) => handleDrag(e, 'scene')}
                        onDragLeave={(e: any) => handleDrag(e, null)}
                        onDrop={(e: any) => handleDrop(e, 'scene')}
                      >
                        {sceneRefs.map((ref) => (
                          <ReferenceItem 
                            key={ref.id} 
                            asset={ref} 
                            index={references.indexOf(ref)} 
                            total={references.length}
                            draggedItemIndex={draggedItemIndex}
                            setDraggedItemIndex={setDraggedItemIndex}
                            handleDrag={handleDrag}
                            handleDrop={handleDrop}
                            replaceTargetId={replaceTargetId}
                            removeReference={removeReference}
                            updateReferenceName={updateReferenceName}
                            reorderReferences={reorderReferences}
                            setPreviewImage={setPreviewImage}
                            allReferences={references}
                          />
                        ))}
                        
                        <button 
                          onClick={() => triggerUpload('scene')}
                          className="shrink-0 w-20 h-20 flex flex-col items-center justify-center gap-1 rounded-xl ai-editor-upload-tile cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-[10px] font-medium">上传</span>
                        </button>
                      </Reorder.Group>
                    </div>

                  </div>
                </section>

                {/* Script Section */}
                <section className="space-y-3">
                  <div className="cover-section-label">剧本文本</div>
                  <div className="rounded-xl p-3 ai-editor-panel">
                    <textarea 
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      placeholder="在此粘贴剧本大纲或分场描述…"
                      className="w-full ai-editor-input rounded-xl p-3 resize-none focus:outline-none focus-visible:ring-2 accent-focus-ring text-[13px] leading-relaxed h-44"
                    />
                  </div>
                </section>
              </div>

              {/* Sidebar Footer Action */}
              <div className="shrink-0 p-4 md:p-5 pt-0">
                <button 
                  onClick={handleGenerate}
                  disabled={isGeneratingScript || !script.trim()}
                  className={cn(
                    "w-full py-3 rounded-full text-[13px] font-medium flex items-center justify-center gap-2 transition-all cursor-pointer",
                    isGeneratingScript || !script.trim()
                      ? "ai-editor-btn-disabled"
                      : "cover-hero-cta"
                  )}
                >
                  {isGeneratingScript ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      生成中…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      生成分镜
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.aside>
          </StudioConvergePiece>

    <AnimatePresence>
      {isSidebarCollapsed && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="fixed left-4 top-1/2 -translate-y-1/2 z-[60] flex flex-col items-center gap-3"
        >
          <motion.button
            type="button"
            onClick={() => setIsSidebarCollapsed(false)}
            className="w-10 h-10 rounded-full cover-hero-cta flex items-center justify-center shadow-[0_0_24px_rgba(255,184,102,0.35)] hover:brightness-110 transition-all active:scale-95 cursor-pointer"
            title="展开侧边栏"
          >
            <ChevronRight className="w-6 h-6" />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Right Panel */}
      <StudioConvergePiece
        origin="right"
        enterKey={studioTransitionKeys.studio}
        delay={0.11}
        className="flex-1 min-h-0 min-w-0"
      >
      <main className="storyboard-workspace-main h-full min-h-0 relative custom-scrollbar p-4 md:p-5 lg:p-6">
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-red-500/15 outline outline-[0.5px] outline-red-400/25 text-red-200 text-[13px] flex items-center gap-2 animate-in fade-in slide-in-from-top-4">
            <Info className="w-4 h-4" />
            {error}
          </div>
        )}

        {!data && !isGeneratingScript ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 rounded-2xl ai-editor-panel flex items-center justify-center mb-5">
              <Play className="w-7 h-7 opacity-60" />
            </div>
            <h2 className="cover-tools-subhead text-[17px] mb-2">准备好开始创作了吗？</h2>
            <p className="ai-editor-body text-[14px] max-w-md">在左侧输入剧本并选择画风，系统将自动拆解分镜并生成视觉参考。</p>
          </div>
        ) : (
          <div className="max-w-none mx-auto space-y-8 pb-8">
            {/* Key Scene Header - Technical Dashboard Style */}
            {data?.global_assets && (
              <div className="ai-editor-panel rounded-[1.15rem] overflow-hidden no-print">
                <div className="flex items-center justify-between px-5 py-3 outline outline-[0.5px] outline-white/[0.06]">
                  <div className="cover-section-label mb-0">场景配置</div>
                  <div className="flex items-center gap-2">
                    <span className="ai-editor-body text-[12px]">当前场景</span>
                    <select 
                      value={selectedSceneIndex}
                      onChange={(e) => setSelectedSceneIndex(Number(e.target.value))}
                      className="ai-editor-select rounded-full px-3 py-1.5 text-[12px] focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer"
                    >
                      {data.global_assets.scenes.map((_, i) => (
                        <option key={i} value={i}>场景 {i + 1}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {data.global_assets.scenes[selectedSceneIndex] && (
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_480px]">
                    <div className="p-5 space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="cover-section-label mb-0">场景描述</div>
                        <button 
                          onClick={() => handleGenerateSceneDescription(selectedSceneIndex)}
                          disabled={isGeneratingDescription === selectedSceneIndex.toString()}
                          className={cn(
                            "flex items-center gap-1.5 text-[12px] font-medium transition-all ai-editor-body hover:text-[var(--cover-fg-warm)]",
                            isGeneratingDescription === selectedSceneIndex.toString() && "opacity-80"
                          )}
                        >
                          {isGeneratingDescription === selectedSceneIndex.toString() ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenTool className="w-3.5 h-3.5" />}
                          重写提示词
                        </button>
                      </div>
                      <textarea
                        value={data.global_assets.scenes[selectedSceneIndex].description}
                        onChange={(e) => handleUpdateSceneDescription(selectedSceneIndex, e.target.value)}
                        className="w-full ai-editor-input rounded-xl p-3 text-[13px] leading-relaxed min-h-[100px] focus:outline-none focus-visible:ring-2 accent-focus-ring"
                        placeholder="描述场景参数…"
                      />
                      
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between pt-3 outline outline-[0.5px] outline-white/[0.06] -mx-1 px-1">
                        <div className="flex flex-wrap items-end gap-6">
                          <div className="space-y-2">
                            <span className="cover-section-label mb-0 text-[11px]">分辨率</span>
                            <div className="flex rounded-full p-1 ai-editor-mode-switch">
                              {['1K', '2K', '4K'].map(size => (
                                <button
                                  key={size}
                                  onClick={() => setSceneImageSize(size)}
                                  className={cn(
                                    "px-3 py-1.5 text-[12px] font-medium rounded-full transition-all cursor-pointer",
                                    sceneImageSize === size ? "ai-editor-mode-btn--active" : "ai-editor-mode-btn"
                                  )}
                                >
                                  {size}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <span className="cover-section-label mb-0 text-[11px]">画幅</span>
                            <select 
                              value={sceneAspectRatio}
                              onChange={(e) => setSceneAspectRatio(e.target.value)}
                              className="ai-editor-select rounded-full px-4 py-2 text-[12px] focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer min-w-[100px]"
                            >
                              {['1:1', '16:9', '9:16', '4:3', '3:4'].map(ratio => (
                                <option key={ratio} value={ratio}>{ratio}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        
                        <button 
                          onClick={() => handleGenerateGlobalAsset(data.global_assets.scenes[selectedSceneIndex].description, selectedSceneIndex)}
                          disabled={isGeneratingGlobalAsset === selectedSceneIndex.toString()}
                          className={cn(
                            "inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-medium transition-all cursor-pointer shrink-0",
                            isGeneratingGlobalAsset === selectedSceneIndex.toString() 
                              ? "ai-editor-btn-disabled" 
                              : "cover-hero-cta"
                          )}
                        >
                          {isGeneratingGlobalAsset === selectedSceneIndex.toString() ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          生成场景图
                        </button>
                      </div>
                    </div>

                    <div className="relative aspect-video lg:aspect-auto bg-black/30 overflow-hidden group/sceneimg flex items-center justify-center outline outline-[0.5px] outline-white/[0.06]">
                      {data.global_assets.scenes[selectedSceneIndex].image_url ? (
                        <>
                          <img 
                            src={data.global_assets.scenes[selectedSceneIndex].image_url} 
                            alt="Scene" 
                            className="w-full h-full object-cover transition-transform duration-1000 group-hover/sceneimg:scale-110 cursor-zoom-in" 
                            onClick={() => setIsScenePreviewOpen(true)}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover/sceneimg:opacity-100 transition-opacity duration-500" />
                          <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover/sceneimg:opacity-100 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] translate-y-2 group-hover/sceneimg:translate-y-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openImageEditor({
                                  kind: 'scene',
                                  sceneIndex: selectedSceneIndex,
                                  url: data.global_assets.scenes[selectedSceneIndex].image_url!,
                                  title: `场景 ${selectedSceneIndex + 1}`,
                                });
                              }}
                              className="p-2.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl text-white hover:bg-primary hover:text-black transition-all"
                              title="编辑图片"
                            >
                              <PenTool className="w-4 h-4" />
                            </button>
                            {data.global_assets.scenes[selectedSceneIndex].image_history && data.global_assets.scenes[selectedSceneIndex].image_history!.length > 1 && (
                              <button 
                                onClick={(e) => { e.stopPropagation(); setIsSceneHistoryOpen(!isSceneHistoryOpen); }}
                                className={cn(
                                  "p-2.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl text-white hover:bg-primary hover:text-black transition-all",
                                  isSceneHistoryOpen && "bg-primary text-black border-primary/50"
                                )}
                              >
                                <History className="w-4 h-4" />
                              </button>
                            )}
                            <button 
                              onClick={() => setIsScenePreviewOpen(true)}
                              className="p-2.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl text-white hover:bg-primary hover:text-black transition-all"
                            >
                              <Maximize2 className="w-4 h-4" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-3 ai-editor-body">
                          <div className="w-12 h-12 rounded-full outline outline-[0.5px] outline-white/10 flex items-center justify-center">
                            <Map className="w-6 h-6 opacity-60" />
                          </div>
                          <span className="text-[12px]">等待生成场景图</span>
                        </div>
                      )}

                      {/* History Overlay */}
                      <AnimatePresence>
                        {isSceneHistoryOpen && data.global_assets.scenes[selectedSceneIndex].image_history && (
                          <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            className="absolute inset-0 bg-black/90 backdrop-blur-2xl z-20 p-6 flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex justify-between items-center mb-6">
                              <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">History_Log ({data.global_assets.scenes[selectedSceneIndex].image_history!.length})</span>
                              <button onClick={() => setIsSceneHistoryOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3 overflow-y-auto custom-scrollbar pr-2">
                              {data.global_assets.scenes[selectedSceneIndex].image_history!.map((url, idx) => (
                                <div 
                                  key={idx} 
                                  className={cn(
                                    "relative aspect-video rounded-xl overflow-hidden border transition-all cursor-pointer group/histitem",
                                    url === data.global_assets.scenes[selectedSceneIndex].image_url ? "border-primary ring-2 ring-primary/20" : "border-white/5 hover:border-white/20"
                                  )}
                                  onClick={() => {
                                    if (data) {
                                      const newData = { ...data };
                                      newData.global_assets.scenes[selectedSceneIndex].image_url = url;
                                      setData(newData);
                                      setIsSceneHistoryOpen(false);
                                    }
                                  }}
                                >
                                  <img src={url} className="w-full h-full object-cover transition-transform duration-500 group-hover/histitem:scale-110" />
                                  {url === data.global_assets.scenes[selectedSceneIndex].image_url && (
                                    <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                                      <div className="p-1.5 bg-primary rounded-full shadow-lg">
                                        <CheckCircle2 className="w-3 h-3 text-black" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </div>
            )}

              {/* Storyboards Section Header */}
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between pb-2">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-6">
                    <div>
                      <h3 className="cover-tools-headline text-[1.5rem] sm:text-[1.75rem] tracking-[-0.03em]">镜头序列</h3>
                      <p className="cover-tools-subhead mt-1 text-[13px]">{projectTitle}</p>
                    </div>

                    <div className="ai-editor-mode-switch">
                      {[
                        { id: 'list', label: '列表' },
                        { id: 'grid', label: '网格' }
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          onClick={() => setViewMode(mode.id as 'list' | 'grid')}
                          className={cn(
                            "relative px-4 py-2 rounded-full text-[12px] font-medium transition-all cursor-pointer",
                            viewMode === mode.id ? "ai-editor-mode-btn--active" : "ai-editor-mode-btn"
                          )}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    <button 
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full ai-editor-btn-secondary text-[12px] font-medium cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      导出 PDF
                    </button>
                  </div>
                </div>

              {/* Storyboard Content */}
              {isGeneratingScript ? (
                <div className="space-y-8">
                  {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
              ) : viewMode === 'list' ? (
                <div className="space-y-8">
                  {(data?.storyboards ?? []).map((shot) => (
                    <StoryboardCard 
                      key={shot.shot_number} 
                      shot={shot} 
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-8">
                  {filteredStoryboards.map((shot) => (
                    <StoryboardGridCard 
                      key={shot.shot_number} 
                      shot={shot} 
                      onClick={() => setSelectedShotNumber(shot.shot_number)}
                    />
                  ))}
                  {filteredStoryboards.length === 0 && (
                    <div className="col-span-full py-12 text-center ai-editor-body">
                      没有符合该分类的分镜
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      </StudioConvergePiece>
            </div>
          </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[100] animate-in fade-in duration-200" data-theme-preserve="dark">
          <button
            type="button"
            className="absolute inset-0 bg-black/90 backdrop-blur-md cursor-zoom-out"
            onClick={() => setPreviewImage(null)}
            aria-label="关闭预览"
          />
          <div className="pointer-events-none absolute inset-0 flex justify-center p-3 sm:p-5">
            <button
              type="button"
              className="pointer-events-auto absolute right-4 top-4 z-[120] flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/90 outline outline-[0.5px] outline-white/15 backdrop-blur-[30px] transition-colors hover:bg-white/16 hover:text-white cursor-pointer sm:right-7 sm:top-7"
              onClick={() => setPreviewImage(null)}
              title="关闭 (Esc)"
              aria-label="关闭"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <div
              className="pointer-events-auto mt-10 flex h-[min(calc(100dvh-56px),calc(100vh-56px))] w-full max-w-4xl min-h-0 flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-2xl outline outline-[0.5px] outline-white/10 animate-in zoom-in-95 duration-200 sm:mt-12"
            >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 pt-3 pb-1">
              <ZoomableLightboxImage
                url={previewImage.url}
                resetKey={previewImage.id}
                className="h-full w-full min-h-0"
                imgClassName="rounded-lg object-contain"
              />
              <p className="shrink-0 pt-1 text-center text-[9px] text-slate-500 font-label tracking-widest uppercase">
                滚轮缩放 · 中键拖拽 · 点空白或 ✕ 关闭
              </p>
            </div>
            <div className="shrink-0 flex items-center justify-between border-t border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-lg",
                  previewImage.type === 'character' ? "bg-blue-500/20 text-blue-400" : "bg-blue-500/20 text-blue-400"
                )}>
                  {previewImage.type === 'character' ? <User className="w-5 h-5" /> : <Map className="w-5 h-5" />}
                </div>
                <div>
                  <p className="text-sm font-bold">{previewImage.name}</p>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                    {previewImage.type === 'character' ? '角色参考' : '场景参考'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { removeReference(previewImage.id); setPreviewImage(null); }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-xs font-bold transition-colors"
              >
                删除此参考
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Scene Image Preview Modal */}
      {isScenePreviewOpen && data?.global_assets.scenes[selectedSceneIndex]?.image_url && (
        <div className="fixed inset-0 z-[100] animate-in fade-in duration-200" data-theme-preserve="dark">
          <button
            type="button"
            className="absolute inset-0 bg-black/90 backdrop-blur-md cursor-zoom-out"
            onClick={() => setIsScenePreviewOpen(false)}
            aria-label="关闭预览"
          />
          <div className="pointer-events-none absolute inset-0 flex justify-center p-3 sm:p-5">
            <button
              type="button"
              className="pointer-events-auto absolute right-4 top-4 z-[120] flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/90 outline outline-[0.5px] outline-white/15 backdrop-blur-[30px] transition-colors hover:bg-white/16 hover:text-white cursor-pointer sm:right-7 sm:top-7"
              onClick={() => setIsScenePreviewOpen(false)}
              title="关闭 (Esc)"
              aria-label="关闭"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <div
              className="pointer-events-auto mt-10 flex h-[min(calc(100dvh-56px),calc(100vh-56px))] w-full max-w-5xl min-h-0 flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-2xl outline outline-[0.5px] outline-white/10 animate-in zoom-in-95 duration-200 sm:mt-12"
            >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 pt-3 pb-3">
              <ZoomableLightboxImage
                url={data.global_assets.scenes[selectedSceneIndex].image_url}
                resetKey={`scene-${selectedSceneIndex}-${data.global_assets.scenes[selectedSceneIndex].image_url}`}
                className="h-full w-full min-h-0"
                imgClassName="rounded-lg object-contain"
              />
              <p className="shrink-0 pt-2 text-center text-[9px] text-slate-500 font-label tracking-widest uppercase">
                滚轮缩放 · 中键拖拽 · 点空白或 ✕ 关闭
              </p>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Frame Detail View */}
      <AnimatePresence>
        {selectedShotNumber && <FrameDetail />}
      </AnimatePresence>
        </div>
        </StudioHeroShell>
      )}

      <ImageEditorModal
        isOpen={imageEditor.isOpen}
        target={imageEditor.target}
        appReferences={references}
        onClose={closeImageEditor}
        onApply={(url) => {
          const t = imageEditor.target;
          if (!t) return;
          if (t.kind === 'reference') {
            useStore.getState().updateReference(t.id, url);
            return;
          }
          if (t.kind === 'shot') {
            useStore.getState().updateStoryboardImage(t.shotNumber, url);
            return;
          }
          if (t.kind === 'scene') {
            updateGlobalSceneImage(t.sceneIndex, url);
          }
        }}
      />
    </>
  );
}

function SkeletonCard() {
  return (
    <div className="ai-editor-panel rounded-[1.15rem] overflow-hidden flex flex-col md:flex-row animate-pulse">
      <div className="w-full md:w-[40%] aspect-video bg-black/20" />
      <div className="flex-1 p-6 space-y-4">
        <div className="h-6 rounded-lg bg-white/10 w-3/4" />
        <div className="h-12 rounded-lg bg-white/10 w-full" />
        <div className="h-20 rounded-lg bg-white/10 w-full" />
      </div>
    </div>
  );
}
