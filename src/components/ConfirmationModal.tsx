import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'info';
}

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  variant = 'warning'
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={spring}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-surface-container-low/95 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.7)] outline outline-[0.5px] outline-white/10 backdrop-blur-[28px]"
            data-theme-preserve="dark"
          >
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                  variant === 'danger' ? "bg-red-500/10 text-red-400" : 
                  variant === 'warning' ? "bg-primary/10 text-primary" : 
                  "bg-secondary/10 text-secondary"
                )}>
                  <AlertCircle className="w-6 h-6" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="mb-2 font-headline text-lg font-bold tracking-tight text-on-surface">{title}</h3>
                  <p className="text-sm leading-relaxed text-on-surface/65">{message}</p>
                </div>
                
                <button 
                  onClick={onCancel}
                  className="rounded-full p-2 text-on-surface/40 transition-colors hover:bg-white/5 hover:text-on-surface"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="mt-8 flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 rounded-full bg-white/[0.06] px-4 py-3 text-sm font-bold text-on-surface/80 outline outline-[0.5px] outline-white/10 transition-all hover:bg-white/10"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={cn(
                    "flex-1 rounded-full px-4 py-3 text-sm font-bold transition-all shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)]",
                    variant === 'danger'
                      ? "bg-red-500/90 text-on-surface hover:bg-red-500"
                      : "bg-gradient-to-br from-primary to-on-primary-container text-on-primary-fixed hover:brightness-105"
                  )}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
