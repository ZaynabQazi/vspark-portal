(() => {
  const { esc, jsonFetch, karachiTime, fmtRemain } = window.VSP;
  const $ = (s) => document.querySelector(s);
  const store = {
    get() { try { return sessionStorage.getItem("vspark_portal") || ""; } catch { return ""; } },
    set(v) { try { v ? sessionStorage.setItem("vspark_portal", v) : sessionStorage.removeItem("vspark_portal"); } catch {} },
  };

  let TOKEN = "";
  let state = null;
  let offset = 0;
  let tickTimer = null;
  let syncTimer = null;

  function authHeaders() {
    return { Authorization: "Bearer " + TOKEN, "x-portal-token": TOKEN };
  }

  async function api(url, opts = {}) {
    const { res, data } = await jsonFetch(url, {
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) },
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body,
    });
    if (res.status === 401) {
      logout();
      throw new Error("Please log in again.");
    }
    return { res, data };
  }

  function nowApprox() {
    return Date.now() + offset;
  }

  function applySync(data) {
    state = data;
    if (typeof data.serverNow === "number") offset = data.serverNow - Date.now();
  }

  function logout() {
    TOKEN = "";
    store.set("");
    state = null;
    clearInterval(tickTimer);
    clearInterval(syncTimer);
    $("#logoutBtn").hidden = true;
    $("#dashView").hidden = true;
    $("#loginView").hidden = false;
  }

  function resultBanner() {
    const r = state.result;
    if (!r || !r.published) return "";
    if (r.position) {
      return `<div class="notice" style="margin-bottom:18px"><h3>Congratulations</h3><p>You secured ${esc(r.label)} position.</p></div>`;
    }
    return `<div class="card" style="margin-bottom:18px"><p>Thank you for participating.</p></div>`;
  }

  function membersHtml() {
    return (state.registration.members || [])
      .map((m) => `<div class="t-main">${esc(m.name)}</div><div class="t-sub">${esc(m.regNo)} · ${esc(m.programLabel || m.program)}</div>`)
      .join("");
  }

  function renderPending() {
    $("#dashView").innerHTML = `${resultBanner()}<div class="card"><h2>Under review</h2><p class="muted" style="margin-top:8px">Your registration is under review. Check back after the organizers accept your payment.</p><p style="margin-top:16px"><b>${esc(state.registration.id)}</b> · ${esc(state.registration.teamName)}</p></div>`;
  }

  function renderRejected() {
    const reason = state.rejectReason ? `<p style="margin-top:12px">Reason: ${esc(state.rejectReason)}</p>` : "";
    $("#dashView").innerHTML = `<div class="card"><h2>Registration not accepted</h2>${reason}<p class="muted" style="margin-top:12px">Please contact the organizers if you have questions.</p></div>`;
  }

  function competitionBlock() {
    const attempt = state.attempt;
    const running = attempt && attempt.state === "running";
    const over = attempt && (attempt.state === "time_over" || (attempt.endsAt && nowApprox() >= attempt.endsAt));
    const submitted = attempt && attempt.submission && attempt.submission.driveLink;

    if (!attempt) {
      const gate = state.gateOpen
        ? `<p class="muted">When you start, the timer begins immediately and cannot be paused. Refreshing will not restart it.</p>
           <button class="btn" id="startBtn" type="button">Start my ${esc(String(state.durationMinutes || 20))} minutes</button>`
        : `<p class="muted">The competition gate is closed. Wait for the organizers to open it before you start.</p>`;
      return `<div class="card stack"><h3>Competition</h3><p>You will have ${esc(String(state.durationMinutes || 20))} minutes on your own clock to create the video and submit a Google Drive link.</p>${gate}<div id="compAlert" class="alert err"></div></div>`;
    }

    if (over && !running) {
      const link = submitted
        ? `<p>Your submission: <a href="${esc(attempt.submission.driveLink)}" target="_blank" rel="noopener">${esc(attempt.submission.driveLink)}</a></p>`
        : `<p>You did not submit anything.</p>`;
      return `<div class="card stack"><h3>Time is over. Submissions are closed.</h3><div class="countdown">00:00</div>${link}</div>`;
    }

    const subNote = submitted
      ? `<p class="note-ok">Submitted at ${esc(karachiTime(attempt.submission.updatedAt || attempt.submission.submittedAt))} (Asia/Karachi)</p>`
      : "";
    const driveBtn = state.driveLink
      ? `<a class="btn" href="${esc(state.driveLink)}" target="_blank" rel="noopener">Open organizer Drive folder</a>`
      : "";
    return `<div class="card stack">
      <h3>Your window</h3>
      <div class="countdown" id="cd">${fmtRemain(attempt.remainingMs)}</div>
      ${driveBtn}
      <form id="subForm" class="stack">
        <div class="field">
          <label for="teamLink">Your Google Drive link (video + prompts)</label>
          <input id="teamLink" value="${esc(submitted ? attempt.submission.driveLink : "")}" placeholder="https://drive.google.com/..." />
        </div>
        <button class="btn" id="subBtn" type="submit">Submit link</button>
      </form>
      ${subNote}
      <div id="compAlert" class="alert err"></div>
    </div>`;
  }

  function renderAccepted() {
    $("#dashView").innerHTML = `
      ${resultBanner()}
      <div class="card" style="margin-bottom:16px">
        <span class="badge accepted">Approved</span>
        <h2 style="margin-top:10px">${esc(state.registration.teamName)}</h2>
        <p class="muted">${esc(state.registration.id)} · ${esc(state.institute)}</p>
        <p style="margin-top:12px"><b>Venue:</b> ${esc(state.venue || "Will be announced")}</p>
        <div style="margin-top:12px">${membersHtml()}</div>
      </div>
      ${competitionBlock()}`;
  }

  function render() {
    $("#logoutBtn").hidden = false;
    $("#loginView").hidden = true;
    $("#dashView").hidden = false;
    if (state.status === "pending") renderPending();
    else if (state.status === "rejected") renderRejected();
    else renderAccepted();
    bindDash();
  }

  function showCompError(msg) {
    const a = $("#compAlert");
    if (!a) return;
    a.innerHTML = esc(msg);
    a.classList.add("show");
  }

  function bindDash() {
    const startBtn = $("#startBtn");
    if (startBtn) {
      startBtn.addEventListener("click", async () => {
        if (!confirm("The timer starts immediately and cannot be paused. Continue?")) return;
        startBtn.disabled = true;
        startBtn.textContent = "Starting…";
        try {
          const { res, data } = await api("/api/portal/start", { method: "POST", body: {} });
          if (!data.ok) return showCompError((data.errors && data.errors[0]) || "Could not start.");
          applySync(data);
          render();
        } catch (e) {
          showCompError(e.message);
        }
      });
    }
    const form = $("#subForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = $("#subBtn");
        btn.disabled = true;
        btn.textContent = "Submitting…";
        try {
          const { data } = await api("/api/portal/submit", { method: "POST", body: { driveLink: $("#teamLink").value } });
          if (!data.ok) {
            showCompError((data.errors && data.errors[0]) || "Submit failed.");
            btn.disabled = false;
            btn.textContent = "Submit link";
            return;
          }
          applySync(data);
          render();
        } catch (err) {
          showCompError(err.message);
          btn.disabled = false;
          btn.textContent = "Submit link";
        }
      });
    }
    startTick();
  }

  function startTick() {
    clearInterval(tickTimer);
    clearInterval(syncTimer);
    const attempt = state && state.attempt;
    if (!attempt || attempt.state !== "running") return;
    tickTimer = setInterval(() => {
      const left = attempt.endsAt - nowApprox();
      const el = $("#cd");
      if (el) el.textContent = fmtRemain(left);
      if (left <= 0) {
        clearInterval(tickTimer);
        loadMe();
      }
    }, 250);
    syncTimer = setInterval(loadMe, 30000);
  }

  async function loadMe() {
    const { data } = await api("/api/portal/me");
    if (!data.ok) return;
    applySync(data);
    render();
  }

  $("#loginView").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alert = $("#loginAlert");
    alert.classList.remove("show");
    const btn = $("#loginBtn");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      const { data } = await jsonFetch("/api/portal/login", {
        method: "POST",
        body: JSON.stringify({
          id: $("#loginId").value.trim().toUpperCase(),
          regNo: $("#loginReg").value.trim().toUpperCase(),
        }),
      });
      if (!data.ok) {
        alert.innerHTML = esc((data.errors && data.errors[0]) || "Login failed.");
        alert.classList.add("show");
        return;
      }
      TOKEN = data.token;
      store.set(TOKEN);
      await loadMe();
    } catch {
      alert.innerHTML = "Could not reach the server.";
      alert.classList.add("show");
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });

  $("#logoutBtn").addEventListener("click", logout);
  $("#loginReg").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
  $("#loginId").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  const saved = store.get();
  if (saved) {
    TOKEN = saved;
    loadMe().catch(() => logout());
  }
})();
