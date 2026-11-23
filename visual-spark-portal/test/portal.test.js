const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vspark-"));
process.env.DATA_DIR = dir;
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASSWORD = "test-pass";
process.env.TOKEN_SECRET = "test-secret-xyz";
process.env.COMPETITION_MINUTES = "20";
process.env.NODE_ENV = "test";
delete process.env.MONGODB_URI;

const tokens = require("../services/tokens");
const db = require("../db");
const clock = require("../services/clock");
const app = require("../server");

let server;
let base;
let n = 0;

function png() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
}

async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let body = opts.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetch(base + url, { ...opts, headers, body });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { res, data };
}

async function registerTeam(suffix) {
  n += 1;
  const a = `FA23-BSE-${String(100 + n).padStart(3, "0")}`;
  const b = suffix === "solo" ? null : `FA23-BCS-${String(100 + n).padStart(3, "0")}`;
  const fd = new FormData();
  fd.set("teamName", "Team " + suffix + n);
  fd.set("email", `t${n}@example.com`);
  fd.set("phone", "03001234567");
  fd.set("member1Name", "Ali Khan");
  fd.set("member1RegNo", a);
  fd.set("member1Program", "BSE");
  if (b) {
    fd.set("member2Name", "Sara Ali");
    fd.set("member2RegNo", b);
    fd.set("member2Program", "BCS");
  }
  fd.set("paymentMethod", "JazzCash");
  fd.set("transactionId", "TXN" + Date.now() + n);
  fd.set("acceptedRules", "true");
  fd.set("receipt", new Blob([png()], { type: "image/png" }), "receipt.png");
  const { res, data } = await api("/api/register", { method: "POST", body: fd });
  return { res, data, regNo: a };
}

let adminToken;

async function adminLogin() {
  const { data } = await api("/api/admin/login", {
    method: "POST",
    body: { username: "admin", password: "test-pass" },
  });
  adminToken = data.token;
  return adminToken;
}

function adminHeaders() {
  return { Authorization: "Bearer " + adminToken, "x-admin-token": adminToken };
}

async function accept(id) {
  return api("/api/admin/registrations/" + id, {
    method: "PATCH",
    headers: adminHeaders(),
    body: { status: "accepted" },
  });
}

async function portalLogin(id, regNo) {
  const { data } = await api("/api/portal/login", { method: "POST", body: { id, regNo } });
  return data.token;
}

function portalHeaders(token) {
  return { Authorization: "Bearer " + token, "x-portal-token": token };
}

