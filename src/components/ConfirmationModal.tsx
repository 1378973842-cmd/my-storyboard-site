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
            className="relative w-full max-w-md bg-[#1a1f2e] border border-white/10 rounded-3xl shadow-2xl overflow-hidden z-10"
            data-theme-preserve="dark"
          >
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                  variant === 'danger' ? "bg-red-500/10 text-red-500" : 
                  variant === 'warning' ? "bg-amber-500/10 text-amber-500" : 
                  "bg-blue-500/10 text-blue-500"
                )}>
                  <AlertCircle className="w-6 h-6" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
                </div>
                
                <button 
                  onClick={onCancel}
                  className="p-2 hover:bg-white/5 rounded-full text-slate-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="mt-8 flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-bold transition-all"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={cn(
                    "flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all shadow-lg",
                    variant === 'danger' ? "bg-red-500 hover:bg-red-600 text-white shadow-red-500/20" :
                    variant === 'warning' ? "bg-amber-500 hover:bg-amber-600 text-black shadow-amber-500/20" :
                    "bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/20"
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
