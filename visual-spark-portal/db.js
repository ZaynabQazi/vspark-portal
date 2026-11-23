/**
 * Storage: MongoDB when MONGODB_URI is set, otherwise local JSON + receipt files.
 * Never writes to disk in Mongo mode (Vercel).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ID_PREFIX, EVENT, programLabel } = require("./options");
const clock = require("./services/clock");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const RECEIPT_DIR = path.join(DATA_DIR, "receipts");

function useMongo() {
  return !!process.env.MONGODB_URI;
}

function defaultSettings() {
  const mins = Number(process.env.COMPETITION_MINUTES || EVENT.durationMinutesDefault);
  return {
    _id: "settings",
    driveLink: "",
    durationMinutes: Number.isFinite(mins) && mins > 0 ? mins : 20,
    gateOpen: false,
    defaultVenue: "",
    updatedAt: null,
  };
}

function defaultResults() {
  return {
    _id: "results",
    first: null,
    second: null,
    third: null,
    published: false,
    publishedAt: null,
    updatedAt: null,
  };
}

function normalizeStatus(r) {
  if (!r) return "pending";
  let status = r.status;
  if (status === "confirmed") status = "accepted";
  if (r.paymentVerified === true && status !== "rejected") status = "accepted";
  if (!["pending", "accepted", "rejected"].includes(status)) status = "pending";
  return status;
}

function normalizeMembers(r) {
  if (Array.isArray(r.members) && r.members.length) {
    return r.members.map((m) => ({
      name: m.name,
      regNo: String(m.regNo || "").toUpperCase(),
      program: m.program || "",
      programLabel: programLabel(m.program),
    }));
  }
  const out = [];
  if (r.member1) {
    out.push({
      name: r.member1.name,
      regNo: String(r.member1.regNo || "").toUpperCase(),
      program: r.member1.program || "",
      programLabel: programLabel(r.member1.program),
    });
  }
  if (r.member2) {
    out.push({
      name: r.member2.name,
      regNo: String(r.member2.regNo || "").toUpperCase(),
      program: r.member2.program || "",
      programLabel: programLabel(r.member2.program),
    });
  }
  return out;
}

function normalizeReg(r) {
  if (!r) return null;
  const members = normalizeMembers(r);
  const memberIds = r.memberIds || members.map((m) => m.regNo);
  return {
    ...r,
    status: normalizeStatus(r),
    members,
    memberIds,
    email: r.email || r.member1?.email || "",
    phone: r.phone || r.member1?.phone || "",
  };
}

function newReceiptId() {
  return "rcpt_" + clock.now().toString(36) + crypto.randomBytes(6).toString("hex");
}

// ---------- File helpers ----------
let fileQueue = Promise.resolve();
function lock(fn) {
  const run = () => fn();
  fileQueue = fileQueue.then(run, run);
  return fileQueue;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const files = {
  registrations: () => path.join(DATA_DIR, "registrations.json"),
  receipts: () => path.join(DATA_DIR, "receipts-meta.json"),
  settings: () => path.join(DATA_DIR, "settings.json"),
  attempts: () => path.join(DATA_DIR, "attempts.json"),
  loginAttempts: () => path.join(DATA_DIR, "login-attempts.json"),
  results: () => path.join(DATA_DIR, "results.json"),
  reviews: () => path.join(DATA_DIR, "reviews.json"),
  counter: () => path.join(DATA_DIR, "counter.json"),
};

function ensureFileMode() {
  if (useMongo()) return;
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  if (!fs.existsSync(files.registrations())) writeJson(files.registrations(), []);
  if (!fs.existsSync(files.receipts())) writeJson(files.receipts(), []);
  if (!fs.existsSync(files.attempts())) writeJson(files.attempts(), []);
  if (!fs.existsSync(files.loginAttempts())) writeJson(files.loginAttempts(), []);
  if (!fs.existsSync(files.reviews())) writeJson(files.reviews(), []);
  if (!fs.existsSync(files.settings())) writeJson(files.settings(), defaultSettings());
  if (!fs.existsSync(files.results())) writeJson(files.results(), defaultResults());
}

// ---------- Mongo ----------
async function mongo() {
  if (!useMongo()) return null;
  if (global._vsparkDb) return global._vsparkDb;
  const { MongoClient } = require("mongodb");
  if (!global._vsparkClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    global._vsparkClient = client;
    global._vsparkClientPromise = client.connect();
  }
  await global._vsparkClientPromise;
  const database = global._vsparkClient.db(process.env.MONGODB_DB || "vspark");
  if (!global._vsparkIndexes) {
    global._vsparkIndexes = ensureIndexes(database);
  }
  await global._vsparkIndexes;
  global._vsparkDb = database;
  return database;
}

async function ensureIndexes(database) {
  const regs = database.collection("registrations");
  await regs.createIndex({ id: 1 }, { unique: true });
  await regs.createIndex({ memberIds: 1 }, { unique: true });
  await regs.createIndex({ status: 1 });
  await database.collection("receipts").createIndex({ registrationId: 1 });
  await database.collection("attempts").createIndex({ registrationId: 1 }, { unique: true });
  await database.collection("loginAttempts").createIndex({ key: 1 }, { unique: true });
  await database.collection("reviews").createIndex({ registrationId: 1 }, { unique: true });
}

async function init() {
  if (useMongo()) {
    await mongo();
    return;
  }
  ensureFileMode();
}

async function nextId() {
  if (useMongo()) {
    const dbx = await mongo();
    const doc = await dbx.collection("counters").findOneAndUpdate(
      { _id: "registrations" },
      { $inc: { last: 1 } },
      { upsert: true, returnDocument: "after" }
    );
    const n = (doc && (doc.last || doc.value?.last)) || 1;
    return ID_PREFIX + String(n).padStart(4, "0");
  }
  return lock(() => {
    const rows = readJson(files.registrations(), []);
    const maxRow = rows.reduce((m, r) => {
      const n = parseInt(String(r.id).replace(/\D/g, ""), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    const saved = readJson(files.counter(), { last: 0 }).last || 0;
    const next = Math.max(maxRow, saved) + 1;
    writeJson(files.counter(), { last: next });
    return ID_PREFIX + String(next).padStart(4, "0");
  });
}

/** Clear any podium slot held by a deleted team so results never point at ghosts. */
async function clearResultsFor(registrationId) {
  const doc = await results.get();
  const patch = {};
  for (const slot of ["first", "second", "third"]) {
    if (doc[slot] === registrationId) patch[slot] = null;
  }
  if (Object.keys(patch).length) await results.update(patch);
}

