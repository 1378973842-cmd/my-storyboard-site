import React, { useState, useRef, useMemo } from 'react';
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
  FileText,
  Home
} from 'lucide-react';
import { cn } from './lib/utils';
import { StyleBase, ReferenceImage } from './types';
import { STYLES } from './constants';
import { StoryboardCard } from './components/StoryboardCard';
import { StoryboardGridCard } from './components/StoryboardGridCard';
import { ThemeToggle } from './components/ThemeToggle';
import { ProjectManager } from './components/ProjectManager';
import { CoverPage } from './components/CoverPage';
import { FrameDetail } from './components/FrameDetail';
import { ImageEditorModal } from './components/ImageEditorModal';
import { StandaloneImageEditorPage } from './components/StandaloneImageEditorPage';
import { NineGridPage } from './components/NineGridPage';
import { ZoomableLightboxImage } from './components/ZoomableLightboxImage';
import { GlobalNoticeCenter } from './components/GlobalNoticeCenter';
import { Folder, Save } from 'lucide-react';
import { parseApiResponse } from './lib/http';
import { SystemNotice } from './types';

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
        "w-full rounded-xl overflow-hidden transition-all duration-200 bg-surface-container-low/70 flex flex-col outline outline-[0.5px] outline-outline-variant/20",
        replaceTargetId === asset.id 
          ? "ring-4 ring-blue-500/10 scale-[1.02] outline-blue-500/60" 
          : "hover:outline-outline-variant/40",
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
        <div className="h-8 bg-surface-container-high/55 backdrop-blur-sm px-1.5 border-t border-white/10">
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
            className="w-full h-full bg-transparent text-[10px] text-on-surface placeholder:text-on-surface/40 focus:outline-none text-center font-medium"
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

  const jumpByNotice = (notice: SystemNotice) => {
    const action = notice.action;
    if (!action) return;
    if (action.type === 'open-editor') {
      setShowCoverPage(false);
      setShowImageEditorPage(true);
      setImageEditorKeepAlive(true);
      setShowNineGridPage(false);
      return;
    }
    if (action.type === 'open-nine-grid') {
      setShowCoverPage(false);
      setShowNineGridPage(true);
      setNineGridKeepAlive(true);
      setShowImageEditorPage(false);
      return;
    }
    if (action.type === 'open-shot') {
      setShowCoverPage(false);
      setShowImageEditorPage(false);
      setShowNineGridPage(false);
      setSelectedShotNumber(action.shotNumber);
      return;
    }
    setShowCoverPage(false);
    setShowImageEditorPage(false);
    setShowNineGridPage(false);
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
  const [showCoverPage, setShowCoverPage] = useState(true);
  const [showImageEditorPage, setShowImageEditorPage] = useState(false);
  const [showNineGridPage, setShowNineGridPage] = useState(false);
  /** 一旦打开过即保持挂载，避免进主工作室/切回首页后卸载导致草稿丢失 */
  const [imageEditorKeepAlive, setImageEditorKeepAlive] = useState(false);
  const [nineGridKeepAlive, setNineGridKeepAlive] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [showLibrary, setShowLibrary] = useState(false);

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
          index
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
          }))
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
      {/* Keep editor mounted after first open (cover / main studio), so draft persists */}
      {(showImageEditorPage || imageEditorKeepAlive) && (
        <div hidden={showCoverPage || !showImageEditorPage}>
          <StandaloneImageEditorPage
            onBack={() => {
              setShowCoverPage(true);
            }}
            onOpenStoryboard={() => {
              setShowCoverPage(false);
              setShowImageEditorPage(false);
              setShowNineGridPage(false);
            }}
            onOpenNineGrid={() => {
              setShowCoverPage(false);
              setShowNineGridPage(true);
              setNineGridKeepAlive(true);
              setShowImageEditorPage(false);
            }}
          />
        </div>
      )}

      {/* Keep 9-grid mounted after first open (cover / main studio), so history & grids persist */}
      {(showNineGridPage || nineGridKeepAlive) && (
        <div hidden={showCoverPage || !showNineGridPage}>
          <NineGridPage
            onBack={() => {
              setShowCoverPage(true);
            }}
            onOpenStoryboard={() => {
              setShowCoverPage(false);
              setShowImageEditorPage(false);
              setShowNineGridPage(false);
            }}
            onOpenImageEditor={() => {
              setShowCoverPage(false);
              setShowImageEditorPage(true);
              setImageEditorKeepAlive(true);
              setShowNineGridPage(false);
            }}
          />
        </div>
      )}

      {showCoverPage ? (
        <CoverPage
          onStart={() => {
            setShowCoverPage(false);
            setShowImageEditorPage(false);
            setShowNineGridPage(false);
          }}
          onOpenImageEditor={() => {
            setShowCoverPage(false);
            setShowImageEditorPage(true);
            setImageEditorKeepAlive(true);
            setShowNineGridPage(false);
          }}
          onOpenNineGrid={() => {
            setShowCoverPage(false);
            setShowNineGridPage(true);
            setNineGridKeepAlive(true);
            setShowImageEditorPage(false);
          }}
        />
      ) : showImageEditorPage || showNineGridPage ? null : (
        <div
          className="flex h-screen bg-surface text-slate-100 font-sans overflow-hidden"
          data-ui-root
        >
          <ProjectManager isOpen={isProjectManagerOpen} onClose={() => setIsProjectManagerOpen(false)} />
          
          {/* Left Panel */}
          <motion.aside 
            initial={false}
            animate={{ 
              width: isSidebarCollapsed ? 0 : "30%",
              minWidth: isSidebarCollapsed ? 0 : "380px",
              opacity: isSidebarCollapsed ? 0 : 1,
              pointerEvents: isSidebarCollapsed ? 'none' : 'auto'
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="border-r border-white/5 flex flex-col bg-surface-container-lowest relative overflow-hidden"
          >
            {/* Decorative Grid Background */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03]" 
                 style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
            
            <div className="flex flex-col h-full min-w-[380px] relative z-10">
              {/* Sidebar Header */}
              <div className="p-6 border-b border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-primary rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(255,184,102,0.2)] group-hover:scale-105 transition-transform duration-500">
                      <Film className="w-6 h-6 text-black" />
                    </div>
                    <div>
                      <h1 className="text-xl font-black tracking-tighter uppercase leading-none text-white">Director.OS</h1>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[8px] font-bold text-primary tracking-[0.3em] uppercase">System_v2.5.4</span>
                        <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCoverPage(true)}
                      className="p-2 bg-white/5 outline outline-[0.5px] outline-outline-variant/20 rounded-xl text-slate-400 hover:text-primary hover:bg-white/[0.07] transition-all cursor-pointer"
                      title="回到起始页"
                    >
                      <Home className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                    <ThemeToggle />
                    <button 
                      onClick={() => setIsSidebarCollapsed(true)}
                      className="p-2 bg-white/5 border border-white/10 rounded-xl text-slate-400 hover:text-primary hover:border-primary/30 transition-all cursor-pointer"
                      title="收起侧边栏"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={handleQuickSave}
                      disabled={isSaving}
                      className="p-2 bg-white/5 border border-white/10 rounded-xl text-slate-400 hover:text-primary hover:border-primary/30 transition-all disabled:opacity-50 cursor-pointer"
                      title="快速保存"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                    <button 
                      onClick={() => setIsProjectManagerOpen(true)}
                      className="p-2 bg-white/5 border border-white/10 rounded-xl text-slate-400 hover:text-primary hover:border-primary/30 transition-all cursor-pointer"
                      title="项目管理"
                    >
                      <Folder className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl flex items-center justify-between group hover:bg-white/[0.05] transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                      <label className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-500">Active_Project</label>
                    </div>
                    <h2 className="text-xs font-bold truncate text-slate-200 font-mono uppercase tracking-tight">{projectTitle}</h2>
                  </div>
                  <button 
                    onClick={() => setIsProjectManagerOpen(true)}
                    className="p-2 text-slate-500 hover:text-primary transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                {/* Configuration Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-3 bg-primary rounded-full" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Project_Configuration</span>
                  </div>
                  
                  <div className="space-y-4 bg-white/[0.02] border border-white/5 rounded-2xl p-4">
                    <div className="space-y-2">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Visual_Style</label>
                      <div className="relative">
                        <select 
                          value={selectedStyle}
                          onChange={(e) => setStyle(e.target.value as any)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                        >
                          {STYLES.map(s => <option key={s} value={s} className="bg-surface">{s}</option>)}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Global_Context</label>
                      <textarea 
                        value={context}
                        onChange={(e) => setContext(e.target.value)}
                        placeholder="Define the world, time, and atmosphere..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-xs leading-relaxed h-24 font-mono"
                      />
                    </div>
                  </div>
                </section>

                {/* Reference Assets Section */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-3 bg-primary rounded-full" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Asset_Library</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => setShowLibrary(!showLibrary)}
                        className={cn(
                          "text-[9px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1.5",
                          showLibrary ? "text-primary" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        <ImageIcon className="w-3 h-3" />
                        {showLibrary ? 'Hide_Library' : 'Open_Library'}
                      </button>
                    </div>
                  </div>

                  {showLibrary && (
                    <div className="grid grid-cols-4 gap-2 p-3 bg-primary/5 border border-primary/20 rounded-2xl animate-in fade-in slide-in-from-top-2">
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
                          <User className="w-3.5 h-3.5 text-primary" />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-200">Characters</span>
                        </div>
                        <span className="text-[8px] font-mono text-slate-400">{characterRefs.length}_ITEMS</span>
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
                          "flex flex-row gap-3 p-3 bg-white/[0.03] border border-dashed rounded-2xl transition-all relative min-h-[128px] overflow-x-auto items-center custom-scrollbar",
                          dragActiveType === 'character' ? "border-primary bg-primary/5" : "border-white/10"
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
                          className="shrink-0 w-24 h-24 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 bg-white/[0.06] hover:bg-white/10 hover:border-primary/40 transition-all text-slate-300 hover:text-primary cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-[8px] font-black uppercase tracking-widest">Upload</span>
                        </button>
                      </Reorder.Group>
                    </div>

                    {/* Scene Zone */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <Map className="w-3.5 h-3.5 text-primary" />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-200">Environments</span>
                        </div>
                        <span className="text-[8px] font-mono text-slate-400">{sceneRefs.length}_ITEMS</span>
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
                          "flex flex-row gap-3 p-3 bg-white/[0.03] border border-dashed rounded-2xl transition-all relative min-h-[128px] overflow-x-auto items-center custom-scrollbar",
                          dragActiveType === 'scene' ? "border-primary bg-primary/5" : "border-white/10"
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
                          className="shrink-0 w-24 h-24 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 bg-white/[0.06] hover:bg-white/10 hover:border-primary/40 transition-all text-slate-300 hover:text-primary cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-[8px] font-black uppercase tracking-widest">Upload</span>
                        </button>
                      </Reorder.Group>
                    </div>

                  </div>
                </section>

                {/* Script Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-3 bg-primary rounded-full" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Script_Editor</span>
                  </div>
                  <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4">
                    <textarea 
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      placeholder="Enter your script outline here..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-xs leading-relaxed h-48 font-mono"
                    />
                  </div>
                </section>
              </div>

              {/* Sidebar Footer Action */}
              <div className="p-6 border-t border-white/5 bg-white/[0.02]">
                <button 
                  onClick={handleGenerate}
                  disabled={isGeneratingScript || !script.trim()}
                  className={cn(
                    "w-full py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-xs flex items-center justify-center gap-3 transition-all shadow-2xl",
                    isGeneratingScript 
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
                      : "bg-primary text-black hover:bg-amber-400 hover:shadow-[0_0_30px_rgba(255,184,102,0.4)] active:scale-[0.98] cursor-pointer"
                  )}
                >
                  {isGeneratingScript ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate_Storyboard
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.aside>

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
            onClick={() => setShowCoverPage(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-high/55 backdrop-blur-md text-slate-400 hover:text-primary outline outline-[0.5px] outline-outline-variant/20 shadow-[0_24px_48px_-28px_rgba(0,0,0,0.45)] transition-colors cursor-pointer"
            title="回到起始页"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <Home className="w-4 h-4" strokeWidth={1.75} />
          </motion.button>
          <ThemeToggle />
          <motion.button
            type="button"
            onClick={() => setIsSidebarCollapsed(false)}
            className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-black shadow-[0_0_24px_rgba(255,184,102,0.35)] hover:brightness-110 transition-all active:scale-95 cursor-pointer"
            title="展开侧边栏"
          >
            <ChevronRight className="w-6 h-6" />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Right Panel */}
      <main className="flex-1 overflow-y-auto bg-surface-container-lowest relative custom-scrollbar">
        {error && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-full flex items-center gap-2 text-red-400 text-xs font-bold animate-in fade-in slide-in-from-top-4">
            <Info className="w-4 h-4" />
            {error}
          </div>
        )}

        {!data && !isGeneratingScript ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-12">
            <div className="w-24 h-24 bg-slate-900 rounded-3xl flex items-center justify-center mb-6 border border-slate-800">
              <Play className="w-10 h-10 text-slate-700" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">准备好开始你的创作了吗？</h2>
            <p className="text-slate-500 max-w-md">在左侧输入剧本大纲并选择画风，Seedance 将为你自动拆解分镜并生成视觉参考。</p>
          </div>
        ) : (
          <div className="p-8 max-w-[1800px] mx-auto space-y-12 pb-24">
            {/* Key Scene Header - Technical Dashboard Style */}
            {data?.global_assets && (
              <div className="bg-surface-container-low border border-white/5 rounded-2xl overflow-hidden shadow-2xl no-print">
                <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(255,184,102,0.5)]" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">System.Scene_Configuration</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active_Scene</span>
                      <select 
                        value={selectedSceneIndex}
                        onChange={(e) => setSelectedSceneIndex(Number(e.target.value))}
                        className="bg-white/5 text-slate-300 text-[10px] font-mono rounded-md px-2 py-1 border border-white/10 focus:outline-none focus:border-primary/50 transition-colors cursor-pointer"
                      >
                        {data.global_assets.scenes.map((_, i) => (
                          <option key={i} value={i} className="bg-surface">SCENE_{i + 1}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                
                {data.global_assets.scenes[selectedSceneIndex] && (
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_480px] divide-x divide-white/5">
                    <div className="p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-3 bg-primary rounded-full" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Scene_Description</span>
                        </div>
                        <button 
                          onClick={() => handleGenerateSceneDescription(selectedSceneIndex)}
                          disabled={isGeneratingDescription === selectedSceneIndex.toString()}
                          className={cn(
                            "flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all",
                            isGeneratingDescription === selectedSceneIndex.toString() 
                              ? "text-primary animate-pulse" 
                              : "text-slate-500 hover:text-primary"
                          )}
                        >
                          {isGeneratingDescription === selectedSceneIndex.toString() ? <Loader2 className="w-3 h-3 animate-spin" /> : <PenTool className="w-3 h-3" />}
                          Rewrite_Prompt
                        </button>
                      </div>
                      <textarea
                        value={data.global_assets.scenes[selectedSceneIndex].description}
                        onChange={(e) => handleUpdateSceneDescription(selectedSceneIndex, e.target.value)}
                        className="w-full bg-white/[0.02] border border-white/5 rounded-xl p-4 text-xs text-slate-300 leading-relaxed min-h-[100px] focus:outline-none focus:border-primary/30 focus:bg-white/[0.04] transition-all font-mono"
                        placeholder="Define the scene parameters..."
                      />
                      
                      <div className="flex items-center justify-between pt-4 border-t border-white/5">
                        <div className="flex items-center gap-8">
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <Maximize2 className="w-3 h-3 text-slate-600" />
                              <span className="text-[8px] font-black uppercase tracking-widest text-slate-500">Resolution_Spec</span>
                            </div>
                            <div className="flex bg-white/[0.03] rounded-xl p-1 border border-white/5 shadow-inner">
                              {['1K', '2K', '4K'].map(size => (
                                <button
                                  key={size}
                                  onClick={() => setSceneImageSize(size)}
                                  className={cn(
                                    "px-4 py-1.5 text-[10px] font-mono font-bold rounded-lg transition-all",
                                    sceneImageSize === size ? "bg-primary text-black shadow-[0_0_12px_rgba(255,184,102,0.4)]" : "text-slate-500 hover:text-slate-300"
                                  )}
                                >
                                  {size}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <Layout className="w-3 h-3 text-slate-600" />
                              <span className="text-[8px] font-black uppercase tracking-widest text-slate-500">Aspect_Ratio</span>
                            </div>
                            <select 
                              value={sceneAspectRatio}
                              onChange={(e) => setSceneAspectRatio(e.target.value)}
                              className="bg-white/[0.03] text-slate-300 text-[10px] font-mono font-bold rounded-xl px-4 py-2.5 border border-white/5 focus:outline-none focus:border-primary/30 transition-all cursor-pointer hover:bg-white/10 appearance-none min-w-[100px]"
                            >
                              {['1:1', '16:9', '9:16', '4:3', '3:4'].map(ratio => (
                                <option key={ratio} value={ratio} className="bg-surface">{ratio}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        
                        <button 
                          onClick={() => handleGenerateGlobalAsset(data.global_assets.scenes[selectedSceneIndex].description, selectedSceneIndex)}
                          disabled={isGeneratingGlobalAsset === selectedSceneIndex.toString()}
                          className={cn(
                            "group relative flex items-center gap-3 px-8 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[12px] transition-all overflow-hidden",
                            isGeneratingGlobalAsset === selectedSceneIndex.toString() 
                              ? "bg-slate-800 text-primary" 
                              : "bg-primary text-black hover:bg-amber-400 hover:shadow-[0_0_32px_rgba(255,184,102,0.4)] active:scale-95"
                          )}
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite]" />
                          {isGeneratingGlobalAsset === selectedSceneIndex.toString() ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          GENERATE
                        </button>
                      </div>
                    </div>

                    <div className="relative aspect-video lg:aspect-auto bg-black/40 overflow-hidden group/sceneimg flex items-center justify-center">
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
                        <div className="flex flex-col items-center gap-4 text-slate-600">
                          <div className="w-12 h-12 rounded-full border-2 border-dashed border-slate-800 flex items-center justify-center">
                            <Map className="w-6 h-6" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-widest">Environment_Pending</span>
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

              {/* Storyboards Section Header - Editorial Style */}
              <div className="flex flex-col gap-8">
                <div className="flex items-center justify-between pb-8">
                  <div className="flex items-center gap-8">
                    <div className="space-y-1">
                      <h3 className="text-4xl font-headline font-bold tracking-[-0.02em] text-on-surface">Storyboard List</h3>
                      <div className="text-[10px] font-body font-semibold accent-focus uppercase tracking-[0.18em]">
                        NEON_NOIR // SCENE_04 - THE_ALCHEMIST
                      </div>
                    </div>

                    <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high/45 p-1.5 outline outline-[0.5px] outline-white/10">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-full text-[9px] font-label tracking-[0.14em] uppercase segmented-active-bg segmented-active-text shadow-[0_10px_20px_-12px_rgba(0,0,0,0.45)] cursor-default"
                      >
                        Storyboard
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCoverPage(false);
                          setShowImageEditorPage(true);
                          setImageEditorKeepAlive(true);
                          setShowNineGridPage(false);
                        }}
                        className="px-3 py-1.5 rounded-full text-[9px] font-label tracking-[0.14em] uppercase text-on-surface/70 hover:text-on-surface transition-colors cursor-pointer"
                      >
                        图片编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCoverPage(false);
                          setShowNineGridPage(true);
                          setNineGridKeepAlive(true);
                          setShowImageEditorPage(false);
                        }}
                        className="px-3 py-1.5 rounded-full text-[9px] font-label tracking-[0.14em] uppercase text-on-surface/70 hover:text-on-surface transition-colors cursor-pointer"
                      >
                        九宫格
                      </button>
                    </div>

                    <div className="flex items-center bg-surface-container-low rounded-full p-1">
                      {[
                        { id: 'list', label: 'EDITOR_VIEW' },
                        { id: 'grid', label: 'GRID_VIEW' }
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          onClick={() => setViewMode(mode.id as 'list' | 'grid')}
                          className={cn(
                            "px-6 py-2 rounded-full text-[10px] font-body font-semibold uppercase tracking-[0.18em] transition-all cursor-pointer relative",
                            viewMode === mode.id ? "accent-focus" : "text-slate-500 hover:text-slate-400"
                          )}
                        >
                          {viewMode === mode.id && (
                            <motion.div 
                              layoutId="viewModeBg"
                              className="absolute inset-0 bg-white/10 rounded-full" 
                            />
                          )}
                          <span className="relative z-10">{mode.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => window.print()}
                      className="group flex items-center gap-2 px-6 py-2.5 bg-surface-container-low hover:bg-white/10 rounded-full text-[10px] font-body font-semibold uppercase tracking-[0.18em] transition-all cursor-pointer accent-focus ghost-border"
                    >
                      <FileText className="w-4 h-4" />
                      EXPORT_PDF
                    </button>
                    
                    <button 
                      className="group flex items-center gap-2 px-6 py-2.5 accent-focus-bg hover:opacity-90 rounded-full text-[10px] font-body font-semibold uppercase tracking-[0.18em] transition-all cursor-pointer accent-focus-glow"
                    >
                      <Plus className="w-4 h-4" />
                      NEW FRAME
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
                    <div className="col-span-full py-12 text-center text-slate-500">
                      没有符合该分类的分镜
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

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
              className="pointer-events-auto absolute right-4 top-4 z-[120] flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-high/55 text-white/90 outline outline-[0.5px] outline-outline-variant/20 backdrop-blur-[30px] shadow-[0_24px_48px_-28px_rgba(0,0,0,0.55)] transition-colors hover:text-white cursor-pointer sm:right-7 sm:top-7"
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
              className="pointer-events-auto absolute right-4 top-4 z-[120] flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-high/55 text-white/90 outline outline-[0.5px] outline-outline-variant/20 backdrop-blur-[30px] shadow-[0_24px_48px_-28px_rgba(0,0,0,0.55)] transition-colors hover:text-white cursor-pointer sm:right-7 sm:top-7"
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
    <div className="bg-slate-900/20 border border-slate-800/50 rounded-2xl overflow-hidden flex flex-col md:flex-row animate-pulse">
      <div className="w-full md:w-[40%] aspect-video bg-slate-900" />
      <div className="flex-1 p-6 space-y-4">
        <div className="h-6 bg-slate-900 rounded w-3/4" />
        <div className="h-12 bg-slate-900 rounded w-full" />
        <div className="h-20 bg-slate-900 rounded w-full" />
      </div>
    </div>
  );
}
