import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { 
  Folder, 
  Save, 
  Trash2, 
  Plus, 
  X, 
  Loader2, 
  Clock,
  FileText,
  CheckCircle2,
  Copy,
  Download,
  Upload as UploadIcon,
  Database,
  Search,
  Activity,
  Box
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

import { AlertModal } from './AlertModal';
import { ConfirmationModal } from './ConfirmationModal';

interface Project {
  id: string;
  title: string;
  updatedAt: string;
}

export const ProjectManager = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { 
    currentProjectId, 
    setCurrentProjectId,
    projectTitle,
    setProjectTitle,
    context,
    setContext,
    script,
    selectedStyle,
    imageSize,
    aspectRatio,
    references,
    data,
    resetProject,
    setScript,
    setStyle,
    setImageSize,
    setAspectRatio,
    setData
  } = useStore();

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success'>('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal states
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'warning'
  });

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  const fetchProjects = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/projects', { credentials: 'same-origin' });
      const list = await res.json();
      setProjects(list);
    } catch (error) {
      console.error('Failed to fetch projects', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchProjects();
    }
  }, [isOpen]);

  const handleSave = async () => {
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
          context,
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
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 2000);
        fetchProjects();
      }
    } catch (error) {
      console.error('Failed to save project', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = async (id: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { credentials: 'same-origin' });
      const project = await res.json();
      
      // Load into store
      setCurrentProjectId(project.id);
      setProjectTitle(project.title);
      setContext(project.context || '');
      setScript(project.script || '');
      setStyle(project.selectedStyle || 'Cinematic');
      setImageSize(project.imageSize || '4K');
      setAspectRatio(project.aspectRatio || '16:9');
      setData(project.data);
      
      // Clear and add references
      useStore.setState({ references: project.references || [] });
      
      onClose();
    } catch (error) {
      console.error('Failed to load project', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmModal({
      isOpen: true,
      title: '删除项目',
      message: '确定要删除这个项目吗？此操作无法撤销。',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/projects/${id}`, { method: 'DELETE', credentials: 'same-origin' });
          if (res.ok) {
            if (currentProjectId === id) {
              resetProject();
            }
            fetchProjects();
          }
        } catch (error) {
          console.error('Failed to delete project', error);
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDuplicate = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { credentials: 'same-origin' });
      const project = await res.json();
      
      const newId = Math.random().toString(36).substr(2, 9);
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ...project,
          id: newId,
          title: `${project.title} (副本)`
        })
      });
      fetchProjects();
    } catch (error) {
      console.error('Failed to duplicate project', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/projects/${id}`, { credentials: 'same-origin' });
      const project = await res.json();
      
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.title}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export project', error);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const project = JSON.parse(event.target?.result as string);
        const newId = Math.random().toString(36).substr(2, 9);
        
        await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            ...project,
            id: newId,
            title: `${project.title} (导入)`
          })
        });
        fetchProjects();
      } catch (error) {
        setAlertModal({
          isOpen: true,
          title: '导入失败',
          message: '导入失败：无效的项目文件'
        });
      }
    };
    reader.readAsText(file);
  };

  const handleNew = () => {
    setConfirmModal({
      isOpen: true,
      title: '开始新项目',
      message: '开始新项目将清空当前未保存的内容，确定吗？',
      variant: 'warning',
      onConfirm: () => {
        resetProject();
        onClose();
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const filteredProjects = projects.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 overflow-hidden">
      {/* Cinematic Background Elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-20">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute top-0 left-0 w-full h-1 bg-primary/20 animate-scan" />
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="bg-surface-container-low/95 outline outline-[0.5px] outline-white/10 w-full max-w-5xl rounded-[40px] overflow-hidden shadow-[0_40px_100px_-40px_rgba(0,0,0,0.75)] flex flex-col max-h-[90vh] relative z-10 backdrop-blur-[28px]"
      >
        {/* Header */}
        <div className="p-10 bg-surface-container-low/30 relative flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center outline outline-[0.5px] outline-primary/25 relative group">
              <div className="absolute inset-0 bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <Database className="w-7 h-7 text-primary relative z-10" />
            </div>
            <div>
              <h2 className="text-2xl font-headline italic text-on-surface tracking-tight">Project_Archive</h2>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_12px_rgba(255,184,102,0.45)]" />
                <p className="text-[10px] font-label tracking-[0.3em] text-on-surface/45 uppercase">System_Status: Operational</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface/40 group-focus-within:text-primary transition-colors" />
              <input 
                type="text"
                placeholder="SEARCH_ARCHIVE..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-surface-container-lowest outline outline-[0.5px] outline-white/10 rounded-full pl-11 pr-6 py-2.5 text-[10px] font-mono tracking-widest focus:outline-none focus:outline focus:outline-[0.5px] focus:outline-primary/35 w-64 transition-all text-on-surface"
              />
            </div>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-full glass-panel ghost-border text-[9px] font-label tracking-widest text-on-surface hover:bg-white/10 transition-all cursor-pointer"
            >
              <UploadIcon className="w-3.5 h-3.5" />
              IMPORT_JSON
            </button>
            <input type="file" ref={fileInputRef} onChange={handleImport} accept=".json" className="hidden" />
            <button onClick={onClose} className="p-3 hover:bg-white/5 rounded-full transition-colors text-slate-400 hover:text-white cursor-pointer">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Left: Current Project Info */}
          <div className="w-80 p-10 space-y-10 bg-surface-container-lowest/30 outline outline-[0.5px] outline-white/[0.06] -outline-offset-[-1px]">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-primary" />
                <label className="text-[10px] font-label tracking-[0.3em] text-primary uppercase">Active_Session</label>
              </div>
              <div className="space-y-2">
                <span className="text-[8px] font-label tracking-widest text-on-surface/35 ml-1 uppercase">Project_Title</span>
                <input 
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  className="w-full bg-surface-container-lowest outline outline-[0.5px] outline-white/10 rounded-2xl px-5 py-4 text-xs font-mono focus:outline-none focus:outline focus:outline-[0.5px] focus:outline-primary/35 transition-all shadow-inner text-on-surface"
                  placeholder="Untitled_Project..."
                />
              </div>
            </div>

            <div className="space-y-4">
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className={cn(
                  "w-full flex items-center justify-center gap-3 py-5 rounded-2xl text-[10px] font-label tracking-[0.2em] uppercase transition-all cursor-pointer shadow-lg",
                  saveStatus === 'success' 
                    ? "bg-gradient-to-br from-primary to-on-primary-container text-on-primary-fixed" 
                    : "bg-gradient-to-br from-primary to-on-primary-container text-on-primary-fixed hover:brightness-105 hover:scale-[1.02] active:scale-[0.98]"
                )}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : saveStatus === 'success' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saveStatus === 'success' ? 'ARCHIVED_SUCCESS' : 'COMMIT_CHANGES'}
              </button>

              <button 
                onClick={handleNew}
                className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl glass-panel ghost-border text-[10px] font-label tracking-[0.2em] uppercase text-on-surface hover:bg-white/5 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                INIT_NEW_SEQUENCE
              </button>
            </div>

            <div className="pt-10 space-y-6">
              <div className="flex items-center gap-2">
                <Box className="w-3.5 h-3.5 text-slate-500" />
                <h4 className="text-[10px] font-label tracking-[0.3em] text-slate-500 uppercase">Session_Metrics</h4>
              </div>
              <div className="space-y-4">
                {[
                  { label: 'Shot_Count', value: data?.storyboards.length || 0, isMono: true },
                  { label: 'Asset_Refs', value: references.length, isMono: true },
                  { label: 'Visual_Base', value: selectedStyle, isMono: false },
                  { label: 'Target_Res', value: imageSize, isMono: true }
                ].map((stat) => (
                  <div key={stat.label} className="flex justify-between items-center group/stat">
                    <span className="text-[9px] font-label text-slate-500 uppercase group-hover/stat:text-slate-300 transition-colors">{stat.label}</span>
                    <span className={cn(
                      "text-[10px] transition-all",
                      stat.isMono ? "font-mono text-slate-300" : "font-label uppercase tracking-widest text-primary",
                      "group-hover/stat:scale-110"
                    )}>{stat.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Project List */}
          <div className="flex-1 p-10 overflow-y-auto custom-scrollbar bg-surface-container-lowest/5 relative">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-1 h-4 bg-primary rounded-full" />
                <h3 className="text-[11px] font-label tracking-[0.3em] text-slate-300 uppercase">Historical_Archive</h3>
              </div>
              <span className="text-[9px] font-label text-slate-600 uppercase tracking-[0.2em]">{filteredProjects.length} Records Found</span>
            </div>
            
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-32 text-slate-600">
                <div className="relative">
                  <Loader2 className="w-12 h-12 animate-spin mb-6 text-primary/40" />
                  <div className="absolute inset-0 bg-primary/10 blur-2xl animate-pulse" />
                </div>
                <span className="text-[11px] font-label tracking-[0.4em] uppercase animate-pulse">Syncing_Archive_Stream...</span>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-32 text-on-surface/35 outline outline-1 outline-dashed outline-white/10 rounded-[40px] bg-white/[0.01]">
                <FileText className="w-16 h-16 opacity-5 mb-6" />
                <span className="text-[11px] font-label tracking-[0.3em] uppercase opacity-40">No_Records_Detected</span>
                <p className="text-[9px] mt-3 opacity-20 uppercase tracking-[0.2em]">Initialize a new sequence to populate archive</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5">
                <AnimatePresence mode="popLayout">
                  {filteredProjects.map((p, idx) => (
                    <motion.div 
                      key={p.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      onClick={() => handleLoad(p.id)}
                      className={cn(
                        "group flex items-center justify-between p-7 rounded-[32px] outline outline-[0.5px] transition-all cursor-pointer relative overflow-hidden",
                        currentProjectId === p.id 
                          ? "bg-primary/5 outline-primary/30 shadow-[0_0_30px_rgba(255,184,102,0.1)]" 
                          : "bg-surface-container-lowest/50 outline-white/10 hover:outline-primary/30 hover:bg-white/[0.03] hover:shadow-xl"
                      )}
                    >
                      {/* Hover Glow Effect */}
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 pointer-events-none" />

                      <div className="flex items-center gap-6 min-w-0 relative z-10">
                        <div className={cn(
                          "w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500",
                          currentProjectId === p.id ? "bg-primary/20 rotate-3" : "bg-white/5 group-hover:bg-white/10"
                        )}>
                          <FileText className={cn(
                            "w-6 h-6 transition-colors",
                            currentProjectId === p.id ? "text-primary" : "text-slate-500 group-hover:text-slate-300"
                          )} />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-lg font-headline italic text-on-surface truncate group-hover:text-primary transition-colors">{p.title}</h4>
                          <div className="flex items-center gap-5 text-[10px] font-label tracking-[0.2em] text-slate-500 mt-2 uppercase">
                            <div className="flex items-center gap-2 group-hover:text-slate-400 transition-colors">
                              <Clock className="w-3.5 h-3.5" />
                              {new Date(p.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </div>
                            <div className="w-1 h-1 rounded-full bg-slate-800" />
                            <span className="font-mono opacity-40 group-hover:opacity-80 transition-opacity">ID: {p.id.toUpperCase()}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all duration-300 relative z-10">
                        {[
                          { icon: Copy, onClick: handleDuplicate, title: 'DUPLICATE', color: 'hover:text-primary hover:bg-primary/10' },
                          { icon: Download, onClick: handleExport, title: 'EXPORT', color: 'hover:text-primary hover:bg-primary/10' },
                          { icon: Trash2, onClick: handleDelete, title: 'PURGE', color: 'hover:text-red-400 hover:bg-red-400/10' }
                        ].map((action, i) => (
                          <button 
                            key={i}
                            onClick={(e) => action.onClick(e, p.id)}
                            className={cn(
                              "p-3 rounded-2xl transition-all cursor-pointer ghost-border bg-white/5",
                              action.color
                            )}
                            title={action.title}
                          >
                            <action.icon className="w-4.5 h-4.5" />
                          </button>
                        ))}
                      </div>

                      {currentProjectId === p.id && (
                        <div className="absolute top-0 right-0 p-3">
                          <div className="px-3 py-1.5 bg-primary/20 text-primary text-[9px] font-label tracking-[0.3em] rounded-bl-2xl outline outline-[0.5px] outline-primary/30 backdrop-blur-md">
                            ACTIVE_SESSION
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />

      <AlertModal
        isOpen={alertModal.isOpen}
        title={alertModal.title}
        message={alertModal.message}
        onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
