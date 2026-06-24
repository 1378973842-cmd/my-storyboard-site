import { createHmac, timingSafeEqual } from "crypto";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";

/** HttpOnly Cookie，暗号校验成功后下发 */
export const GATE_COOKIE_NAME = "sb_gate_v1";

const DEFAULT_DEV_ACCESS_CODE = "liu888";
const GATE_AUTH_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.GATE_AUTH_WINDOW_MS || 15 * 60 * 1000) || 15 * 60 * 1000
);
const GATE_AUTH_MAX_ATTEMPTS = Math.max(
  3,
  Number(process.env.GATE_AUTH_MAX_ATTEMPTS || 10) || 10
);

const authAttempts = new Map<string, { count: number; resetAt: number }>();

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

/** 开发缺省 liu888；生产必须在 .env 设置强 ACCESS_CODE */
export function resolvedAccessCode(): string {
  const v = (process.env.ACCESS_CODE ?? "").trim();
  if (v.length > 0) return v;
  return DEFAULT_DEV_ACCESS_CODE;
}

export function isDefaultAccessCode(code: string): boolean {
  return code === DEFAULT_DEV_ACCESS_CODE;
}

export function validateAccessCodeForDeploy(): void {
  const code = resolvedAccessCode();
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    if (!process.env.ACCESS_CODE?.trim()) {
      console.warn(
        "[site-gate] 未设置 ACCESS_CODE，开发环境使用默认暗号（上线前请在 .env 设置强暗号）"
      );
    }
    return;
  }
  if (!process.env.ACCESS_CODE?.trim() || isDefaultAccessCode(code) || code.length < 8) {
    console.error(
      "[site-gate] 生产环境必须在 .env 设置 ACCESS_CODE（至少 8 位，且不得为 liu888），保存后重启服务。"
    );
    process.exit(1);
  }
}

export function signedGateToken(): string {
  return createHmac("sha256", `gate|${resolvedAccessCode()}`).update("granted").digest("hex");
}

export function verifyGateCookie(token: string | undefined): boolean {
  if (!token) return false;
  const expected = signedGateToken();
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

function requestIsHttps(req: Request): boolean {
  if (req.secure) return true;
  const xfProto = req.headers["x-forwarded-proto"];
  if (typeof xfProto === "string" && xfProto.split(",")[0]?.trim().toLowerCase() === "https") {
    return true;
  }
  return false;
}

export function buildGateSetCookieHeader(token: string, req: Request): string {
  const parts = [`${GATE_COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  const forceSecure = String(process.env.GATE_COOKIE_SECURE || "").trim();
  if (forceSecure === "1" || (forceSecure !== "0" && requestIsHttps(req))) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0]?.trim() || req.ip || "unknown";
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function gateAuthRateLimit(req: Request, res: Response): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  let entry = authAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + GATE_AUTH_WINDOW_MS };
    authAttempts.set(ip, entry);
  }
  if (entry.count >= GATE_AUTH_MAX_ATTEMPTS) {
    res.status(429).json({
      error: `暗号尝试次数过多，请 ${Math.ceil((entry.resetAt - now) / 60000)} 分钟后再试`,
    });
    return false;
  }
  entry.count += 1;
  return true;
}

export function clearGateAuthRateLimit(req: Request): void {
  authAttempts.delete(clientIp(req));
}

/** 与生图/LLM 等 P0 接口共用的服务端门禁 */
export function requireSiteGate(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookieHeader(req.headers.cookie);
  if (!verifyGateCookie(cookies[GATE_COOKIE_NAME])) {
    res.status(401).json({ error: "请先通过暗号校验后再使用生图功能" });
    return;
  }
  next();
}

export function registerSiteAccessRoutes(app: Express): void {
  app.get("/api/auth/status", (req, res) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    res.json({ ok: verifyGateCookie(cookies[GATE_COOKIE_NAME]) });
  });

  app.post("/api/auth", (req, res) => {
    if (!gateAuthRateLimit(req, res)) return;

    const raw = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const expected = resolvedAccessCode();
    if (!expected) {
      return res.status(503).json({ error: "服务器未配置 ACCESS_CODE" });
    }
    if (raw.length !== expected.length || raw !== expected) {
      return res.status(401).json({ error: "暗号错误" });
    }

    clearGateAuthRateLimit(req);
    const token = signedGateToken();
    res.setHeader("Set-Cookie", buildGateSetCookieHeader(token, req));
    res.json({ ok: true });
  });
}

/** 将 gate 挂到 POST/GET 等路由（无 gate 时等价于原 handler） */
export function gatedRoute(gate: RequestHandler | undefined, handler: RequestHandler): RequestHandler[] {
  return gate ? [gate, handler] : [handler];
}
