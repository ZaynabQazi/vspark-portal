const clock = require("./clock");
const db = require("../db");
const { isGoogleDriveUrl } = require("./validate");

function venueFor(reg, settings) {
  const override = (reg.venue || "").trim();
  if (override) return override;
  return (settings.defaultVenue || "").trim();
}

function publicAttempt(attempt, now) {
  if (!attempt) return null;
  return {
    startedAt: attempt.startedAt,
    endsAt: attempt.endsAt,
    durationMinutes: attempt.durationMinutes,
    remainingMs: Math.max(0, attempt.endsAt - now),
    state: db.attemptState(attempt, now),
    submission: attempt.submission
      ? {
          driveLink: attempt.submission.driveLink,
          submittedAt: attempt.submission.submittedAt,
          updatedAt: attempt.submission.updatedAt,
        }
      : null,
  };
}

async function startAttempt(reg) {
  const now = clock.now();
  const existing = await db.attempts.getByRegId(reg.id);
  if (existing) return existing;
  const settings = await db.settings.get();
  if (!settings.gateOpen) {
    const e = new Error("GATE_CLOSED");
    e.code = "GATE_CLOSED";
    throw e;
  }
  const durationMinutes = Number(settings.durationMinutes) || 20;
  const doc = {
    registrationId: reg.id,
    startedAt: now,
    endsAt: now + durationMinutes * 60 * 1000,
    durationMinutes,
    submission: null,
  };
  return db.attempts.insert(doc);
}

function assertCanSubmit(reg, attempt, now = clock.now()) {
  if (!reg || reg.status !== "accepted") {
    const e = new Error("Not accepted.");
    e.status = 403;
    e.code = "NOT_ACCEPTED";
    throw e;
  }
  if (!attempt) {
    const e = new Error("Your timer has not started.");
    e.status = 403;
    e.code = "NOT_STARTED";
    throw e;
  }
  if (now >= attempt.endsAt) {
    const e = new Error("Time is over. Submissions are closed.");
    e.status = 403;
    e.code = "TIME_OVER";
    throw e;
  }
}

function assertDriveVisible(reg, attempt, now = clock.now()) {
  assertCanSubmit(reg, attempt, now);
}

function validateStudentLink(url) {
  if (!isGoogleDriveUrl(url)) {
    const e = new Error("Enter an https Google Drive or Google Docs link.");
    e.status = 400;
    throw e;
  }
  return String(url).trim();
}

module.exports = {
  venueFor,
  publicAttempt,
  startAttempt,
  assertCanSubmit,
  assertDriveVisible,
  validateStudentLink,
};