const registrations = {
  async list() {
    if (useMongo()) {
      const dbx = await mongo();
      const rows = await dbx.collection("registrations").find({}).sort({ createdAt: -1 }).toArray();
      return rows.map(normalizeReg);
    }
    return readJson(files.registrations(), []).map(normalizeReg);
  },
  async getById(id) {
    if (useMongo()) {
      const dbx = await mongo();
      return normalizeReg(await dbx.collection("registrations").findOne({ id }));
    }
    return normalizeReg(readJson(files.registrations(), []).find((r) => r.id === id) || null);
  },
  async findByMemberId(regNo) {
    const id = String(regNo || "").toUpperCase();
    if (useMongo()) {
      const dbx = await mongo();
      return normalizeReg(await dbx.collection("registrations").findOne({ memberIds: id }));
    }
    return normalizeReg(
      readJson(files.registrations(), []).find((r) => (r.memberIds || []).includes(id) || normalizeMembers(r).some((m) => m.regNo === id)) || null
    );
  },
  async insert(doc) {
    const row = normalizeReg(doc);
    if (useMongo()) {
      const dbx = await mongo();
      try {
        await dbx.collection("registrations").insertOne(row);
      } catch (err) {
        if (err && err.code === 11000) {
          const e = new Error("DUPLICATE_REG");
          e.code = "DUPLICATE_REG";
          throw e;
        }
        throw err;
      }
      return row;
    }
    return lock(() => {
      const rows = readJson(files.registrations(), []);
      const taken = new Set(rows.flatMap((r) => r.memberIds || normalizeMembers(r).map((m) => m.regNo)));
      if (row.memberIds.some((id) => taken.has(id))) {
        const e = new Error("DUPLICATE_REG");
        e.code = "DUPLICATE_REG";
        throw e;
      }
      rows.push(row);
      writeJson(files.registrations(), rows);
      return row;
    });
  },
  async update(id, patch) {
    if (useMongo()) {
      const dbx = await mongo();
      await dbx.collection("registrations").updateOne({ id }, { $set: patch });
      return registrations.getById(id);
    }
    return lock(() => {
      const rows = readJson(files.registrations(), []);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      rows[i] = { ...rows[i], ...patch };
      writeJson(files.registrations(), rows);
      return normalizeReg(rows[i]);
    });
  },
  async remove(id) {
    if (useMongo()) {
      const dbx = await mongo();
      const r = await dbx.collection("registrations").findOne({ id });
      if (!r) return false;
      await dbx.collection("registrations").deleteOne({ id });
      await dbx.collection("receipts").deleteMany({ registrationId: id });
      await dbx.collection("attempts").deleteMany({ registrationId: id });
      await dbx.collection("reviews").deleteMany({ registrationId: id });
      await clearResultsFor(id);
      return true;
    }
    return lock(async () => {
      const rows = readJson(files.registrations(), []);
      const row = rows.find((r) => r.id === id);
      if (!row) return false;
      writeJson(
        files.registrations(),
        rows.filter((r) => r.id !== id)
      );
      const meta = readJson(files.receipts(), []).filter((x) => x.registrationId !== id);
      writeJson(files.receipts(), meta);
      if (row.receiptId) {
        const p = path.join(RECEIPT_DIR, row.receiptId);
        try {
          fs.unlinkSync(p);
        } catch {}
      }
      writeJson(
        files.attempts(),
        readJson(files.attempts(), []).filter((a) => a.registrationId !== id)
      );
      writeJson(
        files.reviews(),
        readJson(files.reviews(), []).filter((a) => a.registrationId !== id)
      );
      await clearResultsFor(id);
      return true;
    });
  },
};

