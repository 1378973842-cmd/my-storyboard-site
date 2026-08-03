import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUp, Loader2, Plus } from 'lucide-react';
import { useShellNavigation } from '../shell/ShellNavigation';
import { useAuthStore } from '../stores/authStore';
import { useStore } from '../store/useStore';
import {
  createAndOpenCanvas,
  fetchRecentCanvases,
  openExistingCanvas,
  type CanvasListItem,
} from '../lib/homeCanvasBridge';
import { HomeCarouselStrip } from './HomeCarouselStrip';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function toMs(ts?: number): number {
  const raw = Number(ts || 0);
  if (!raw) return 0;
  return raw < 10000000000 ? raw * 1000 : raw;
}

/** 标题右侧短日期，对齐参考站 (MMDD) */
function formatHomeParenDate(ts?: number): string {
  const ms = toMs(ts);
  if (!ms) return '';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `(${m}${d})`;
}

/** 与画布闸门「编辑于…」口径一致的相对时间 */
function formatHomeEditedLabel(ts?: number): string {
  const ms = toMs(ts);
  if (!ms) return '编辑于 --';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '编辑于 --';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return '编辑于 刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '编辑于 几秒前';
  const min = Math.floor(sec / 60);
  if (min < 60) return `编辑于 ${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `编辑于 ${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `编辑于 ${day} 天前`;
  return `编辑于 ${date.toLocaleDateString('zh-CN')}`;
}

export function CoverHomeWorkspace() {
  const { openInfiniteCanvas, warmInfiniteCanvas } = useShellNavigation();
  const user = useAuthStore((s) => s.user);
  const addNotice = useStore((s) => s.addNotice);
  const [prompt, setPrompt] = useState('');
  const [recent, setRecent] = useState<CanvasListItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const reloadRecent = useCallback(async () => {
    if (!user) {
      setRecent([]);
      return;
    }
    setLoadingRecent(true);
    try {
      setRecent(await fetchRecentCanvases(3));
    } catch {
      setRecent([]);
    } finally {
      setLoadingRecent(false);
    }
  }, [user]);

  useEffect(() => {
    void reloadRecent();
  }, [reloadRecent]);

  const handleSend = () => {
    if (!prompt.trim()) return;
    if (!user) {
      addNotice('请先登录后再使用创作输入', 'error');
      return;
    }
    addNotice('模型接入即将开放', 'info');
  };

  const handleCreate = async () => {
    if (!user) {
      addNotice('请先登录后再新建项目', 'error');
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      await createAndOpenCanvas({ warmInfiniteCanvas, openInfiniteCanvas });
    } catch (e) {
      addNotice(e instanceof Error ? e.message : '创建画布失败', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleOpen = async (id: string) => {
    if (openingId) return;
    setOpeningId(id);
    try {
      await openExistingCanvas(id, { warmInfiniteCanvas, openInfiniteCanvas });
    } catch (e) {
      addNotice(e instanceof Error ? e.message : '打开画布失败', 'error');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="relative z-10 flex min-h-[100dvh] w-full flex-col">
      <div className="cover-home-main mx-auto flex w-full max-w-[980px] flex-1 flex-col px-6 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="cover-home-prompt-shell"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={3}
            placeholder="描述你想创造的画面…"
            className="cover-home-prompt-input"
          />
          <button
            type="button"
            onClick={handleSend}
            className="cover-home-prompt-send"
            aria-label="发送"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.06 }}
          className="cover-home-project-row mt-6 md:mt-7"
        >
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="cover-home-project-card cover-home-project-new"
          >
            <span className="cover-home-project-new-icon">
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" strokeWidth={2} />
              )}
            </span>
            <span className="cover-home-project-title">{creating ? '创建中…' : '新建项目'}</span>
            <span className="cover-home-project-meta">直接进入画布</span>
          </button>

          {loadingRecent
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={`sk-${i}`} className="cover-home-project-card cover-home-project-skeleton" />
              ))
            : recent.map((item) => {
                const parenDate = formatHomeParenDate(item.created_at || item.updated_at);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void handleOpen(item.id)}
                    disabled={openingId === item.id}
                    className="cover-home-project-card"
                  >
                    <div
                      className={cn(
                        'cover-home-project-thumb',
                        !item.preview_url && 'cover-home-project-thumb-empty',
                      )}
                    >
                      {item.preview_url ? (
                        <img src={item.preview_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span>{item.icon || '🧩'}</span>
                      )}
                    </div>
                    <span className="cover-home-project-copy">
                      <span className="cover-home-project-title truncate">
                        {openingId === item.id
                          ? '打开中…'
                          : `${item.title || '未命名画布'}${parenDate ? ` ${parenDate}` : ''}`}
                      </span>
                      <span className="cover-home-project-meta">
                        {formatHomeEditedLabel(item.updated_at || item.created_at)}
                      </span>
                    </span>
                  </button>
                );
              })}

          {!loadingRecent && user && recent.length === 0 ? (
            <div className="cover-home-project-card cover-home-project-empty pointer-events-none">
              <span className="cover-home-project-meta">还没有最近项目</span>
            </div>
          ) : null}

          {!user ? (
            <div className="cover-home-project-card cover-home-project-empty pointer-events-none">
              <span className="cover-home-project-meta">登录后显示最近项目</span>
            </div>
          ) : null}
        </motion.div>
      </div>

      <HomeCarouselStrip />
    </div>
  );
}
