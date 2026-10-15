import express from "express";
import { conn } from "../dbconnect";
import { requireOwner, signToken, verifyPassword, TOKEN_TTL_SEC } from "../utils/auth";
import { AppError, rateLimit } from "../utils/http";

export const router = express.Router();

router.post("/login", rateLimit(5, 60_000), async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!username || !password) {
    throw new AppError(400, "BAD_REQUEST", "ต้องกรอก username และ password");
  }
  const [rows] = await conn.query(
    "SELECT user_id, username, password_hash, display_name, role FROM users WHERE username = ? AND is_active = 1",
    [username],
  );
  const u = (rows as any[])[0];
  if (!u || !verifyPassword(password, u.password_hash)) {
    throw new AppError(401, "INVALID_CREDENTIALS", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  }
  await conn.query("UPDATE users SET last_login_at = NOW() WHERE user_id = ?", [u.user_id]);
  res.json({
    data: {
      accessToken: signToken(u.user_id, u.role),
      expiresIn: TOKEN_TTL_SEC,
      user: { id: u.user_id, username: u.username, displayName: u.display_name, role: u.role },
    },
  });
});

router.get("/me", requireOwner, async (req, res) => {
  const [rows] = await conn.query(
    "SELECT user_id, username, display_name, role FROM users WHERE user_id = ? AND is_active = 1",
    [req.user!.id],
  );
  const u = (rows as any[])[0];
  if (!u) throw new AppError(401, "UNAUTHORIZED", "ไม่พบผู้ใช้");
  res.json({ data: { user: { id: u.user_id, username: u.username, displayName: u.display_name, role: u.role } } });
});
