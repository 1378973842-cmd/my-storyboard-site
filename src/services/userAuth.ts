import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import type { Express, NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { parseCookieHeader } from "./siteAccessGate.js";
import { recordFileOwnership } from "./canvasGenerations.js";

export const AUTH_COOKIE_NAME = "sb_session_v1";

export type UserRole = "admin" | "user";

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  cover_url: string | null;
  role: UserRole;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  cover_url?: string | null;
  password_hash: string;
  role: UserRole;
  disabled: number;
  created_at: string;
};

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const COVER_MAX_BYTES = 8 * 1024 * 1024;
const imageUploadFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const mime = (file.mimetype || "").toLowerCase();
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
    cb(null, true);
    return;
  }
  cb(new Error("仅支持 JPG / PNG / WebP / GIF"));
};
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: imageUploadFilter,
});
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: COVER_MAX_BYTES },
  fileFilter: imageUploadFilter,
});

const AUTH_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.AUTH_LOGIN_WINDOW_MS || 15 * 60 * 1000) || 15 * 60 * 1000
);
const AUTH_MAX_ATTEMPTS = Math.max(
  3,
  Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 10) || 10
);
const SESSION_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.AUTH_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000) || 7 * 24 * 60 * 60 * 1000
);

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/** 在线：2 分钟内心跳且标签可见；离开：15 分钟内；否则离线 */
const PRESENCE_ONLINE_MS = 2 * 60 * 1000;
const PRESENCE_AWAY_MS = 15 * 60 * 1000;
const PRESENCE_STALE_MS = 20 * 60 * 1000;
const LOGIN_EVENTS_DEFAULT_LIMIT = 20;

export type PresenceStatus = "online" | "away" | "offline";

type PresenceRow = {
  session_key: string;
  user_id: string;
  last_seen_at: number;
  page_path: string | null;
  is_visible: number;
};

type LoginEventRow = {
  id: string;
  user_id: string;
  created_at: number;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

function sessionSecret(): string {
  const v = (process.env.SESSION_SECRET ?? "").trim();
  if (v.length >= 32) return v;
  if (process.env.NODE_ENV === "production") return "";
  return v || "dev-only-session-secret-change-me-32chars-min";
}

function normalizeEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1];
  const expected = parts[2];
  const actual = scryptSync(password, salt, 64).toString("hex");
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  } catch {
    return false;
  }
}

function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0]?.trim() || req.ip || "unknown";
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function loginRateLimit(req: Request, res: Response): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + AUTH_WINDOW_MS };
    loginAttempts.set(ip, entry);
  }
  if (entry.count >= AUTH_MAX_ATTEMPTS) {
    res.status(429).json({
      error: `登录尝试次数过多，请 ${Math.ceil((entry.resetAt - now) / 60000)} 分钟后再试`,
    });
    return false;
  }
  entry.count += 1;
  return true;
}

function clearLoginRateLimit(req: Request): void {
  loginAttempts.delete(clientIp(req));
}

function requestIsHttps(req: Request): boolean {
  if (req.secure) return true;
  const xfProto = req.headers["x-forwarded-proto"];
  if (typeof xfProto === "string" && xfProto.split(",")[0]?.trim().toLowerCase() === "https") {
    return true;
  }
  return false;
}

