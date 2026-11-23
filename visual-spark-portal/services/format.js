const { TIMEZONE } = require("../options");

function formatKarachi(ms, opts = {}) {
  if (!ms) return "";
  const d = new Date(ms);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    dateStyle: opts.dateStyle || "medium",
    timeStyle: opts.timeStyle || "medium",
    ...opts,
  }).format(d);
}

function formatTimeKarachi(ms) {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function minutesAfter(startMs, atMs) {
  if (!startMs || !atMs) return null;
  return Math.round((atMs - startMs) / 60000);
}

function publicMembers(members) {
  return (members || []).map((m) => ({ name: m.name }));
}

function safeMembers(members) {
  return (members || []).map((m) => ({
    name: m.name,
    regNo: m.regNo,
    program: m.program,
  }));
}

module.exports = { formatKarachi, formatTimeKarachi, minutesAfter, publicMembers, safeMembers };
