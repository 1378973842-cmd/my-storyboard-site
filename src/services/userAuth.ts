import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { parseCookieHeader } from "./siteAccessGate.js";

export const AUTH_COOKIE_NAME = "sb_session_v1";

export type UserRole = "admin" | "user";

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  disabled: number;
  created_at: string;
};

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
    role: row.role === "admin" ? "admin" : "user",
  };
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

export function registerUserAuthRoutes(app: Express, db: InstanceType<typeof Database>): void {
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
    const token = createSessionToken(row.id);
    res.setHeader("Set-Cookie", buildSessionCookie(token, req));
    return res.json({ ok: true, user: rowToAuthUser(row) });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.setHeader("Set-Cookie", buildClearSessionCookie(req));
    return res.json({ ok: true });
  });

  const requireAdmin = createRequireAdmin(db);

  app.get("/api/admin/users", requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, email, display_name, role, disabled, created_at
         FROM users ORDER BY created_at ASC`
      )
      .all();
    res.json({ users: rows });
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
