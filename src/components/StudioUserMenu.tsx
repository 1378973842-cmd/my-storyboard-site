import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ChevronDown, LogOut, Pencil, Shield, Users, Workflow } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { AuthUser } from '../stores/authStore';
import { useAuthStore } from '../stores/authStore';
import { logoutSession } from '../lib/authSession';
import { updateProfile, uploadAvatar } from '../lib/profileApi';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function avatarInitial(user: AuthUser): string {
  const name = String(user.display_name || user.email || '?').trim();
  const ch = [...name][0];
  return ch ? ch.toUpperCase() : '?';
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
    size === 'lg' ? 'h-16 w-16 text-[18px]' : size === 'md' ? 'h-11 w-11 text-[14px]' : 'h-8 w-8 text-[12px]';

  if (user.avatar_url) {
    const src = version > 0 ? `${user.avatar_url}?v=${version}` : user.avatar_url;
    return (
      <img
        src={src}
        alt=""
        className={cn('shrink-0 rounded-full object-cover shadow-[0_4px_14px_rgba(255,184,102,.18)]', dim)}
      />
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ffb866] to-[#b77100] font-black text-[#1a1410] shadow-[0_4px_14px_rgba(255,184,102,.22)]',
        dim,
      )}
      aria-hidden
    >
      {avatarInitial(user)}
    </span>
  );
}

type StudioUserMenuProps = {
  user: AuthUser;
  isAdmin: boolean;
  /** @deprecated 触发器已统一为封面玻璃胶囊，保留以免调用方报错 */
  heroTone?: boolean;
  onAdminUsers: () => void;
  onAdminRhWorkflows: () => void;
};

export const StudioUserMenu: React.FC<StudioUserMenuProps> = ({
  user,
  isAdmin,
  onAdminUsers,
  onAdminRhWorkflows,
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
    setMenuPos({ top: rect.bottom + 8, right: Math.max(16, window.innerWidth - rect.right) });
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

  const triggerClass = cn(
    'cover-nav-icon-btn cover-nav-icon-btn-muted inline-flex max-w-[220px] items-center gap-2 rounded-full py-1 pl-1 pr-2.5',
    open && 'cover-nav-icon-btn-active',
  );

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
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) syncMenuPos();
          setOpen((v) => !v);
        }}
      >
        <UserAvatar user={user} version={avatarVersion} />
        <span className="truncate text-[12px] font-bold tracking-[0.02em]">
          {user.display_name || user.email}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 opacity-50 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
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
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={spring}
                  className="fixed z-[200] w-[min(300px,calc(100vw-2rem))] overflow-hidden rounded-[20px] bg-[#1c1b1b]/92 backdrop-blur-[28px] shadow-[0_24px_64px_rgba(0,0,0,.45)]"
                  style={{
                    top: menuPos.top,
                    right: menuPos.right,
                    outline: '0.5px solid rgba(255,184,102,.14)',
                    outlineOffset: '-0.5px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-3 px-4 py-4">
                    <UserAvatar user={user} size="md" version={avatarVersion} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-[15px] tracking-[-0.02em] text-[#e5e2e1]">
                        {user.display_name || '成员'}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[#e5e2e1]/45">{user.email}</p>
                      <span
                        className={cn(
                          'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]',
                          isAdmin
                            ? 'bg-[#ffb866]/14 text-[#ffb866]'
                            : 'bg-white/[0.06] text-[#e5e2e1]/55',
                        )}
                      >
                        {isAdmin ? (
                          <>
                            <Shield className="h-3 w-3" aria-hidden />
                            管理员
                          </>
                        ) : (
                          '成员'
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-white/[0.06] py-1">
                    <MenuBtn
                      icon={Pencil}
                      label={profileEdit ? '收起资料编辑' : '编辑资料'}
                      onClick={() => {
                        setProfileError('');
                        setProfileEdit((v) => !v);
                      }}
                    />
                  </div>

                  <AnimatePresence>
                    {profileEdit ? (
                      <motion.div
                        key="profile-edit"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={spring}
                        className="overflow-hidden border-t border-white/[0.06]"
                      >
                        <div className="space-y-3 px-4 py-4">
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
                              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#e5e2e1]/45">
                                头像
                              </p>
                              <button
                                type="button"
                                onClick={onPickAvatar}
                                disabled={avatarUploading}
                                className="mt-1 text-[12px] font-bold text-[#ffb866] transition-colors hover:text-[#ffc98a] disabled:opacity-50"
                              >
                                {avatarUploading ? '上传中…' : '上传图片'}
                              </button>
                              <p className="mt-1 text-[10px] text-[#e5e2e1]/35">JPG / PNG / WebP，最大 5MB</p>
                            </div>
                          </div>

                          <div>
                            <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#e5e2e1]/45">
                              显示名称
                            </label>
                            <input
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              maxLength={80}
                              placeholder="同事看到的名字"
                              className="mt-1.5 w-full rounded-xl bg-[#131313]/80 px-3 py-2 text-[12px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 focus:outline-none"
                              style={{ outline: '0.5px solid rgba(255,255,255,.08)', outlineOffset: '-0.5px' }}
                            />
                          </div>

                          {profileError ? (
                            <p className="text-[11px] text-[#fca5a5]">{profileError}</p>
                          ) : null}

                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setProfileEdit(false);
                                setDraftName(user.display_name);
                                setProfileError('');
                              }}
                              className="rounded-full px-3 py-1.5 text-[11px] font-bold text-[#e5e2e1]/55 hover:text-[#e5e2e1]"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              disabled={saving || !draftName.trim()}
                              onClick={() => void onSaveProfile()}
                              className="rounded-full bg-[#ffb866] px-3.5 py-1.5 text-[11px] font-bold text-[#1a1410] disabled:opacity-45"
                            >
                              {saving ? '保存中…' : '保存'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {isAdmin ? (
                    <div className="border-t border-white/[0.06] py-1">
                      <MenuBtn
                        icon={Users}
                        label="用户管理"
                        onClick={() => {
                          close();
                          onAdminUsers();
                        }}
                      />
                      <MenuBtn
                        icon={Workflow}
                        label="RH 工作流配置"
                        onClick={() => {
                          close();
                          onAdminRhWorkflows();
                        }}
                      />
                    </div>
                  ) : null}

                  <div className="border-t border-white/[0.06] py-1">
                    <MenuBtn
                      icon={LogOut}
                      label="退出登录"
                      danger
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

function MenuBtn({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[12px] font-bold transition-colors hover:bg-white/[0.05]',
        danger ? 'text-[#fca5a5] hover:text-[#fecaca]' : 'text-[#e5e2e1]/82',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      {label}
    </button>
  );
}
