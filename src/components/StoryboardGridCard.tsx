import React from 'react';
import { Storyboard } from '../types';
import { cn } from '../lib/utils';
import { Download, Image as ImageIcon, Maximize2, Sparkles, Trash2, Camera } from 'lucide-react';
import { motion } from 'motion/react';
import { useStore } from '../store/useStore';
import { useShellNavigation } from '../shell/ShellNavigation';
import { ConfirmationModal } from './ConfirmationModal';

interface StoryboardGridCardProps {
  shot: Storyboard;
  onClick?: () => void;
}

// Helper to extract a pseudo shot type from director notes
const getShotType = (notes: string) => {
  if (!notes) return 'SHOT';
  const lower = notes.toLowerCase();
  if (lower.includes('特写') || lower.includes('close up') || lower.includes('ecu')) return 'CLOSE UP';
  if (lower.includes('全景') || lower.includes('wide') || lower.includes('establisher')) return 'WIDE SHOT';
  if (lower.includes('中景') || lower.includes('medium')) return 'MED SHOT';
  if (lower.includes('近景') || lower.includes('mcu')) return 'MCU';
  if (lower.includes('远景') || lower.includes('long shot')) return 'LONG SHOT';
  if (lower.includes('过肩') || lower.includes('ots')) return 'OTS';
  return 'SHOT';
};

export const StoryboardGridCard: React.FC<StoryboardGridCardProps> = ({ shot, onClick }) => {
  const { removeStoryboard, addNotice } = useStore();
  const { openDirectorWithStoryboardShot } = useShellNavigation();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const shotType = getShotType(shot.director_notes);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shot.image_url) return;
    try {
      const response = await fetch(shot.image_url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `shot_${shot.shot_number.toString().padStart(2, '0')}_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed', err);
    }
  };
  
  // Extract a short title from the summary (first sentence or up to 20 chars)
  const summaryParts = shot.summary.split(/[。！？.!?]/);
  const title = summaryParts[0].length > 40 ? summaryParts[0].substring(0, 40) + '...' : summaryParts[0];
  
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    removeStoryboard(shot.shot_number);
    setIsDeleteModalOpen(false);
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col group"
    >
      <div
        className="relative w-full aspect-video rounded-[1.15rem] overflow-hidden ai-editor-panel group-hover:outline-white/20 transition-all duration-500 flex items-center justify-center cursor-pointer outline outline-[0.5px] outline-white/10"
        onClick={onClick}
      >
        {shot.image_url ? (
          <>
            <img 
              src={shot.image_url} 
              alt={`Shot ${shot.shot_number}`}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" 
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-500" />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-[var(--cover-fg-warm-muted)] gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-slate-800 flex items-center justify-center">
              <ImageIcon className="w-6 h-6 opacity-40" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest">Environment_Pending</span>
          </div>
        )}
        
        {/* Top Badges */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {shot.image_url && (
              <div className="bg-primary/15 backdrop-blur-xl text-primary text-[8px] font-label font-semibold px-2 py-1 rounded-lg outline outline-[0.5px] outline-primary/25 uppercase tracking-widest flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Rendered
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {shot.image_url && (
              <button
                onClick={handleDownload}
                className="bg-black/60 backdrop-blur-xl text-[var(--cover-fg-warm)] hover:text-primary p-1.5 rounded-lg outline outline-[0.5px] outline-white/10 transition-all opacity-0 group-hover:opacity-100"
                title="下载图片"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
            {shot.image_url && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openDirectorWithStoryboardShot({
                    imageUrl: shot.image_url!,
                    shotNumber: shot.shot_number,
                    summary: shot.summary,
                    directorNotes: shot.director_notes,
                  });
                  addNotice('已打开导演台并导入本镜参考图');
                }}
                className="bg-black/60 backdrop-blur-xl text-[var(--cover-fg-warm)] hover:text-primary p-1.5 rounded-lg outline outline-[0.5px] outline-white/10 transition-all opacity-0 group-hover:opacity-100"
                title="在导演台打开"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            )}
            <button 
              onClick={handleDelete}
              className="bg-black/60 backdrop-blur-xl text-[var(--cover-fg-warm-muted)] hover:text-red-400 p-1.5 rounded-lg outline outline-[0.5px] outline-white/10 transition-all opacity-0 group-hover:opacity-100"
              title="删除此分镜"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        
        {/* Bottom Info */}
        <div className="absolute bottom-4 left-4 right-4 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-2 group-hover:translate-y-0">
          <p className="text-[12px] text-white/88 font-medium line-clamp-2 leading-relaxed italic">
            "{shot.director_notes}"
          </p>
        </div>
      </div>
      
      <div className="mt-4 px-1">
        <div className="flex justify-end items-center mb-2">
          <span className="ai-editor-stat text-[11px] px-2.5 py-1 rounded-full ai-editor-panel">
            {shotType}
          </span>
        </div>
        <p className="ai-editor-body text-[13px] leading-relaxed line-clamp-2" title={shot.summary}>
          {shot.summary}
        </p>
      </div>

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        title="删除镜头"
        message={`确定要删除镜头 ${shot.shot_number} 吗？此操作无法撤销。`}
        confirmLabel="删除"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
      />
    </motion.div>
  );
};

