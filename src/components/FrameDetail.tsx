import React, { useState } from 'react';
import { 
  X as XIcon, 
  ChevronLeft as ChevronLeftIcon, 
  ChevronRight as ChevronRightIcon, 
  Camera, 
  Download
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

export const FrameDetail: React.FC = () => {
  const { data, selectedShotNumber, setSelectedShotNumber } = useStore();
  const [isHovering, setIsHovering] = useState(false);

  if (!data || !selectedShotNumber) return null;

  const shots = Array.isArray(data.storyboards) ? data.storyboards : [];
  const currentIndex = shots.findIndex(s => s.shot_number === selectedShotNumber);
  const shot = shots[currentIndex];

  if (!shot) return null;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < shots.length - 1;

  const handlePrev = () => {
    if (hasPrev) {
      setSelectedShotNumber(shots[currentIndex - 1].shot_number);
    }
  };

  const handleNext = () => {
    if (hasNext) {
      setSelectedShotNumber(shots[currentIndex + 1].shot_number);
    }
  };

  const handleDownload = async () => {
    if (!shot.image_url) return;
    try {
      const response = await fetch(shot.image_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `shot_${shot.shot_number.toString().padStart(2, '0')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface flex flex-col animate-in fade-in duration-500 overflow-hidden">
      {/* Header */}
      <div className="h-16 border-b border-outline-variant/10 flex items-center justify-between px-8 bg-surface-container-low/50 backdrop-blur-xl z-20">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setSelectedShotNumber(null)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors text-slate-400 hover:text-white cursor-pointer"
          >
            <XIcon className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-label tracking-[0.3em] text-primary uppercase">Shot A-{shot.shot_number}</span>
            <div className="w-1 h-1 rounded-full bg-slate-700" />
            <span className="text-[10px] font-label tracking-[0.3em] text-slate-500 uppercase">{shot.summary || 'Interior - The Lab'}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel ghost-border text-[9px] font-label tracking-widest text-on-surface hover:bg-white/10 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            EXPORT_FRAME
          </button>
          <button 
            onClick={() => setSelectedShotNumber(null)}
            className="flex items-center gap-2 px-6 py-2 rounded-full bg-primary text-on-primary-fixed text-[9px] font-label tracking-widest font-bold hover:bg-primary/90 transition-all cursor-pointer"
          >
            CLOSE_STUDIO
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Viewport */}
        <div 
          className="flex-1 relative bg-surface-container-lowest flex items-center justify-center overflow-hidden group"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          {shot.image_url ? (
            <img 
              src={shot.image_url} 
              alt={shot.summary}
              className="max-w-full max-h-full object-contain shadow-2xl"
            />
          ) : (
            <div className="flex flex-col items-center text-slate-700">
              <Camera className="w-24 h-24 mb-6 opacity-10" />
              <span className="text-xs font-label tracking-widest uppercase opacity-40">No Visual Data</span>
            </div>
          )}

          {/* Navigation Arrows */}
          <div className={cn(
            "absolute inset-x-8 top-1/2 -translate-y-1/2 flex justify-between pointer-events-none transition-all duration-500",
            isHovering ? "opacity-100" : "opacity-0"
          )}>
            <button 
              onClick={handlePrev}
              disabled={!hasPrev}
              className="p-6 rounded-full glass-panel ghost-border text-white hover:bg-white/10 transition-all pointer-events-auto disabled:opacity-0 cursor-pointer"
            >
              <ChevronLeftIcon className="w-8 h-8" />
            </button>
            <button 
              onClick={handleNext}
              disabled={!hasNext}
              className="p-6 rounded-full glass-panel ghost-border text-white hover:bg-white/10 transition-all pointer-events-auto disabled:opacity-0 cursor-pointer"
            >
              <ChevronRightIcon className="w-8 h-8" />
            </button>
          </div>

          {/* Cinematic Overlays */}
          <div className={cn(
            "absolute inset-0 pointer-events-none transition-opacity duration-700",
            isHovering ? "opacity-100" : "opacity-0"
          )}>
            <div className="absolute top-12 left-12">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-[1px] bg-primary/50" />
                <span className="text-[9px] font-label tracking-[0.4em] text-primary uppercase">Technical Overlay</span>
              </div>
              <div className="font-mono text-[10px] text-slate-500 space-y-1">
                <p>RES: {shot.image_size || '1024x1024'}</p>
                <p>ASP: {shot.aspect_ratio || '1:1'}</p>
                <p>ISO: 400</p>
                <p>F-STOP: 2.8</p>
              </div>
            </div>
          </div>

          {/* Prompt Overlay */}
          <div className={cn(
            "absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none transition-all duration-500 translate-y-4",
            isHovering ? "opacity-100 translate-y-0" : "opacity-0"
          )}>
            <div className="max-w-4xl mx-auto space-y-4">
              {shot.image_prompt && (
                <div className="space-y-1">
                  <span className="text-[10px] font-label tracking-[0.2em] text-primary uppercase">Visual Manifest</span>
                  <p className="text-sm text-slate-200 font-body leading-relaxed line-clamp-3">
                    {shot.image_prompt}
                  </p>
                </div>
              )}
              {shot.video_prompt && (
                <div className="space-y-1">
                  <span className="text-[10px] font-label tracking-[0.2em] text-secondary uppercase">Motion Vector</span>
                  <p className="text-sm text-slate-200 font-body leading-relaxed line-clamp-3">
                    {shot.video_prompt}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