describe("vspark portal", () => {
  before(async () => {
    await db.init();
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    base = "http://127.0.0.1:" + server.address().port;
    await adminLogin();
  });

  after(async () => {
    clock.resetNow();
    await new Promise((r) => server.close(r));
  });

  it("rejects duplicate registration numbers", async () => {
    const first = await registerTeam("dup");
    assert.equal(first.res.status, 201);
    const fd = new FormData();
    fd.set("teamName", "Copy");
    fd.set("email", "copy@example.com");
    fd.set("phone", "03001234567");
    fd.set("member1Name", "Copy Cat");
    fd.set("member1RegNo", first.regNo);
    fd.set("member1Program", "BSE");
    fd.set("paymentMethod", "JazzCash");
    fd.set("transactionId", "TXN-COPY-999999");
    fd.set("acceptedRules", "true");
    fd.set("receipt", new Blob([png()]), "r.png");
    const second = await api("/api/register", { method: "POST", body: fd });
    assert.equal(second.res.status, 409);
  });

  it("rejects receipts that fail magic-byte or size checks", async () => {
    const bad = new FormData();
    bad.set("teamName", "Bad file");
    bad.set("email", "bad@example.com");
    bad.set("phone", "03001234567");
    bad.set("member1Name", "Bad File");
    bad.set("member1RegNo", "FA23-BSE-900");
    bad.set("member1Program", "BSE");
    bad.set("paymentMethod", "JazzCash");
    bad.set("transactionId", "TXN-BAD-111111");
    bad.set("acceptedRules", "true");
    bad.set("receipt", new Blob([Buffer.from("hello")]), "r.png");
    const r1 = await api("/api/register", { method: "POST", body: bad });
    assert.equal(r1.res.status, 400);

    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]);
    const big = new FormData();
    big.set("teamName", "Huge");
    big.set("email", "huge@example.com");
    big.set("phone", "03001234567");
    big.set("member1Name", "Huge File");
    big.set("member1RegNo", "FA23-BSE-901");
    big.set("member1Program", "BSE");
    big.set("paymentMethod", "JazzCash");
    big.set("transactionId", "TXN-HUGE-111111");
    big.set("acceptedRules", "true");
    big.set("receipt", new Blob([huge]), "r.jpg");
    const r2 = await api("/api/register", { method: "POST", body: big });
    assert.equal(r2.res.status, 400);
  });

  it("accept / reject flow stores status and reason", async () => {
    const t = await registerTeam("st");
    const acc = await accept(t.data.id);
    assert.equal(acc.data.row.status, "accepted");
    const rejTeam = await registerTeam("rj");
    const rej = await api("/api/admin/registrations/" + rejTeam.data.id, {
      method: "PATCH",
      headers: adminHeaders(),
      body: { status: "rejected", rejectReason: "Unreadable receipt" },
    });
    assert.equal(rej.data.row.status, "rejected");
    assert.equal(rej.data.row.rejectReason, "Unreadable receipt");
    const tok = await portalLogin(rejTeam.data.id, rejTeam.regNo);
    const me = await api("/api/portal/me", { headers: portalHeaders(tok) });
    assert.equal(me.data.status, "rejected");
    assert.equal(me.data.rejectReason, "Unreadable receipt");
    assert.equal(me.data.driveLink, "");
  });

  it("start is idempotent and two teams get different deadlines", async () => {
    await api("/api/admin/settings", {
      method: "PUT",
      headers: adminHeaders(),
      body: { gateOpen: true, durationMinutes: 20, driveLink: "https://drive.google.com/drive/folders/test", defaultVenue: "CS Lab 2" },
    });
    const a = await registerTeam("ta");
    const b = await registerTeam("tb");
    await accept(a.data.id);
    await accept(b.data.id);
    const ta = await portalLogin(a.data.id, a.regNo);
    const tb = await portalLogin(b.data.id, b.regNo);
    const s1 = await api("/api/portal/start", { method: "POST", headers: portalHeaders(ta), body: {} });
    const s1b = await api("/api/portal/start", { method: "POST", headers: portalHeaders(ta), body: {} });
    assert.equal(s1.data.attempt.startedAt, s1b.data.attempt.startedAt);
    assert.equal(s1.data.attempt.endsAt, s1b.data.attempt.endsAt);
    await new Promise((r) => setTimeout(r, 40));
    const s2 = await api("/api/portal/start", { method: "POST", headers: portalHeaders(tb), body: {} });
    assert.ok(s2.data.attempt.startedAt >= s1.data.attempt.startedAt);
    assert.ok(s2.data.attempt.endsAt !== s1.data.attempt.endsAt || s2.data.attempt.startedAt !== s1.data.attempt.startedAt);
  });

  it("submit rejected before start and after that team's endsAt; drive link hidden after end", async () => {
    await api("/api/admin/settings", {
      method: "PUT",
      headers: adminHeaders(),
      body: { gateOpen: true, durationMinutes: 20, driveLink: "https://drive.google.com/drive/folders/test" },
    });
    const t = await registerTeam("time");
    await accept(t.data.id);
    const tok = await portalLogin(t.data.id, t.regNo);
    const before = await api("/api/portal/submit", {
      method: "POST",
      headers: portalHeaders(tok),
      body: { driveLink: "https://drive.google.com/file/d/abc" },
    });
    assert.equal(before.res.status, 403);
    const dl0 = await api("/api/portal/drive-link", { headers: portalHeaders(tok) });
    assert.equal(dl0.res.status, 403);

    await api("/api/portal/start", { method: "POST", headers: portalHeaders(tok), body: {} });
    const ok = await api("/api/portal/submit", {
      method: "POST",
      headers: portalHeaders(tok),
      body: { driveLink: "https://drive.google.com/file/d/abc" },
    });
    assert.equal(ok.res.ok, true);
    assert.ok(ok.data.driveLink.includes("drive.google.com"));

    await db.attempts.update(t.data.id, { endsAt: Date.now() - 1000 });
    const late = await api("/api/portal/submit", {
      method: "POST",
      headers: portalHeaders(tok),
      body: { driveLink: "https://drive.google.com/file/d/zzz" },
    });
    assert.equal(late.res.status, 403);
    const me = await api("/api/portal/me", { headers: portalHeaders(tok) });
    assert.equal(me.data.driveLink, "");
    const dl = await api("/api/portal/drive-link", { headers: portalHeaders(tok) });
    assert.equal(dl.res.status, 403);
  });

  it("closed gate blocks new starts but not a running team", async () => {
    await api("/api/admin/settings", {
      method: "PUT",
      headers: adminHeaders(),
      body: { gateOpen: true, durationMinutes: 20, driveLink: "https://drive.google.com/drive/folders/test" },
    });
    const running = await registerTeam("run");
    const waiting = await registerTeam("wait");
    await accept(running.data.id);
    await accept(waiting.data.id);
    const tr = await portalLogin(running.data.id, running.regNo);
    await api("/api/portal/start", { method: "POST", headers: portalHeaders(tr), body: {} });
    await api("/api/admin/settings", {
      method: "PUT",
      headers: adminHeaders(),
      body: { gateOpen: false },
    });
    const tw = await portalLogin(waiting.data.id, waiting.regNo);
    const blocked = await api("/api/portal/start", { method: "POST", headers: portalHeaders(tw), body: {} });
    assert.equal(blocked.res.status, 403);
    const still = await api("/api/portal/submit", {
      method: "POST",
      headers: portalHeaders(tr),
      body: { driveLink: "https://docs.google.com/document/d/run" },
    });
    assert.equal(still.res.ok, true);
  });

  it("lets either member log in and hides the organizer link before start", async () => {
    const t = await registerTeam("members");
    await accept(t.data.id);
    const row = await db.registrations.getById(t.data.id);
    assert.equal(row.members.length, 2);
    const tok = await portalLogin(t.data.id, row.members[1].regNo);
    assert.ok(tok);
    const dl = await api("/api/portal/drive-link", { headers: portalHeaders(tok) });
    assert.equal(dl.res.status, 403);
    const me = await api("/api/portal/me", { headers: portalHeaders(tok) });
    assert.equal(me.data.driveLink, "");
    assert.equal(me.data.status, "accepted");
  });

  it("serves receipts only to admins and never caches them", async () => {
    const list = await api("/api/admin/registrations", { headers: adminHeaders() });
    const row = list.data.rows.find((r) => r.hasReceipt);
    assert.ok(row);
    const anon = await fetch(`${base}/api/admin/receipts/${row.id}`);
    assert.equal(anon.status, 401);
    const ok = await fetch(`${base}/api/admin/receipts/${row.id}`, { headers: adminHeaders() });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const body = Buffer.from(await ok.arrayBuffer());
    assert.equal(body[0], 0x89);
  });

  it("rejects expired tokens", () => {
    const dead = tokens.sign({ role: "admin", sub: "admin" }, { kind: "admin", ttlMs: -1000 });
    assert.equal(tokens.verify(dead, "admin"), null);
    const live = tokens.sign({ role: "admin", sub: "admin" }, { kind: "admin", ttlMs: 60000 });
    assert.ok(tokens.verify(live, "admin"));
    assert.equal(tokens.verify(live, "participant"), null);
  });

  it("enforces ranking and publish rules; hides winners and notes until published", async () => {
    await api("/api/admin/settings", {
      method: "PUT",
      headers: adminHeaders(),
      body: { gateOpen: true, durationMinutes: 20, driveLink: "https://drive.google.com/drive/folders/test" },
    });
    const teams = [];
    for (const name of ["w1", "w2", "w3", "w4"]) {
      const t = await registerTeam(name);
      await accept(t.data.id);
      const tok = await portalLogin(t.data.id, t.regNo);
      await api("/api/portal/start", { method: "POST", headers: portalHeaders(tok), body: {} });
      if (name !== "w4") {
        await api("/api/portal/submit", {
          method: "POST",
          headers: portalHeaders(tok),
          body: { driveLink: "https://drive.google.com/file/d/" + name },
        });
      }
      teams.push({ ...t, tok });
    }
    const nosub = await api("/api/admin/results/position", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[3].data.id, position: 1 },
    });
    assert.equal(nosub.res.status, 400);

    const p1 = await api("/api/admin/results/position", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[0].data.id, position: 1 },
    });
    assert.equal(p1.res.ok, true);
    const clash = await api("/api/admin/results/position", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[1].data.id, position: 1 },
    });
    assert.equal(clash.res.status, 409);
    const replaced = await api("/api/admin/results/position", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[1].data.id, position: 1, replace: true },
    });
    assert.equal(replaced.data.results.first, teams[1].data.id);

    await api("/api/admin/results/position", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[1].data.id, position: 2 },
    });
    assert.equal((await db.results.get()).first, null);
    assert.equal((await db.results.get()).second, teams[1].data.id);

    await api("/api/admin/reviews", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[1].data.id, reviewed: true, notes: "SECRET_JUDGE_NOTE" },
    });

    const pub0 = await api("/api/admin/results/publish", { method: "POST", headers: adminHeaders(), body: {} });
    assert.equal(pub0.res.status, 400);

    await api("/api/admin/results/position", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[0].data.id, position: 1 },
    });
    await api("/api/admin/results/position", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[2].data.id, position: 3 },
    });

    const publicBefore = await api("/api/winners");
    assert.equal(publicBefore.data.published, false);
    assert.equal(publicBefore.data.first, undefined);

    const meBefore = await api("/api/portal/me", { headers: portalHeaders(teams[1].tok) });
    assert.ok(!JSON.stringify(meBefore.data).includes("SECRET_JUDGE_NOTE"));
    assert.equal(meBefore.data.result, null);

    const pub = await api("/api/admin/results/publish", { method: "POST", headers: adminHeaders(), body: {} });
    assert.equal(pub.res.ok, true);
    const winners = await api("/api/winners");
    assert.equal(winners.data.published, true);
    assert.equal(winners.data.first.teamName.startsWith("Team w"), true);
    assert.ok(winners.data.first.members);
    assert.ok(!JSON.stringify(winners.data).includes("@example.com"));
    assert.ok(!JSON.stringify(winners.data).includes("FA23"));
    assert.ok(!JSON.stringify(winners.data).includes("SECRET_JUDGE_NOTE"));
    assert.ok(!JSON.stringify(winners.data).includes("drive.google.com"));

    const meWin = await api("/api/portal/me", { headers: portalHeaders(teams[1].tok) });
    assert.equal(meWin.data.result.label, "2nd");
    assert.ok(!JSON.stringify(meWin.data).includes("SECRET_JUDGE_NOTE"));

    const editAfterPublish = await api("/api/admin/results/position", {
      method: "POST",
      headers: adminHeaders(),
      body: { registrationId: teams[0].data.id, position: 3, replace: true },
    });
    assert.equal(editAfterPublish.res.status, 400);

    await api("/api/admin/results/unpublish", { method: "POST", headers: adminHeaders(), body: {} });
    const hidden = await api("/api/winners");
    assert.equal(hidden.data.published, false);
    assert.equal(hidden.data.first, undefined);
  });

  it("clears a deleted team's podium slot and refuses an incomplete publish", async () => {
    const doc = await db.results.get();
    assert.ok(doc.first);
    const del = await api("/api/admin/registrations/" + doc.first, { method: "DELETE", headers: adminHeaders() });
    assert.equal(del.res.status, 200);
    assert.equal((await db.results.get()).first, null);
    const pub = await api("/api/admin/results/publish", { method: "POST", headers: adminHeaders(), body: {} });
    assert.equal(pub.res.status, 400);
  });
});