function buildSessionCookie(token: string, req: Request): string {
  const parts = [`${AUTH_COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  const forceSecure = String(process.env.AUTH_COOKIE_SECURE || "").trim();
  if (forceSecure === "1" || (forceSecure !== "0" && requestIsHttps(req))) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function buildClearSessionCookie(req: Request): string {
  const parts = [`${AUTH_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  const forceSecure = String(process.env.AUTH_COOKIE_SECURE || "").trim();
  if (forceSecure === "1" || (forceSecure !== "0" && requestIsHttps(req))) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function signSessionPayload(userId: string, exp: number): string {
  const secret = sessionSecret();
  return createHmac("sha256", secret).update(`${userId}.${exp}`).digest("hex");
}

function createSessionToken(userId: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = signSessionPayload(userId, exp);
  return `${userId}.${exp}.${sig}`;
}

function parseSessionToken(token: string | undefined): { userId: string; exp: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const userId = parts[0];
  const exp = Number(parts[1]);
  const sig = parts[2];
  if (!userId || !Number.isFinite(exp) || !sig) return null;
  if (Date.now() > exp) return null;
  const expected = signSessionPayload(userId, exp);
  if (expected.length !== sig.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"))) return null;
  } catch {
    return null;
  }
  return { userId, exp };
}

function rowToAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name || row.email,
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    cover_url: row.cover_url ? String(row.cover_url) : null,
    role: row.role === "admin" ? "admin" : "user",
  };
}

function avatarExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return map[mime] || ".jpg";
}