const receipts = {
  async save({ registrationId, filename, contentType, buffer }) {
    const id = newReceiptId();
    const rec = {
      _id: id,
      registrationId,
      filename,
      contentType,
      size: buffer.length,
      uploadedAt: clock.now(),
    };
    if (useMongo()) {
      const dbx = await mongo();
      const { Binary } = require("mongodb");
      await dbx.collection("receipts").insertOne({ ...rec, data: new Binary(buffer) });
      return rec;
    }
    return lock(() => {
      fs.mkdirSync(RECEIPT_DIR, { recursive: true });
      fs.writeFileSync(path.join(RECEIPT_DIR, id), buffer);
      const rows = readJson(files.receipts(), []);
      rows.push(rec);
      writeJson(files.receipts(), rows);
      return rec;
    });
  },
  async get(id) {
    if (!id) return null;
    if (useMongo()) {
      const dbx = await mongo();
      const doc = await dbx.collection("receipts").findOne({ _id: id });
      if (!doc) return null;
      const data = Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data.buffer);
      return { ...doc, data };
    }
    const meta = readJson(files.receipts(), []).find((r) => r._id === id);
    if (!meta) return null;
    try {
      const data = fs.readFileSync(path.join(RECEIPT_DIR, id));
      return { ...meta, data };
    } catch {
      return null;
    }
  },
};

const settings = {
  async get() {
    if (useMongo()) {
      const dbx = await mongo();
      const doc = await dbx.collection("settings").findOne({ _id: "settings" });
      return { ...defaultSettings(), ...(doc || {}) };
    }
    return { ...defaultSettings(), ...readJson(files.settings(), {}) };
  },
  async update(patch) {
    const next = { ...(await settings.get()), ...patch, updatedAt: clock.now() };
    if (useMongo()) {
      const dbx = await mongo();
      await dbx.collection("settings").updateOne({ _id: "settings" }, { $set: next }, { upsert: true });
      return next;
    }
    writeJson(files.settings(), next);
    return next;
  },
};

const attempts = {
  async list() {
    if (useMongo()) {
      const dbx = await mongo();
      return dbx.collection("attempts").find({}).toArray();
    }
    return readJson(files.attempts(), []);
  },
  async getByRegId(registrationId) {
    if (useMongo()) {
      const dbx = await mongo();
      return dbx.collection("attempts").findOne({ registrationId });
    }
    return readJson(files.attempts(), []).find((a) => a.registrationId === registrationId) || null;
  },
  async insert(doc) {
    if (useMongo()) {
      const dbx = await mongo();
      try {
        await dbx.collection("attempts").insertOne(doc);
        return doc;
      } catch (err) {
        if (err && err.code === 11000) return attempts.getByRegId(doc.registrationId);
        throw err;
      }
    }
    return lock(() => {
      const rows = readJson(files.attempts(), []);
      const existing = rows.find((a) => a.registrationId === doc.registrationId);
      if (existing) return existing;
      rows.push(doc);
      writeJson(files.attempts(), rows);
      return doc;
    });
  },
  async update(registrationId, patch) {
    if (useMongo()) {
      const dbx = await mongo();
      await dbx.collection("attempts").updateOne({ registrationId }, { $set: patch });
      return attempts.getByRegId(registrationId);
    }
    return lock(() => {
      const rows = readJson(files.attempts(), []);
      const i = rows.findIndex((a) => a.registrationId === registrationId);
      if (i < 0) return null;
      rows[i] = { ...rows[i], ...patch };
      writeJson(files.attempts(), rows);
      return rows[i];
    });
  },
  async remove(registrationId) {
    if (useMongo()) {
      const dbx = await mongo();
      await dbx.collection("attempts").deleteOne({ registrationId });
      return;
    }
    return lock(() => {
      writeJson(
        files.attempts(),
        readJson(files.attempts(), []).filter((a) => a.registrationId !== registrationId)
      );
    });
  },
};

