const db = require("../db");
const clock = require("./clock");

const SLOTS = ["first", "second", "third"];
const LABELS = { first: "1st", second: "2nd", third: "3rd" };

function slotOf(resultsDoc, registrationId) {
  for (const s of SLOTS) {
    if (resultsDoc[s] === registrationId) return s;
  }
  return null;
}

function holderOf(resultsDoc, slot) {
  return resultsDoc[slot] || null;
}

async function assignPosition(registrationId, position, { replace = false } = {}) {
  const slot = position === 1 ? "first" : position === 2 ? "second" : position === 3 ? "third" : null;
  const resultsDoc = await db.results.get();
  if (resultsDoc.published) {
    const e = new Error("Unpublish results before editing positions.");
    e.status = 400;
    throw e;
  }

  if (position === null || position === 0 || position === "none") {
    const patch = {};
    const current = slotOf(resultsDoc, registrationId);
    if (current) patch[current] = null;
    return db.results.update(patch);
  }

  if (!slot) {
    const e = new Error("Position must be 1, 2, 3 or none.");
    e.status = 400;
    throw e;
  }

  const reg = await db.registrations.getById(registrationId);
  if (!reg) {
    const e = new Error("Team not found.");
    e.status = 404;
    throw e;
  }
  const attempt = await db.attempts.getByRegId(registrationId);
  if (!attempt || !attempt.submission || !attempt.submission.driveLink) {
    const e = new Error("Only teams that submitted a Drive link can be ranked.");
    e.status = 400;
    e.code = "NO_SUBMISSION";
    throw e;
  }

  const existingHolder = holderOf(resultsDoc, slot);
  if (existingHolder && existingHolder !== registrationId && !replace) {
    const holder = await db.registrations.getById(existingHolder);
    const e = new Error("POSITION_TAKEN");
    e.status = 409;
    e.code = "POSITION_TAKEN";
    e.holder = { id: existingHolder, teamName: holder?.teamName || existingHolder };
    e.slot = slot;
    throw e;
  }

  const patch = {};
  // A team may hold only one position.
  const prev = slotOf(resultsDoc, registrationId);
  if (prev && prev !== slot) patch[prev] = null;
  patch[slot] = registrationId;
  return db.results.update(patch);
}

async function publish() {
  const doc = await db.results.get();
  const ids = [doc.first, doc.second, doc.third];
  if (ids.some((id) => !id)) {
    const e = new Error("Fill 1st, 2nd and 3rd before publishing.");
    e.status = 400;
    e.code = "INCOMPLETE";
    throw e;
  }
  if (new Set(ids).size !== 3) {
    const e = new Error("Each position must belong to a different team.");
    e.status = 400;
    e.code = "INCOMPLETE";
    throw e;
  }
  // A ranked team may have been deleted or never submitted: never publish a ghost podium.
  for (const id of ids) {
    const reg = await db.registrations.getById(id);
    const attempt = await db.attempts.getByRegId(id);
    if (!reg || !attempt || !attempt.submission || !attempt.submission.driveLink) {
      const e = new Error("Every position must be held by a team that submitted. Re-check the podium.");
      e.status = 400;
      e.code = "INCOMPLETE";
      throw e;
    }
  }
  return db.results.update({ published: true, publishedAt: clock.now() });
}

async function unpublish() {
  return db.results.update({ published: false });
}

function publicPodium(resultsDoc, regsById) {
  if (!resultsDoc.published) return { published: false };
  const pick = (slot) => {
    const id = resultsDoc[slot];
    const r = id && regsById.get(id);
    if (!r) return null;
    return {
      teamName: r.teamName,
      members: (r.members || []).map((m) => m.name),
    };
  };
  return {
    published: true,
    publishedAt: resultsDoc.publishedAt,
    first: pick("first"),
    second: pick("second"),
    third: pick("third"),
  };
}

function teamResult(resultsDoc, registrationId) {
  if (!resultsDoc.published) return null;
  const slot = slotOf(resultsDoc, registrationId);
  if (!slot) return { published: true, position: null };
  return { published: true, position: slot, label: LABELS[slot] };
}

module.exports = {
  SLOTS,
  LABELS,
  assignPosition,
  publish,
  unpublish,
  publicPodium,
  teamResult,
  slotOf,
};
