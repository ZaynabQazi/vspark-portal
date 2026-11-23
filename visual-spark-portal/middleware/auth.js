const tokens = require("../services/tokens");

function requireAdmin(req, res, next) {
  const payload = tokens.verify(tokens.bearer(req), "admin");
  if (!payload) return res.status(401).json({ ok: false, errors: ["Please sign in as an organizer."] });
  req.admin = payload;
  next();
}

function requirePortal(req, res, next) {
  const payload = tokens.verify(tokens.bearer(req), "participant");
  if (!payload || !payload.regId) {
    return res.status(401).json({ ok: false, errors: ["Please log in to the participant portal."] });
  }
  req.portal = payload;
  next();
}

module.exports = { requireAdmin, requirePortal };
