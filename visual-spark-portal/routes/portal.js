const express = require("express");
const db = require("../db");
const clock = require("../services/clock");
const tokens = require("../services/tokens");
const { requirePortal } = require("../middleware/auth");
const { clientKey } = require("../middleware/security");
const v = require("../services/validate");
const competition = require("../services/competition");
const resultsSvc = require("../services/results");
const { INSTITUTE } = require("../options");

const router = express.Router();

router.post("/api/portal/login", async (req, res, next) => {
  try {
    const id = v.clean(req.body?.id, 20).toUpperCase();
    const regNo = v.normalizeRegNo(req.body?.regNo);
    const key = `portal:${clientKey(req)}:${id || "none"}`;
    const rl = await db.loginAttempts.hit(key);
    if (!rl.ok) {
      return res.status(429).json({ ok: false, errors: ["Too many login attempts. Try again in 15 minutes."] });
    }
    const row = await db.registrations.getById(id);
    const match = row && (row.memberIds || []).includes(regNo);
    if (!match) {
      return res.status(401).json({ ok: false, errors: ["Registration ID or registration number is incorrect."] });
    }
    const token = tokens.sign({ regId: row.id, role: "participant" }, { kind: "participant", ttlMs: tokens.PORTAL_TTL_MS });
    res.json({ ok: true, token, id: row.id });
  } catch (e) {
    next(e);
  }
});

async function portalPayload(reg) {
  const now = clock.now();
  const settings = await db.settings.get();
  const attempt = await db.attempts.getByRegId(reg.id);
  const running = db.isRunning(attempt, now);
  const resultsDoc = await db.results.get();
  const ownResult = resultsSvc.teamResult(resultsDoc, reg.id);

  const body = {
    ok: true,
    serverNow: now,
    status: reg.status,
    rejectReason: reg.status === "rejected" ? reg.rejectReason || "" : "",
    institute: INSTITUTE,
    registration: {
      id: reg.id,
      teamName: reg.teamName,
      members: (reg.members || []).map((m) => ({
        name: m.name,
        regNo: m.regNo,
        program: m.program,
        programLabel: m.programLabel || m.program,
      })),
    },
    venue: reg.status === "accepted" ? competition.venueFor(reg, settings) : "",
    gateOpen: !!settings.gateOpen,
    durationMinutes: settings.durationMinutes,
    attempt: competition.publicAttempt(attempt, now),
    driveLink: running ? settings.driveLink || "" : "",
    result: ownResult,
  };
  return body;
}

router.get("/api/portal/drive-link", requirePortal, async (req, res, next) => {
  try {
    const now = clock.now();
    const reg = await db.registrations.getById(req.portal.regId);
    const attempt = reg ? await db.attempts.getByRegId(reg.id) : null;
    try {
      competition.assertDriveVisible(reg, attempt, now);
    } catch (err) {
      return res.status(err.status || 403).json({ ok: false, errors: [err.message] });
    }
    const settings = await db.settings.get();
    res.json({ ok: true, driveLink: settings.driveLink || "" });
  } catch (e) {
    next(e);
  }
});

router.get("/api/portal/me", requirePortal, async (req, res, next) => {
  try {
    const reg = await db.registrations.getById(req.portal.regId);
    if (!reg) return res.status(401).json({ ok: false, errors: ["Session is no longer valid."] });
    res.json(await portalPayload(reg));
  } catch (e) {
    next(e);
  }
});

router.post("/api/portal/start", requirePortal, async (req, res, next) => {
  try {
    const reg = await db.registrations.getById(req.portal.regId);
    if (!reg || reg.status !== "accepted") {
      return res.status(403).json({ ok: false, errors: ["Only accepted teams can start."] });
    }
    try {
      await competition.startAttempt(reg);
    } catch (err) {
      if (err.code === "GATE_CLOSED") {
        return res.status(403).json({ ok: false, errors: ["The competition gate is closed. Wait for the organizers."] });
      }
      throw err;
    }
    res.json(await portalPayload(reg));
  } catch (e) {
    next(e);
  }
});

router.post("/api/portal/submit", requirePortal, async (req, res, next) => {
  try {
    const now = clock.now();
    const reg = await db.registrations.getById(req.portal.regId);
    const attempt = reg ? await db.attempts.getByRegId(reg.id) : null;
    try {
      competition.assertCanSubmit(reg, attempt, now);
    } catch (err) {
      return res.status(err.status || 403).json({ ok: false, errors: [err.message] });
    }
    let link;
    try {
      link = competition.validateStudentLink(req.body?.driveLink);
    } catch (err) {
      return res.status(400).json({ ok: false, errors: [err.message] });
    }
    const prev = attempt.submission;
    const submission = {
      driveLink: link,
      submittedAt: prev?.submittedAt || now,
      updatedAt: now,
    };
    await db.attempts.update(reg.id, { submission });
    res.json(await portalPayload(reg));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
