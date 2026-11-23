function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "0");
  next();
}

function clientKey(req) {
  return (req.get("x-forwarded-for") || req.ip || "local").split(",")[0].trim();
}

module.exports = { securityHeaders, clientKey };
