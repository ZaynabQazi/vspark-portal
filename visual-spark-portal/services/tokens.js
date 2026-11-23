const crypto = require("crypto");

function tokenSecret() {
  const s = process.env.TOKEN_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("TOKEN_SECRET is required in production.");
  }
  return "dev-token-secret-not-for-production";
}

function secretFor(kind) {
  const base = tokenSecret();
  const label = kind === "admin" ? "admin-v1" : "participant-v1";
  return crypto.createHmac("sha256", base).update(label).digest("hex");
}

function prefixFor(kind) {
  return kind === "admin" ? "adm" : "prt";
}

function sign(payload, { kind, ttlMs }) {
  const exp = Date.now() + ttlMs;
  const body = Buffer.from(JSON.stringify({ ...payload, kind, exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secretFor(kind)).update(body).digest("base64url");
  return `${prefixFor(kind)}.${body}.${sig}`;
}

function verify(token, expectedKind) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [prefix, body, sig] = parts;
  if (prefix !== prefixFor(expectedKind)) return null;
  const expected = crypto.createHmac("sha256", secretFor(expectedKind)).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (data.kind !== expectedKind) return null;
  if (typeof data.exp !== "number" || Date.now() >= data.exp) return null;
  return data;
}

function bearer(req) {
  const h = req.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return req.get("x-admin-token") || req.get("x-portal-token") || "";
}

module.exports = {
  sign,
  verify,
  bearer,
  ADMIN_TTL_MS: 12 * 60 * 60 * 1000,
  PORTAL_TTL_MS: 8 * 60 * 60 * 1000,
};
