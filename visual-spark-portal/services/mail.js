/**
 * Optional SMTP. Missing config or send failures never throw to callers.
 */
const { EVENT, INSTITUTE } = require("../options");

function configured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);
}

async function send(to, subject, text) {
  if (!configured() || !to) return { skipped: true };
  try {
    const nodemailer = require("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
    });
    return { ok: true };
  } catch (err) {
    console.error("Email send failed:", err.message);
    return { ok: false };
  }
}

function notifyStatus(reg, { status, venue, reason }) {
  const name = reg.teamName || "team";
  if (status === "accepted") {
    return send(
      reg.email,
      `${EVENT.title}: registration accepted`,
      `Hello ${name},\n\nYour registration ${reg.id} has been accepted for the ${EVENT.subtitle}.\n` +
        `Institute: ${INSTITUTE}\nVenue: ${venue || "will be announced"}\n\n` +
        `Log in at the Participant Portal with your Registration ID and a team member's registration number.\n\n` +
        `— ${EVENT.title}`
    );
  }
  if (status === "rejected") {
    return send(
      reg.email,
      `${EVENT.title}: registration update`,
      `Hello ${name},\n\nYour registration ${reg.id} was not accepted.\n` +
        (reason ? `Reason: ${reason}\n\n` : "\n") +
        `Please contact the organizers if you have questions.\n\n— ${EVENT.title}`
    );
  }
  return Promise.resolve({ skipped: true });
}

module.exports = { configured, send, notifyStatus };
