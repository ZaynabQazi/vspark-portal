const express = require("express");
const path = require("path");
const db = require("./db");
const { securityHeaders } = require("./middleware/security");

if (process.env.NODE_ENV === "production") {
  const missing = [];
  if (!process.env.ADMIN_USER) missing.push("ADMIN_USER");
  if (!process.env.ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");
  if (!process.env.TOKEN_SECRET) missing.push("TOKEN_SECRET");
  if (missing.length) {
    throw new Error("Missing required environment variables: " + missing.join(", "));
  }
}

const app = express();
// Vercel injects PORT; treat "0"/blank as "use the default" locally.
const PORT = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "200kb" }));

// API responses contain team, receipt or judging data: never cache them.
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Authorization");
  next();
});

app.use(async (req, res, next) => {
  try {
    await db.init();
    next();
  } catch (err) {
    next(err);
  }
});

app.use(require("./routes/public"));
app.use(require("./routes/register"));
app.use(require("./routes/portal"));
app.use(require("./routes/admin"));

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get(["/register", "/register/"], (req, res) => {
  res.sendFile(path.join(publicDir, "register.html"));
});
app.get(["/portal", "/portal/"], (req, res) => {
  res.sendFile(path.join(publicDir, "portal.html"));
});
app.get(["/admin", "/admin/"], (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, errors: ["Server error. Please try again."] });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  VSPARK portal`);
    console.log(`  Site:    http://localhost:${PORT}`);
    console.log(`  Register http://localhost:${PORT}/register`);
    console.log(`  Portal:  http://localhost:${PORT}/portal`);
    console.log(`  Admin:   http://localhost:${PORT}/admin`);
    console.log(`  Storage: ${db.useMongo() ? "MongoDB" : "local JSON (" + db.DATA_DIR + ")"}\n`);
  });
}

module.exports = app;
