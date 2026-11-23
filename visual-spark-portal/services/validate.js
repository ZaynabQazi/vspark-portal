const {
  REG_NO_RE,
  PROGRAMS,
  PAYMENT_METHODS,
  GOOGLE_DRIVE_HOSTS,
  RECEIPT_MAX_BYTES,
} = require("../options");

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRe = /^(\+92|0)?3\d{9}$/;
const PROGRAM_CODES = new Set(PROGRAMS.map((p) => p.code));

function clean(v, max = 200) {
  return String(v ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function normalizeRegNo(v) {
  return clean(v, 32).toUpperCase().replace(/\s+/g, "");
}

function isRegNo(v) {
  return REG_NO_RE.test(normalizeRegNo(v));
}

function isEmail(v) {
  return emailRe.test(clean(v, 120).toLowerCase());
}

function isPhone(v) {
  return phoneRe.test(clean(v, 20).replace(/[\s-]/g, ""));
}

function normalizePhone(v) {
  return clean(v, 20).replace(/[\s-]/g, "");
}

function isProgram(code) {
  return PROGRAM_CODES.has(clean(code, 8).toUpperCase());
}

function isPaymentMethod(v) {
  return PAYMENT_METHODS.includes(v);
}

/** HTTPS Google Drive / Docs links only. */
function isGoogleDriveUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (!GOOGLE_DRIVE_HOSTS.has(host)) return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

/** Magic-byte check: JPEG, PNG or PDF. */
function detectReceipt(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 5) return null;
  if (buf.length > RECEIPT_MAX_BYTES) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { contentType: "image/png", ext: "png" };
  }
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { contentType: "application/pdf", ext: "pdf" };
  }
  return null;
}

function csvEscape(v) {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(head, rows) {
  const lines = [head.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  return "\uFEFF" + lines.join("\n");
}

module.exports = {
  clean,
  normalizeRegNo,
  isRegNo,
  isEmail,
  isPhone,
  normalizePhone,
  isProgram,
  isPaymentMethod,
  isGoogleDriveUrl,
  detectReceipt,
  csvEscape,
  toCsv,
};