const loginAttempts = {
  async hit(key, { limit = 8, windowMs = 15 * 60 * 1000 } = {}) {
    const now = clock.now();
    if (useMongo()) {
      const dbx = await mongo();
      const col = dbx.collection("loginAttempts");
      const rec = await col.findOne({ key });
      if (!rec || now - rec.windowStart > windowMs) {
        await col.updateOne({ key }, { $set: { key, count: 1, windowStart: now } }, { upsert: true });
        return { ok: true };
      }
      if (rec.count >= limit) return { ok: false };
      await col.updateOne({ key }, { $inc: { count: 1 } });
      return { ok: true };
    }
    return lock(() => {
      const rows = readJson(files.loginAttempts(), []);
      let rec = rows.find((r) => r.key === key);
      if (!rec || now - rec.windowStart > windowMs) {
        rec = { key, count: 1, windowStart: now };
        writeJson(files.loginAttempts(), rows.filter((r) => r.key !== key).concat(rec));
        return { ok: true };
      }
      if (rec.count >= limit) return { ok: false };
      rec.count += 1;
      writeJson(files.loginAttempts(), rows);
      return { ok: true };
    });
  },
};

const results = {
  async get() {
    if (useMongo()) {
      const dbx = await mongo();
      const doc = await dbx.collection("results").findOne({ _id: "results" });
      return { ...defaultResults(), ...(doc || {}) };
    }
    return { ...defaultResults(), ...readJson(files.results(), {}) };
  },
  async update(patch) {
    const next = { ...(await results.get()), ...patch, updatedAt: clock.now() };
    if (useMongo()) {
      const dbx = await mongo();
      await dbx.collection("results").updateOne({ _id: "results" }, { $set: next }, { upsert: true });
      return next;
    }
    writeJson(files.results(), next);
    return next;
  },
};

const reviews = {
  async list() {
    if (useMongo()) {
      const dbx = await mongo();
      return dbx.collection("reviews").find({}).toArray();
    }
    return readJson(files.reviews(), []);
  },
  async get(registrationId) {
    if (useMongo()) {
      const dbx = await mongo();
      return dbx.collection("reviews").findOne({ registrationId });
    }
    return readJson(files.reviews(), []).find((r) => r.registrationId === registrationId) || null;
  },
  async upsert(registrationId, patch) {
    const next = {
      registrationId,
      reviewed: false,
      notes: "",
      ...(await reviews.get(registrationId)),
      ...patch,
      updatedAt: clock.now(),
    };
    if (useMongo()) {
      const dbx = await mongo();
      await dbx.collection("reviews").updateOne({ registrationId }, { $set: next }, { upsert: true });
      return next;
    }
    return lock(() => {
      const rows = readJson(files.reviews(), []);
      const i = rows.findIndex((r) => r.registrationId === registrationId);
      if (i < 0) rows.push(next);
      else rows[i] = next;
      writeJson(files.reviews(), rows);
      return next;
    });
  },
};

function attemptState(attempt, now = clock.now()) {
  if (!attempt) return "not_started";
  const submitted = !!(attempt.submission && attempt.submission.driveLink);
  if (submitted) return "submitted";
  if (now >= attempt.endsAt) return "time_over";
  return "running";
}

function isRunning(attempt, now = clock.now()) {
  return !!(attempt && now < attempt.endsAt);
}

module.exports = {
  useMongo,
  init,
  nextId,
  registrations,
  receipts,
  settings,
  attempts,
  loginAttempts,
  results,
  reviews,
  normalizeReg,
  attemptState,
  isRunning,
  DATA_DIR,
};
