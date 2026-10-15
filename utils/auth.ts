import crypto from "crypto";
import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";
import { AppError } from "./http";

const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me-please-32-bytes!!";
export const TOKEN_TTL_SEC = 8 * 3600;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, keyHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function signToken(userId: number, role: string): string {
  return jwt.sign({ sub: String(userId), role }, SECRET, { algorithm: "HS256", expiresIn: TOKEN_TTL_SEC });
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: string };
    }
  }
}

// ครอบ route ของเจ้าของร้านทั้งหมด
export function requireOwner(req: Request, res: Response, next: NextFunction) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) throw new AppError(401, "UNAUTHORIZED", "กรุณาเข้าสู่ระบบ");
  try {
    const p = jwt.verify(m[1]!, SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (p.role !== "OWNER") throw new Error("role");
    req.user = { id: Number(p.sub), role: String(p.role) };
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "token ไม่ถูกต้องหรือหมดอายุ");
  }
  next();
}
