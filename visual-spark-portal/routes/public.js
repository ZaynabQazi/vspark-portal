const express = require("express");
const db = require("../db");
const { INSTITUTE, EVENT, PROGRAMS, PAYMENT_METHODS, RULES } = require("../options");
const resultsSvc = require("../services/results");

const router = express.Router();

router.get("/api/meta", (req, res) => {
  res.json({
    ok: true,
    institute: INSTITUTE,
    event: EVENT,
    programs: PROGRAMS,
    paymentMethods: PAYMENT_METHODS,
    rules: RULES,
  });
});

router.get("/api/stats", async (req, res, next) => {
  try {
    const rows = await db.registrations.list();
    res.json({ total: rows.length });
  } catch (e) {
    next(e);
  }
});

router.get("/api/winners", async (req, res, next) => {
  try {
    const doc = await db.results.get();
    if (!doc.published) return res.json({ ok: true, published: false });
    const regs = await db.registrations.list();
    const map = new Map(regs.map((r) => [r.id, r]));
    res.json({ ok: true, ...resultsSvc.publicPodium(doc, map) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