function removeLocalUpload(projectRoot: string, webPath: string | null | undefined): void {
  const rel = String(webPath || "")
    .replace(/^\/uploads\//, "")
    .replace(/\\/g, "/");
  if (!rel || rel.includes("..")) return;
  const abs = path.join(projectRoot, "public", "uploads", rel);
  const root = path.join(projectRoot, "public", "uploads");
  if (!abs.startsWith(root) || !existsSync(abs)) return;
  try {
    unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

function saveUserAvatarFile(
  db: InstanceType<typeof Database>,
  projectRoot: string,
  userId: string,
  buffer: Buffer,
  mime: string
): string {
  const ext = avatarExtFromMime(mime);
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `${safeId}${ext}`;
  const dir = path.join(projectRoot, "public", "uploads", "avatars");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), buffer);
  const url = `/uploads/avatars/${filename}`;
  recordFileOwnership(db, url, userId);
  return url;
}

function saveUserCoverFile(
  db: InstanceType<typeof Database>,
  projectRoot: string,
  userId: string,
  buffer: Buffer,
  mime: string
): string {
  const ext = avatarExtFromMime(mime);
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  // ponytail: overwrite same path; clients bust cache with ?v=
  const filename = `${safeId}${ext}`;
  const dir = path.join(projectRoot, "public", "uploads", "covers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), buffer);
  const url = `/uploads/covers/${filename}`;
  recordFileOwnership(db, url, userId);
  return url;
}

export function validateAuthForDeploy(): void {
  const isProd = process.env.NODE_ENV === "production";
  const secret = sessionSecret();
  if (isProd && secret.length < 32) {
    console.error(
      "[auth] 生产环境必须在 .env 设置 SESSION_SECRET（至少 32 位随机字符串），保存后重启服务。"
    );
    process.exit(1);
  }
  if (!isProd && !(process.env.SESSION_SECRET ?? "").trim()) {
    console.warn("[auth] 开发环境未设置 SESSION_SECRET，使用内置默认值（上线前务必更换）");
  }
  if (isProd) {
    const email = normalizeEmail(process.env.ADMIN_EMAIL);
    const password = String(process.env.ADMIN_PASSWORD ?? "").trim();
    if (!email || password.length < 8) {
      console.error(
        "[auth] 生产环境首次启动须设置 ADMIN_EMAIL 与 ADMIN_PASSWORD（至少 8 位），用于创建管理员账号。"
      );
      process.exit(1);
    }
  }
}

export function initUserAuthSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
  try {
    db.prepare("ALTER TABLE users ADD COLUMN avatar_url TEXT").run();
  } catch {
    /* column exists */
  }
  try {
    db.prepare("ALTER TABLE users ADD COLUMN cover_url TEXT").run();
  } catch {
    /* column exists */
  }
  try {
    db.prepare("ALTER TABLE users ADD COLUMN last_login_at INTEGER").run();
  } catch {
    /* column exists */
  }
  try {
    db.prepare("ALTER TABLE users ADD COLUMN last_seen_at INTEGER").run();
  } catch {
    /* column exists */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_presence (
      session_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      last_seen_at INTEGER NOT NULL,
      page_path TEXT,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presence_user ON user_presence(user_id);
    CREATE INDEX IF NOT EXISTS idx_presence_seen ON user_presence(last_seen_at);
    CREATE TABLE IF NOT EXISTS login_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, created_at DESC);
  `);
}

function cleanupStalePresence(db: InstanceType<typeof Database>): void {
  const cutoff = Date.now() - PRESENCE_STALE_MS;
  db.prepare("DELETE FROM user_presence WHERE last_seen_at < ?").run(cutoff);
}

function recordUserLogin(db: InstanceType<typeof Database>, userId: string): void {
  const now = Date.now();
  db.prepare("UPDATE users SET last_login_at = ?, last_seen_at = ? WHERE id = ?").run(now, now, userId);
  db.prepare("INSERT INTO login_events (id, user_id, created_at) VALUES (?, ?, ?)").run(
    uuidv4(),
    userId,
    now
  );
}

function sanitizePresencePage(raw: unknown): string | null {
  const page = String(raw ?? "")
    .trim()
    .slice(0, 120);
  return page || null;
}

function upsertUserPresence(
  db: InstanceType<typeof Database>,
  userId: string,
  sessionKey: string,
  pagePath: string | null,
  isVisible: boolean
): void {
  cleanupStalePresence(db);
  const now = Date.now();
  const existing = db
    .prepare("SELECT session_key FROM user_presence WHERE session_key = ?")
    .get(sessionKey) as { session_key: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE user_presence SET user_id = ?, last_seen_at = ?, page_path = ?, is_visible = ? WHERE session_key = ?`
    ).run(userId, now, pagePath, isVisible ? 1 : 0, sessionKey);
  } else {
    db.prepare(
      `INSERT INTO user_presence (session_key, user_id, last_seen_at, page_path, is_visible, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sessionKey, userId, now, pagePath, isVisible ? 1 : 0, now);
  }
  db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, userId);
}

function clearPresenceSession(db: InstanceType<typeof Database>, sessionKey: string): void {
  if (!sessionKey) return;
  db.prepare("DELETE FROM user_presence WHERE session_key = ?").run(sessionKey);
}

function derivePresenceStatus(
  rows: PresenceRow[],
  now: number,
  disabled: boolean
): { status: PresenceStatus; current_page: string | null; last_seen_at: number | null } {
  if (disabled || rows.length === 0) {
    return { status: "offline", current_page: null, last_seen_at: null };
  }

  const recent = rows.filter((r) => now - r.last_seen_at <= PRESENCE_AWAY_MS);
  if (recent.length === 0) {
    const maxSeen = Math.max(...rows.map((r) => r.last_seen_at));
    return { status: "offline", current_page: null, last_seen_at: maxSeen };
  }

  const onlineCandidates = recent.filter(
    (r) => r.is_visible === 1 && now - r.last_seen_at <= PRESENCE_ONLINE_MS
  );
  const best = (onlineCandidates.length ? onlineCandidates : recent).reduce((a, b) =>
    a.last_seen_at >= b.last_seen_at ? a : b
  );

  const status: PresenceStatus =
    onlineCandidates.length > 0 ? "online" : "away";

  return {
    status,
    current_page: best.page_path,
    last_seen_at: best.last_seen_at,
  };
}

function listPresenceByUserIds(
  db: InstanceType<typeof Database>,
  userIds: string[],
  now: number
): Map<string, PresenceRow[]> {
  const map = new Map<string, PresenceRow[]>();
  if (userIds.length === 0) return map;

  const cutoff = now - PRESENCE_AWAY_MS;
  const placeholders = userIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT session_key, user_id, last_seen_at, page_path, is_visible
       FROM user_presence WHERE user_id IN (${placeholders}) AND last_seen_at >= ?`
    )
    .all(...userIds, cutoff) as PresenceRow[];

  for (const row of rows) {
    const list = map.get(row.user_id) ?? [];
    list.push(row);
    map.set(row.user_id, list);
  }
  return map;
}

function msToIso(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

export function bootstrapAdminUser(db: InstanceType<typeof Database>): void {
  const count = (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
  if (count > 0) return;

  const email = normalizeEmail(process.env.ADMIN_EMAIL) || "admin@local.dev";
  const password = String(process.env.ADMIN_PASSWORD ?? "").trim() || "admin123456";
  const displayName = String(process.env.ADMIN_DISPLAY_NAME ?? "").trim() || "管理员";

  if (process.env.NODE_ENV === "production" && password.length < 8) {
    throw new Error("ADMIN_PASSWORD 至少 8 位");
  }

  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, disabled)
     VALUES (?, ?, ?, ?, 'admin', 0)`
  ).run(uuidv4(), email, displayName, hashPassword(password));

  console.log(`[auth] 已创建管理员账号：${email}（请妥善保管密码，并尽快为同事创建账号）`);
}

export function findUserById(db: InstanceType<typeof Database>, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ? AND disabled = 0").get(id) as UserRow | undefined;
}

export function findUserByEmail(db: InstanceType<typeof Database>, email: string): UserRow | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
    .get(normalizeEmail(email)) as UserRow | undefined;
}

export function getAuthUserFromRequest(
  db: InstanceType<typeof Database>,
  req: Request
): AuthUser | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const parsed = parseSessionToken(cookies[AUTH_COOKIE_NAME]);
  if (!parsed) return null;
  const row = findUserById(db, parsed.userId);
  if (!row) return null;
  return rowToAuthUser(row);
}

export function attachAuthUser(db: InstanceType<typeof Database>, req: Request): AuthUser | null {
  const user = getAuthUserFromRequest(db, req);
  if (user) req.authUser = user;
  return user;
}

/** 取代原暗号门禁：所有 P0 接口需登录 */
export function createRequireAuth(db: InstanceType<typeof Database>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = attachAuthUser(db, req);
    if (!user) {
      res.status(401).json({ error: "请先登录后再使用此功能" });
      return;
    }
    next();
  };
}

export function createRequireAdmin(db: InstanceType<typeof Database>) {
  const requireAuth = createRequireAuth(db);
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req, res, () => {
      if (req.authUser?.role !== "admin") {
        res.status(403).json({ error: "需要管理员权限" });
        return;
      }
      next();
    });
  };
}

export function registerUserAuthRoutes(
  app: Express,
  db: InstanceType<typeof Database>,
  projectRoot: string
): void {
  const requireAuth = createRequireAuth(db);
  const requireAdmin = createRequireAdmin(db);

  app.get("/api/auth/status", (req, res) => {
    const user = attachAuthUser(db, req);
    if (!user) {
      return res.json({ ok: false });
    }
    return res.json({ ok: true, user });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!loginRateLimit(req, res)) return;

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? "");
    if (!email || !password) {
      return res.status(400).json({ error: "请输入邮箱与密码" });
    }

    const row = findUserByEmail(db, email);
    if (!row || row.disabled || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: "邮箱或密码错误" });
    }

    clearLoginRateLimit(req);
    recordUserLogin(db, row.id);
    const token = createSessionToken(row.id);
    res.setHeader("Set-Cookie", buildSessionCookie(token, req));
    return res.json({ ok: true, user: rowToAuthUser(row) });
  });

  app.post("/api/auth/logout", (req, res) => {
    const sessionKey = String(req.body?.session_key ?? req.body?.sessionKey ?? "").trim();
    if (sessionKey) clearPresenceSession(db, sessionKey);
    res.setHeader("Set-Cookie", buildClearSessionCookie(req));
    return res.json({ ok: true });
  });

  app.post("/api/auth/presence", requireAuth, (req, res) => {
    const sessionKey = String(req.body?.session_key ?? req.body?.sessionKey ?? "").trim();
    if (!sessionKey || sessionKey.length > 64) {
      return res.status(400).json({ error: "无效的 session_key" });
    }
    const pagePath = sanitizePresencePage(req.body?.page ?? req.body?.page_path);
    const isVisible = req.body?.visible !== false && req.body?.is_visible !== 0;
    upsertUserPresence(db, req.authUser!.id, sessionKey, pagePath, isVisible);
    return res.json({ ok: true });
  });

  app.patch("/api/auth/profile", requireAuth, (req, res) => {
    const displayName = String(req.body?.display_name ?? req.body?.displayName ?? "").trim();
    if (!displayName) return res.status(400).json({ error: "名字不能为空" });
    if (displayName.length > 80) return res.status(400).json({ error: "名字过长（最多 80 字）" });

    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, req.authUser!.id);
    const row = findUserById(db, req.authUser!.id);
    if (!row) return res.status(404).json({ error: "用户不存在" });
    return res.json({ ok: true, user: rowToAuthUser(row) });
  });

  app.post("/api/auth/avatar", requireAuth, (req, res) => {
    avatarUpload.single("avatar")(req, res, (err) => {
      if (err) {
        const message = err instanceof Error ? err.message : "上传头像失败";
        return res.status(400).json({ error: message });
      }

      try {
        const file = req.file;
        if (!file?.buffer?.length) {
          return res.status(400).json({ error: "请选择头像图片" });
        }

        const userId = req.authUser!.id;
        const row = findUserById(db, userId);
        if (!row) return res.status(404).json({ error: "用户不存在" });

        const mime = (file.mimetype || "image/jpeg").toLowerCase();
        const nextUrl = saveUserAvatarFile(db, projectRoot, userId, file.buffer, mime);
        db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(nextUrl, userId);

        if (row.avatar_url && row.avatar_url !== nextUrl) {
          removeLocalUpload(projectRoot, row.avatar_url);
        }

        const updated = findUserById(db, userId);
        if (!updated) return res.status(404).json({ error: "用户不存在" });
        return res.json({ ok: true, user: rowToAuthUser(updated) });
      } catch (e) {
        const message = e instanceof Error ? e.message : "上传头像失败";
        return res.status(400).json({ error: message });
      }
    });
  });

  app.post("/api/auth/cover", requireAuth, (req, res) => {
    coverUpload.single("cover")(req, res, (err) => {
      if (err) {
        const message = err instanceof Error ? err.message : "上传背景失败";
        return res.status(400).json({ error: message });
      }

      try {
        const file = req.file;
        if (!file?.buffer?.length) {
          return res.status(400).json({ error: "请选择背景图片" });
        }

        const userId = req.authUser!.id;
        const row = findUserById(db, userId);
        if (!row) return res.status(404).json({ error: "用户不存在" });

        const mime = (file.mimetype || "image/jpeg").toLowerCase();
        const nextUrl = saveUserCoverFile(db, projectRoot, userId, file.buffer, mime);
        db.prepare("UPDATE users SET cover_url = ? WHERE id = ?").run(nextUrl, userId);

        if (row.cover_url && row.cover_url !== nextUrl) {
          removeLocalUpload(projectRoot, row.cover_url);
        }

        const updated = findUserById(db, userId);
        if (!updated) return res.status(404).json({ error: "用户不存在" });
        return res.json({ ok: true, user: rowToAuthUser(updated) });
      } catch (e) {
        const message = e instanceof Error ? e.message : "上传背景失败";
        return res.status(400).json({ error: message });
      }
    });
  });

  app.get("/api/admin/users", requireAdmin, (_req, res) => {
    cleanupStalePresence(db);
    const now = Date.now();
    type AdminUserRow = {
      id: string;
      email: string;
      display_name: string;
      role: UserRole;
      disabled: number;
      created_at: string;
      last_login_at: number | null;
      last_seen_at: number | null;
    };
    const rows = db
      .prepare(
        `SELECT id, email, display_name, role, disabled, created_at, last_login_at, last_seen_at
         FROM users ORDER BY created_at ASC`
      )
      .all() as AdminUserRow[];

    const userIds = rows.map((r) => r.id);
    const presenceMap = listPresenceByUserIds(db, userIds, now);

    let onlineCount = 0;
    let awayCount = 0;

    const users = rows.map((row) => {
      const presenceRows = presenceMap.get(row.id) ?? [];
      const derived = derivePresenceStatus(presenceRows, now, row.disabled === 1);
      if (row.disabled !== 1) {
        if (derived.status === "online") onlineCount += 1;
        else if (derived.status === "away") awayCount += 1;
      }
      const lastSeenMs = derived.last_seen_at ?? row.last_seen_at ?? null;
      return {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        role: row.role,
        disabled: row.disabled,
        created_at: row.created_at,
        last_login_at: msToIso(row.last_login_at),
        last_seen_at: msToIso(lastSeenMs),
        status: derived.status,
        current_page: derived.current_page,
      };
    });

    res.json({
      users,
      summary: {
        online: onlineCount,
        away: awayCount,
        total: rows.length,
      },
    });
  });

  app.get("/api/admin/users/:id/login-events", requireAdmin, (req, res) => {
    const targetId = String(req.params.id || "").trim();
    const row = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
    if (!row) return res.status(404).json({ error: "用户不存在" });

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(1, Math.floor(limitRaw)), 50)
      : LOGIN_EVENTS_DEFAULT_LIMIT;

    const events = db
      .prepare(
        `SELECT id, user_id, created_at FROM login_events
         WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(targetId, limit) as LoginEventRow[];

    res.json({
      events: events.map((e) => ({
        id: e.id,
        created_at: msToIso(e.created_at),
      })),
    });
  });

  app.post("/api/admin/users", requireAdmin, (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const displayName = String(req.body?.display_name ?? req.body?.displayName ?? "").trim();
    const password = String(req.body?.password ?? "").trim();
    const role: UserRole = req.body?.role === "admin" ? "admin" : "user";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "请输入有效邮箱" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "初始密码至少 8 位" });
    }
    if (findUserByEmail(db, email)) {
      return res.status(409).json({ error: "该邮箱已存在" });
    }

    const id = uuidv4();
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, role, disabled)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).run(id, email, displayName || email.split("@")[0], hashPassword(password), role);

    res.status(201).json({
      user: { id, email, display_name: displayName || email.split("@")[0], role, disabled: 0 },
    });
  });

  app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
    const targetId = String(req.params.id || "").trim();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as UserRow | undefined;
    if (!row) return res.status(404).json({ error: "用户不存在" });

    const disabled = req.body?.disabled;
    const newPassword = String(req.body?.password ?? "").trim();
    const displayName = String(req.body?.display_name ?? req.body?.displayName ?? "").trim();

    if (typeof disabled === "boolean") {
      if (row.role === "admin" && disabled) {
        const adminCount = (
          db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0").get() as {
            c: number;
          }
        ).c;
        if (adminCount <= 1) {
          return res.status(400).json({ error: "至少保留一名可用管理员" });
        }
      }
      db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, targetId);
      if (disabled) {
        db.prepare("DELETE FROM user_presence WHERE user_id = ?").run(targetId);
      }
    }

    if (displayName) {
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName.slice(0, 80), targetId);
    }

    if (newPassword) {
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "新密码至少 8 位" });
      }
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(newPassword), targetId);
    }

    const updated = db
      .prepare("SELECT id, email, display_name, role, disabled, created_at FROM users WHERE id = ?")
      .get(targetId);
    res.json({ user: updated });
  });
}
