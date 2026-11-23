const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const clock = require("../services/clock");
const tokens = require("../services/tokens");
const { requireAdmin } = require("../middleware/auth");
const { clientKey } = require("../middleware/security");
const v = require("../services/validate");
const competition = require("../services/competition");
const resultsSvc = require("../services/results");
const mail = require("../services/mail");
const { formatKarachi, minutesAfter } = require("../services/format");
const { INSTITUTE } = require("../options");

const router = express.Router();

function adminCreds() {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production") {
    if (!user || !pass) {
      throw new Error("ADMIN_USER and ADMIN_PASSWORD must be set in production.");
    }
    return { user, pass };
  }
  return { user: user || "admin", pass: pass || "vspark-admin-2026" };
}

function timingEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) {
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

router.post("/api/admin/login", async (req, res, next) => {
  try {
    const username = v.clean(req.body?.username || req.body?.user, 80);
    const password = String(req.body?.password || "");
    const key = `admin:${clientKey(req)}`;
    const rl = await db.loginAttempts.hit(key, { limit: 12, windowMs: 15 * 60 * 1000 });
    if (!rl.ok) {
      return res.status(429).json({ ok: false, errors: ["Too many login attempts. Try again later."] });
    }
    let creds;
    try {
      creds = adminCreds();
    } catch (err) {
      return res.status(500).json({ ok: false, errors: [err.message] });
    }
    const userOk = !creds.user || timingEqual(username || creds.user, creds.user);
    const passOk = timingEqual(password, creds.pass);
    // Also allow password-only login (legacy) when username is omitted.
    const legacy = !username && passOk;
    if (!(userOk && passOk) && !legacy) {
      return res.status(401).json({ ok: false, errors: ["Wrong username or password."] });
    }
    const token = tokens.sign({ role: "admin", sub: creds.user }, { kind: "admin", ttlMs: tokens.ADMIN_TTL_MS });
    res.json({ ok: true, token });
  } catch (e) {
    next(e);
  }
});

function liveRow(reg, attempt, settings, now) {
  const state = db.attemptState(attempt, now);
  const sub = attempt?.submission || null;
  return {
    id: reg.id,
    teamName: reg.teamName,
    members: reg.members,
    memberIds: reg.memberIds,
    venue: competition.venueFor(reg, settings),
    state,
    startedAt: attempt?.startedAt || null,
    endsAt: attempt?.endsAt || null,
    remainingMs: attempt ? Math.max(0, attempt.endsAt - now) : null,
    submittedLink: sub?.driveLink || "",
    submittedAt: sub?.submittedAt || null,
    submittedMinutesAfterStart: sub ? minutesAfter(attempt.startedAt, sub.submittedAt) : null,
  };
}

router.get("/api/admin/registrations", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.registrations.list();
    const settings = await db.settings.get();
    const status = v.clean(req.query.status, 20);
    const filtered = status && ["pending", "accepted", "rejected"].includes(status)
      ? rows.filter((r) => r.status === status)
      : rows;
    const counts = { total: rows.length, pending: 0, accepted: 0, rejected: 0 };
    rows.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status]++;
    });
    res.json({
      ok: true,
      counts,
      defaultVenue: settings.defaultVenue,
      rows: filtered.map((r) => ({
        id: r.id,
        teamName: r.teamName,
        email: r.email,
        phone: r.phone,
        institute: r.institute || INSTITUTE,
        paymentMethod: r.paymentMethod,
        transactionId: r.transactionId,
        status: r.status,
        rejectReason: r.rejectReason || "",
        statusUpdatedAt: r.statusUpdatedAt,
        venue: r.venue || "",
        effectiveVenue: competition.venueFor(r, settings),
        members: r.members,
        memberIds: r.memberIds,
        receiptId: r.receiptId || null,
        hasReceipt: !!r.receiptId,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/api/admin/registrations/:id", requireAdmin, async (req, res, next) => {
  try {
    const row = await db.registrations.getById(req.params.id);
    if (!row) return res.status(404).json({ ok: false, errors: ["Not found."] });
    const patch = {};
    const status = req.body?.status;
    if (status) {
      if (!["pending", "accepted", "rejected"].includes(status)) {
        return res.status(400).json({ ok: false, errors: ["Status must be pending, accepted or rejected."] });
      }
      patch.status = status;
      patch.statusUpdatedAt = clock.now();
      patch.rejectReason = status === "rejected" ? v.clean(req.body.rejectReason, 400) : "";
    }
    if (req.body?.venue !== undefined) patch.venue = v.clean(req.body.venue, 120);
    const updated = await db.registrations.update(row.id, patch);
    if (status === "accepted" || status === "rejected") {
      const settings = await db.settings.get();
      mail.notifyStatus(updated, {
        status,
        venue: competition.venueFor(updated, settings),
        reason: updated.rejectReason,
      }).catch(() => {});
    }
    res.json({ ok: true, row: updated });
  } catch (e) {
    next(e);
  }
});

router.delete("/api/admin/registrations/:id", requireAdmin, async (req, res, next) => {
  try {
    const ok = await db.registrations.remove(req.params.id);
    if (!ok) return res.status(404).json({ ok: false, errors: ["Not found."] });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/api/admin/receipts/:id", requireAdmin, async (req, res, next) => {
  try {
    const row = await db.registrations.getById(req.params.id);
    if (!row || !row.receiptId) return res.status(404).json({ ok: false, errors: ["Receipt not found."] });
    const file = await db.receipts.get(row.receiptId);
    if (!file) return res.status(404).json({ ok: false, errors: ["Receipt not found."] });
    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${String(file.filename || "receipt").replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(file.data);
  } catch (e) {
    next(e);
  }
});

router.get("/api/admin/export.csv", requireAdmin, async (req, res, next) => {
  try {
    const rows = await db.registrations.list();
    const settings = await db.settings.get();
    const head = [
      "ID", "Status", "Team", "Email", "Phone", "M1 Name", "M1 RegNo", "M1 Program",
      "M2 Name", "M2 RegNo", "M2 Program", "Payment", "Txn ID", "Venue", "Reject reason", "Created",
    ];
    const data = rows.map((r) => {
      const m1 = r.members[0] || {};
      const m2 = r.members[1] || {};
      return [
        r.id, r.status, r.teamName, r.email, r.phone,
        m1.name, m1.regNo, m1.programLabel || m1.program,
        m2.name, m2.regNo, m2.programLabel || m2.program,
        r.paymentMethod, r.transactionId, competition.venueFor(r, settings),
        r.rejectReason || "", r.createdAt ? formatKarachi(r.createdAt) : "",
      ];
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=vspark-registrations.csv");
    res.send(v.toCsv(head, data));
  } catch (e) {
    next(e);
  }
});

router.get("/api/admin/settings", requireAdmin, async (req, res, next) => {
  try {
    res.json({ ok: true, settings: await db.settings.get() });
  } catch (e) {
    next(e);
  }
});

router.put("/api/admin/settings", requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.driveLink !== undefined) {
      const link = v.clean(b.driveLink, 500);
      if (link && !v.isGoogleDriveUrl(link)) {
        return res.status(400).json({ ok: false, errors: ["Drive link must be an https drive.google.com or docs.google.com URL."] });
      }
      patch.driveLink = link;
    }
    if (b.durationMinutes !== undefined) {
      const n = Number(b.durationMinutes);
      if (!Number.isInteger(n) || n < 1 || n > 180) {
        return res.status(400).json({ ok: false, errors: ["Duration must be an integer from 1 to 180 minutes."] });
      }
      patch.durationMinutes = n;
    }
    if (b.gateOpen !== undefined) patch.gateOpen = !!b.gateOpen;
    if (b.defaultVenue !== undefined) patch.defaultVenue = v.clean(b.defaultVenue, 120);
    const settings = await db.settings.update(patch);
    res.json({ ok: true, settings });
  } catch (e) {
    next(e);
  }
});

router.get("/api/admin/live", requireAdmin, async (req, res, next) => {
  try {
    const now = clock.now();
    const settings = await db.settings.get();
    const regs = (await db.registrations.list()).filter((r) => r.status === "accepted");
    const atts = await db.attempts.list();
    const byId = new Map(atts.map((a) => [a.registrationId, a]));
    const rows = regs.map((r) => liveRow(r, byId.get(r.id), settings, now));
    res.json({ ok: true, serverNow: now, rows });
  } catch (e) {
    next(e);
  }
});

router.get("/api/admin/live/export.csv", requireAdmin, async (req, res, next) => {
  try {
    const now = clock.now();
    const settings = await db.settings.get();
    const regs = (await db.registrations.list()).filter((r) => r.status === "accepted");
    const atts = await db.attempts.list();
    const byId = new Map(atts.map((a) => [a.registrationId, a]));
    const head = [
      "ID", "Team", "Members", "Reg numbers", "Venue", "State", "Started", "Ends", "Submitted link", "Submitted at", "Minutes after start",
    ];
    const data = regs.map((r) => {
      const row = liveRow(r, byId.get(r.id), settings, now);
      return [
        row.id, row.teamName,
        (row.members || []).map((m) => m.name).join(" & "),
        (row.memberIds || []).join(" | "),
        row.venue, row.state,
        row.startedAt ? formatKarachi(row.startedAt) : "",
        row.endsAt ? formatKarachi(row.endsAt) : "",
        row.submittedLink, row.submittedAt ? formatKarachi(row.submittedAt) : "",
        row.submittedMinutesAfterStart ?? "",
      ];
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=vspark-live.csv");
    res.send(v.toCsv(head, data));
  } catch (e) {
    next(e);
  }
});

router.post("/api/admin/attempts/:id/reset", requireAdmin, async (req, res, next) => {
  try {
    const row = await db.registrations.getById(req.params.id);
    if (!row) return res.status(404).json({ ok: false, errors: ["Not found."] });
    await db.attempts.remove(row.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/api/admin/attempts/:id/extend", requireAdmin, async (req, res, next) => {
  try {
    const minutes = Number(req.body?.minutes);
    if (!Number.isFinite(minutes) || minutes === 0 || Math.abs(minutes) > 180) {
      return res.status(400).json({ ok: false, errors: ["Enter a minute amount between -180 and 180, not zero."] });
    }
    const attempt = await db.attempts.getByRegId(req.params.id);
    if (!attempt) return res.status(400).json({ ok: false, errors: ["This team has not started yet."] });
    const endsAt = attempt.endsAt + minutes * 60 * 1000;
    await db.attempts.update(attempt.registrationId, { endsAt });
    res.json({ ok: true, endsAt });
  } catch (e) {
    next(e);
  }
});

router.get("/api/admin/judging", requireAdmin, async (req, res, next) => {
  try {
    const now = clock.now();
    const settings = await db.settings.get();
    const regs = (await db.registrations.list()).filter((r) => r.status === "accepted");
    const atts = await db.attempts.list();
    const byAtt = new Map(atts.map((a) => [a.registrationId, a]));
    const reviewList = await db.reviews.list();
    const byRev = new Map(reviewList.map((r) => [r.registrationId, r]));
    const resultsDoc = await db.results.get();
    const submitted = [];
    const notSubmitted = [];
    for (const r of regs) {
      const a = byAtt.get(r.id);
      const item = {
        ...liveRow(r, a, settings, now),
        notes: byRev.get(r.id)?.notes || "",
        reviewed: !!byRev.get(r.id)?.reviewed,
        position: resultsSvc.slotOf(resultsDoc, r.id),
      };
      if (a && a.submission && a.submission.driveLink) submitted.push(item);
      else notSubmitted.push(item);
    }
    const reviewedCount = submitted.filter((t) => t.reviewed).length;
    res.json({
      ok: true,
      results: resultsDoc,
      reviewedCount,
      submittedCount: submitted.length,
      submitted,
      notSubmitted,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/api/admin/results/position", requireAdmin, async (req, res, next) => {
  try {
    const registrationId = v.clean(req.body?.registrationId, 20);
    let position = req.body?.position;
    if (position === "none" || position === "" || position === undefined) position = null;
    else position = Number(position);
    const replace = !!req.body?.replace;
    const doc = await resultsSvc.assignPosition(registrationId, position, { replace });
    res.json({ ok: true, results: doc });
  } catch (err) {
    if (err.code === "POSITION_TAKEN") {
      return res.status(409).json({
        ok: false,
        code: "POSITION_TAKEN",
        errors: [`${err.slot === "first" ? "1st" : err.slot === "second" ? "2nd" : "3rd"} is currently held by ${err.holder.teamName}. Replace?`],
        holder: err.holder,
      });
    }
    if (err.status) return res.status(err.status).json({ ok: false, errors: [err.message] });
    next(err);
  }
});

router.post("/api/admin/reviews", requireAdmin, async (req, res, next) => {
  try {
    const registrationId = v.clean(req.body?.registrationId, 20);
    const row = await db.registrations.getById(registrationId);
    if (!row) return res.status(404).json({ ok: false, errors: ["Not found."] });
    const notes = v.clean(req.body?.notes, 500);
    const reviewed = !!req.body?.reviewed;
    const rec = await db.reviews.upsert(registrationId, { notes, reviewed });
    res.json({ ok: true, review: rec });
  } catch (e) {
    next(e);
  }
});

router.post("/api/admin/results/publish", requireAdmin, async (req, res, next) => {
  try {
    const doc = await resultsSvc.publish();
    res.json({ ok: true, results: doc });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, errors: [err.message] });
    next(err);
  }
});

router.post("/api/admin/results/unpublish", requireAdmin, async (req, res, next) => {
  try {
    const doc = await resultsSvc.unpublish();
    res.json({ ok: true, results: doc });
  } catch (e) {
    next(e);
  }
});

router.get("/api/admin/results/export.csv", requireAdmin, async (req, res, next) => {
  try {
    const judging = await (async () => {
      const now = clock.now();
      const settings = await db.settings.get();
      const regs = (await db.registrations.list()).filter((r) => r.status === "accepted");
      const atts = await db.attempts.list();
      const byAtt = new Map(atts.map((a) => [a.registrationId, a]));
      const reviewList = await db.reviews.list();
      const byRev = new Map(reviewList.map((r) => [r.registrationId, r]));
      const resultsDoc = await db.results.get();
      return { regs, byAtt, byRev, resultsDoc, settings, now };
    })();
    const head = ["Position", "ID", "Team", "Members", "Reg numbers", "Link", "Submitted at", "Notes"];
    const order = { first: 1, second: 2, third: 3 };
    const rows = judging.regs.map((r) => {
      const a = judging.byAtt.get(r.id);
      const pos = resultsSvc.slotOf(judging.resultsDoc, r.id);
      return [
        pos ? resultsSvc.LABELS[pos] : "",
        r.id,
        r.teamName,
        (r.members || []).map((m) => m.name).join(" & "),
        (r.memberIds || []).join(" | "),
        a?.submission?.driveLink || "",
        a?.submission?.submittedAt ? formatKarachi(a.submission.submittedAt) : "",
        judging.byRev.get(r.id)?.notes || "",
      ];
    });
    rows.sort((a, b) => {
      const pa = a[0] === "1st" ? 1 : a[0] === "2nd" ? 2 : a[0] === "3rd" ? 3 : 9;
      const pb = b[0] === "1st" ? 1 : b[0] === "2nd" ? 2 : b[0] === "3rd" ? 3 : 9;
      return pa - pb;
    });
    void order;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=vspark-results.csv");
    res.send(v.toCsv(head, rows));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
