import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Images,
  LogOut,
  Plus,
  Settings,
  UserRound,
  Users,
  Workflow,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { AuthUser } from '../stores/authStore';
import { useAuthStore } from '../stores/authStore';
import { logoutSession } from '../lib/authSession';
import { updateProfile, uploadAvatar } from '../lib/profileApi';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function avatarInitials(user: AuthUser): string {
  const name = String(user.display_name || user.email || '?').trim();
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${[...parts[0]][0] || ''}${[...parts[1]][0] || ''}`.toUpperCase() || '?';
  }
  const chars = [...name];
  if (chars.length >= 2) return `${chars[0]}${chars[1]}`.toUpperCase();
  return (chars[0] || '?').toUpperCase();
}

function UserAvatar({
  user,
  size = 'sm',
  version = 0,
}: {
  user: AuthUser;
  size?: 'sm' | 'md' | 'lg';
  version?: number;
}) {
  const dim =
    size === 'lg' ? 'h-14 w-14 text-[16px]' : size === 'md' ? 'h-10 w-10 text-[13px]' : 'h-9 w-9 text-[11px]';

  if (user.avatar_url) {
    const src = version > 0 ? `${user.avatar_url}?v=${version}` : user.avatar_url;
    return <img src={src} alt="" className={cn('shrink-0 rounded-full object-cover', dim)} />;
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-[#2a5f66] font-semibold tracking-wide text-[#e5e2e1]',
        dim,
      )}
      aria-hidden
    >
      {avatarInitials(user)}
    </span>
  );
}

type StudioUserMenuProps = {
  user: AuthUser;
  isAdmin: boolean;
  /** @deprecated 触发器已统一为封面玻璃胶囊，保留以免调用方报错 */
  heroTone?: boolean;
  onPersonal?: () => void;
  onAdminUsers: () => void;
  onAdminRhWorkflows: () => void;
  onAdminHomeCarousel?: () => void;
};

export const StudioUserMenu: React.FC<StudioUserMenuProps> = ({
  user,
  isAdmin,
  onPersonal,
  onAdminUsers,
  onAdminRhWorkflows,
  onAdminHomeCarousel,
}) => {
  const setUser = useAuthStore((s) => s.setUser);
  const [open, setOpen] = useState(false);
  const [profileEdit, setProfileEdit] = useState(false);
  const [draftName, setDraftName] = useState(user.display_name);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 16 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!profileEdit) setDraftName(user.display_name);
  }, [profileEdit, user.display_name]);

  const syncMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right) });
  }, []);

  useEffect(() => {
    if (!open) return;
    syncMenuPos();
    const onLayout = () => syncMenuPos();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, syncMenuPos]);

  useEffect(() => {
    if (!open) {
      setProfileEdit(false);
      setProfileError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let attached = false;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const id = window.setTimeout(() => {
      attached = true;
      document.addEventListener('click', onDoc);
    }, 0);
    return () => {
      window.clearTimeout(id);
      if (attached) document.removeEventListener('click', onDoc);
    };
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const onSaveProfile = useCallback(async () => {
    const name = draftName.trim();
    if (!name || saving) return;
    setSaving(true);
    setProfileError('');
    try {
      const next = await updateProfile(name);
      setUser(next);
      setProfileEdit(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [draftName, saving, setUser]);

  const onPickAvatar = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onAvatarFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || avatarUploading) return;
      setAvatarUploading(true);
      setProfileError('');
      try {
        const next = await uploadAvatar(file);
        setUser(next);
        setAvatarVersion((v) => v + 1);
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : '上传头像失败');
      } finally {
        setAvatarUploading(false);
      }
    },
    [avatarUploading, setUser],
  );

  const displayName = user.display_name || user.email.split('@')[0] || '成员';

  return (
    <div className="relative shrink-0">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void onAvatarFile(e)}
      />

      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full',
          'outline outline-0.5 outline-white/10 transition-[outline-color,transform] duration-200',
          open ? 'outline-[#ffb866]/40 scale-[1.03]' : 'hover:outline-white/25',
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={displayName}
        title={displayName}
        onClick={(e) => {
          e.stopPropagation();
          if (!open) syncMenuPos();
          setOpen((v) => !v);
        }}
      >
        <UserAvatar user={user} version={avatarVersion} />
      </button>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  key="studio-user-menu"
                  ref={menuRef}
                  role="menu"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={spring}
                  className="fixed z-[200] w-[min(268px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-[#1a1a1a] shadow-[0_20px_56px_-16px_rgba(0,0,0,.7)]"
                  style={{
                    top: menuPos.top,
                    right: menuPos.right,
                    outline: '0.5px solid rgba(69,70,77,.28)',
                    outlineOffset: '-0.5px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* 身份头 */}
                  <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                    <UserAvatar user={user} size="md" version={avatarVersion} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-[#e5e2e1]">{displayName}</p>
                      <p className="mt-0.5 truncate text-[12px] text-[#e5e2e1]/40">{user.email}</p>
                    </div>
                  </div>

                  {/* 状态卡（参考站额度卡结构） */}
                  <div className="px-3 pb-2">
                    <div className="rounded-xl bg-[#242424] px-3.5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.06]">
                          <Settings className="h-3 w-3 text-[#e5e2e1]/55" strokeWidth={1.75} aria-hidden />
                        </span>
                        <span className="text-[13px] font-semibold text-[#e5e2e1]">
                          {isAdmin ? 'Admin' : 'Member'}
                        </span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]',
                            isAdmin
                              ? 'bg-[#ffb866]/12 text-[#ffb866]'
                              : 'bg-white/[0.06] text-[#e5e2e1]/50',
                          )}
                        >
                          {isAdmin ? 'ADMIN' : 'USER'}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium text-[#ffb866]">
                          {isAdmin ? '全站管理权限' : '团队成员权限'}
                        </span>
                        <span className="text-[14px] font-semibold leading-none text-[#ffb866]">∞</span>
                      </div>
                      <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-[#ffb866]/15">
                        <div className="h-full w-full rounded-full bg-[#ffb866]" />
                      </div>
                    </div>
                  </div>

                  {/* 强调操作 */}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-[#ffb866] transition-colors hover:bg-white/[0.03]"
                    onClick={() => {
                      setProfileError('');
                      setProfileEdit((v) => !v);
                    }}
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    {profileEdit ? '收起资料编辑' : '编辑资料'}
                  </button>

                  <AnimatePresence>
                    {profileEdit ? (
                      <motion.div
                        key="profile-edit"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={spring}
                        className="overflow-hidden"
                      >
                        <div className="mx-3 mb-2 space-y-3 rounded-xl bg-[#242424] px-3.5 py-3">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={onPickAvatar}
                              disabled={avatarUploading}
                              className="group relative shrink-0 rounded-full"
                              title="更换头像"
                            >
                              <UserAvatar user={user} size="lg" version={avatarVersion} />
                              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-[#0e0e0e]/55 opacity-0 transition-opacity group-hover:opacity-100">
                                <Camera className="h-5 w-5 text-[#e5e2e1]" aria-hidden />
                              </span>
                            </button>
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={onPickAvatar}
                                disabled={avatarUploading}
                                className="text-[12px] font-medium text-[#ffb866] disabled:opacity-50"
                              >
                                {avatarUploading ? '上传中…' : '上传头像'}
                              </button>
                              <p className="mt-1 text-[10px] text-[#e5e2e1]/35">JPG / PNG / WebP，最大 5MB</p>
                            </div>
                          </div>
                          <input
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            maxLength={80}
                            placeholder="显示名称"
                            className="w-full rounded-lg bg-[#1a1a1a] px-3 py-2 text-[12px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/30 focus:outline-none"
                            style={{ outline: '0.5px solid rgba(69,70,77,.35)', outlineOffset: '-0.5px' }}
                          />
                          {profileError ? <p className="text-[11px] text-[#fca5a5]">{profileError}</p> : null}
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setProfileEdit(false);
                                setDraftName(user.display_name);
                                setProfileError('');
                              }}
                              className="rounded-lg px-2.5 py-1.5 text-[11px] text-[#e5e2e1]/45 hover:text-[#e5e2e1]"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              disabled={saving || !draftName.trim()}
                              onClick={() => void onSaveProfile()}
                              className="rounded-lg bg-[#ffb866] px-3 py-1.5 text-[11px] font-semibold text-[#1a1410] disabled:opacity-45"
                            >
                              {saving ? '保存中…' : '保存'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  <div className="mx-3 h-px bg-white/[0.07]" />

                  <div className="py-1.5">
                    {onPersonal ? (
                      <MenuRow
                        icon={UserRound}
                        label="个人空间"
                        onClick={() => {
                          close();
                          onPersonal();
                        }}
                      />
                    ) : null}
                    {isAdmin ? (
                      <>
                        <MenuRow
                          icon={Users}
                          label="用户管理"
                          onClick={() => {
                            close();
                            onAdminUsers();
                          }}
                        />
                        <MenuRow
                          icon={Workflow}
                          label="RH 工作流配置"
                          onClick={() => {
                            close();
                            onAdminRhWorkflows();
                          }}
                        />
                        {onAdminHomeCarousel ? (
                          <MenuRow
                            icon={Images}
                            label="主页轮播"
                            onClick={() => {
                              close();
                              onAdminHomeCarousel();
                            }}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  <div className="mx-3 h-px bg-white/[0.07]" />

                  <div className="py-1.5 pb-2">
                    <MenuRow
                      icon={LogOut}
                      label="登出账号"
                      onClick={() => {
                        close();
                        void logoutSession().then(() => window.location.reload());
                      }}
                    />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
};

function MenuRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-[11px] text-left text-[13px] text-[#e5e2e1]/88 transition-colors hover:bg-white/[0.04]"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-[#e5e2e1]/45" strokeWidth={1.6} aria-hidden />
      {label}
    </button>
  );
}
