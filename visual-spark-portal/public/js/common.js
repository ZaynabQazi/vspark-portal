(() => {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function jsonFetch(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function karachiTime(ms) {
    if (!ms) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  }

  function karachiDateTime(ms) {
    if (!ms) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(ms));
  }

  function fmtRemain(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }

  window.VSP = { esc, jsonFetch, karachiTime, karachiDateTime, fmtRemain };
})();
