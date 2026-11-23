(() => {
  const { esc, jsonFetch, karachiDateTime, fmtRemain } = window.VSP;
  const $ = (s) => document.querySelector(s);
  const FEE = 1000;
  let TOKEN = "";
  let ALL = [];
  let filter = "all";
  let live = [];
  let liveFilter = "all";
  let liveTimer = null;
  let judging = null;
  let current = null;
  let gateOpen = false;

  const store = {
    get() { try { return sessionStorage.getItem("vspark_admin") || ""; } catch { return ""; } },
    set(v) { try { v ? sessionStorage.setItem("vspark_admin", v) : sessionStorage.removeItem("vspark_admin"); } catch {} },
  };

  function headers() {
    return { Authorization: "Bearer " + TOKEN, "x-admin-token": TOKEN, "Content-Type": "application/json" };
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
    if (res.status === 401) {
      logout();
      throw new Error("Session expired. Please sign in again.");
    }
    return res;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }

  function showLoginError(msg) {
    const a = $("#loginAlert");
    a.innerHTML = esc(msg);
    a.classList.toggle("show", !!msg);
  }

  async function login(user, pw) {
    const { res, data } = await jsonFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: user, password: pw }),
    });
    if (!res.ok || !data.ok) throw new Error((data.errors && data.errors[0]) || "Login failed.");
    TOKEN = data.token;
    store.set(TOKEN);
    $("#loginView").hidden = true;
    $("#dashView").hidden = false;
    $("#logoutBtn").hidden = false;
    await loadRegs();
    await loadSettings();
  }

  function logout() {
    TOKEN = "";
    ALL = [];
    store.set("");
    clearInterval(liveTimer);
    $("#dashView").hidden = true;
    $("#logoutBtn").hidden = true;
    $("#loginView").hidden = false;
    closeDrawer();
  }

  async function loadRegs() {
    const res = await api("/api/admin/registrations");
    const data = await res.json();
    ALL = data.rows || [];
    renderRegs();
  }

  function renderRegs() {
    const c = { all: ALL.length, pending: 0, accepted: 0, rejected: 0 };
    ALL.forEach((r) => { if (c[r.status] !== undefined) c[r.status]++; });
    $("#kTotal").textContent = c.all;
    $("#kPending").textContent = c.pending;
    $("#kAccepted").textContent = c.accepted;
    $("#kRejected").textContent = c.rejected;
    $("#kMoney").textContent = "PKR " + (c.accepted * FEE).toLocaleString();
    $("#cAll").textContent = c.all;
    $("#cPending").textContent = c.pending;
    $("#cAccepted").textContent = c.accepted;
    $("#cRejected").textContent = c.rejected;

    const q = $("#search").value.trim().toLowerCase();
    const rows = ALL.filter((r) => (filter === "all" || r.status === filter) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
    $("#rows").innerHTML = rows.map((r) => {
      const names = (r.members || []).map((m) => esc(m.name)).join(" &amp; ");
      const regs = (r.memberIds || []).map(esc).join(" · ");
      return `<tr data-id="${esc(r.id)}">
        <td class="t-id">${esc(r.id)}</td>
        <td><div class="t-main">${esc(r.teamName)}</div><div class="t-sub">${(r.members || []).length === 2 ? "Team of 2" : "Individual"}</div></td>
        <td><div class="t-main">${names}</div><div class="t-sub">${regs}</div></td>
        <td><div class="t-main">${esc(r.paymentMethod)}</div><div class="t-sub">${esc(r.transactionId) || "Pay on desk"}</div></td>
        <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
        <td class="t-sub">${r.createdAt ? karachiDateTime(r.createdAt) : ""}</td>
        <td><div class="row-actions">
          <button class="btn ok sm" data-act="accepted" data-id="${esc(r.id)}">Accept</button>
          <button class="btn danger sm" data-act="rejected" data-id="${esc(r.id)}">Reject</button>
        </div></td>
      </tr>`;
    }).join("");
    const empty = rows.length === 0;
    $("#empty").hidden = !empty;
    $("table.data").style.display = empty ? "none" : "";
    if (empty) {
      const none = ALL.length === 0;
      $("#emptyTitle").textContent = none ? "No registrations yet" : "No matching entries";
      $("#emptyText").textContent = none ? "New entries will show up here as soon as someone registers." : "Try a different filter or search term.";
    }
  }

  async function setStatus(id, status) {
    let rejectReason = "";
    if (status === "rejected") {
      rejectReason = prompt("Optional reason the student will see:") || "";
    }
    const res = await api("/api/admin/registrations/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ status, rejectReason }),
    });
    if (!res.ok) return toast("Could not update.");
    await loadRegs();
    if (current === id) openDrawer(id);
    toast(`${id} marked ${status}`);
  }

  async function remove(id) {
    if (!confirm(`Delete ${id} permanently?`)) return;
    const res = await api("/api/admin/registrations/" + encodeURIComponent(id), { method: "DELETE" });
    if (!res.ok) return toast("Could not delete.");
    closeDrawer();
    await loadRegs();
    toast(`${id} deleted`);
  }

  function openDrawer(id) {
    const r = ALL.find((x) => x.id === id);
    if (!r) return;
    current = id;
    const people = (r.members || []).map((m, i) => `<div class="sec"><h4>Member ${i + 1}</h4><dl class="kv">
      <dt>Name</dt><dd>${esc(m.name)}</dd>
      <dt>Reg. no.</dt><dd>${esc(m.regNo)}</dd>
      <dt>Program</dt><dd>${esc(m.programLabel || m.program)}</dd></dl></div>`).join("");
    const receipt = r.hasReceipt
      ? `<div class="sec"><h4>Receipt</h4>
          <p><a class="btn sm" href="/api/admin/receipts/${esc(r.id)}" target="_blank" rel="noopener" id="receiptOpen">Open receipt</a></p>
          <iframe class="receipt-frame" title="Receipt preview" loading="lazy"></iframe>
        </div>`
      : "";
    $("#drawerBody").innerHTML = `
      <span class="badge ${esc(r.status)}">${esc(r.status)}</span>
      <h2>${esc(r.teamName)}</h2>
      <div class="t-sub">${esc(r.id)} · ${karachiDateTime(r.createdAt)}</div>
      <div class="sec"><h4>Contact</h4><dl class="kv">
        <dt>Email</dt><dd>${esc(r.email)}</dd>
        <dt>Phone</dt><dd>${esc(r.phone)}</dd>
        <dt>Institute</dt><dd>${esc(r.institute)}</dd></dl></div>
      ${people}
      <div class="sec"><h4>Payment</h4><dl class="kv">
        <dt>Method</dt><dd>${esc(r.paymentMethod)}</dd>
        <dt>Txn</dt><dd>${esc(r.transactionId) || "Pay on desk"}</dd></dl></div>
      ${r.rejectReason ? `<div class="sec"><h4>Reject reason</h4><p>${esc(r.rejectReason)}</p></div>` : ""}
      ${receipt}
      <div class="sec"><h4>Venue override</h4>
        <input id="venueOverride" value="${esc(r.venue || "")}" placeholder="Leave blank to use default" />
        <p class="t-sub" style="margin-top:6px">Effective: ${esc(r.effectiveVenue || "—")}</p>
        <button class="btn sm" style="margin-top:10px" id="saveVenue" type="button">Save venue</button>
      </div>
      <div class="btns">
        <button class="btn ok sm" data-act="accepted" data-id="${esc(r.id)}">Accept</button>
        <button class="btn ghost sm" data-act="pending" data-id="${esc(r.id)}">Set pending</button>
        <button class="btn danger sm" data-act="rejected" data-id="${esc(r.id)}">Reject</button>
        <button class="btn danger sm" data-del="${esc(r.id)}">Delete</button>
      </div>`;
    const iframe = $("#drawerBody").querySelector("iframe");
    const open = $("#receiptOpen");
    if (iframe) {
      // iframe cannot send Authorization; fetch as blob instead
      fetch("/api/admin/receipts/" + encodeURIComponent(r.id), { headers: headers() })
        .then((res) => res.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          iframe.src = url;
          if (open) {
            open.href = url;
            open.onclick = (e) => {
              e.preventDefault();
              window.open(url, "_blank");
            };
          }
        })
        .catch(() => {});
    }
    $("#saveVenue").addEventListener("click", async () => {
      const res = await api("/api/admin/registrations/" + encodeURIComponent(r.id), {
        method: "PATCH",
        body: JSON.stringify({ venue: $("#venueOverride").value }),
      });
      if (!res.ok) return toast("Could not save venue.");
      await loadRegs();
      openDrawer(id);
      toast("Venue saved");
    });
    $("#overlay").classList.add("open");
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    current = null;
    $("#overlay").classList.remove("open");
    $("#drawer").classList.remove("open");
    $("#drawer").setAttribute("aria-hidden", "true");
  }

  async function download(url, name) {
    const res = await api(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function setGateUi(on) {
    gateOpen = !!on;
    $("#gateBtn").classList.toggle("on", gateOpen);
    $("#gateBtn").setAttribute("aria-pressed", String(gateOpen));
    $("#gateLabel").textContent = gateOpen ? "Gate open" : "Gate closed";
  }

  async function loadSettings() {
    const res = await api("/api/admin/settings");
    const data = await res.json();
    const s = data.settings || {};
    $("#driveLink").value = s.driveLink || "";
    $("#durationMinutes").value = s.durationMinutes || 20;
    $("#defaultVenue").value = s.defaultVenue || "";
    setGateUi(s.gateOpen);
  }

  async function loadLive() {
    const res = await api("/api/admin/live");
    const data = await res.json();
    live = data.rows || [];
    renderLive();
  }

  function stateLabel(row) {
    if (row.state === "running") return `<span class="live-running">${fmtRemain(row.remainingMs)}</span>`;
    if (row.state === "time_over") return `<span class="live-over">Time over</span>`;
    if (row.state === "submitted") return `<span class="badge accepted">Submitted</span>`;
    return `<span class="live-miss">Not started</span>`;
  }

  function renderLive() {
    const q = $("#liveSearch").value.trim().toLowerCase();
    const rows = live.filter((r) => (liveFilter === "all" || r.state === liveFilter) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
    $("#liveRows").innerHTML = rows.map((r) => {
      const members = (r.members || []).map((m) => esc(m.name)).join(" &amp; ");
      const regs = (r.memberIds || []).map(esc).join(" · ");
      const link = r.submittedLink
        ? `<a href="${esc(r.submittedLink)}" target="_blank" rel="noopener">Open</a>`
        : r.state === "time_over" || r.state === "not_started"
          ? `<span class="live-miss">No submission</span>`
          : "—";
      return `<tr>
        <td><div class="t-main">${esc(r.teamName)}</div><div class="t-id">${esc(r.id)}</div></td>
        <td>${members}</td><td class="t-sub">${regs}</td><td>${esc(r.venue || "—")}</td>
        <td>${stateLabel(r)}</td>
        <td class="t-sub">${r.startedAt ? karachiDateTime(r.startedAt) : "—"}</td>
        <td class="t-sub">${r.endsAt ? karachiDateTime(r.endsAt) : "—"}</td>
        <td>${link}</td>
        <td class="t-sub">${r.submittedAt ? karachiDateTime(r.submittedAt) : "—"}</td>
        <td>${r.submittedMinutesAfterStart != null ? r.submittedMinutesAfterStart + " min" : "—"}</td>
        <td><div class="row-actions">
          <button class="btn ghost sm" data-reset="${esc(r.id)}">Reset</button>
          <button class="btn sm" data-extend="${esc(r.id)}">Add minutes</button>
        </div></td>
      </tr>`;
    }).join("");
  }

  async function loadJudging() {
    const res = await api("/api/admin/judging");
    judging = await res.json();
    renderJudging();
  }

  function renderJudging() {
    if (!judging) return;
    $("#reviewProgress").textContent = `Reviewed ${judging.reviewedCount} of ${judging.submittedCount} submissions.`;
    const res = judging.results || {};
    const findTeam = (id) => (judging.submitted || []).concat(judging.notSubmitted || []).find((t) => t.id === id);
    const slots = [
      { key: "first", label: "1st" },
      { key: "second", label: "2nd" },
      { key: "third", label: "3rd" },
    ];
    $("#podiumAdmin").innerHTML = slots.map((s) => {
      const t = findTeam(res[s.key]);
      return `<div class="card"><small>${s.label}</small><h3>${t ? esc(t.teamName) : "Not decided"}</h3><p class="muted">${t ? (t.members || []).map((m) => esc(m.name)).join(" · ") : ""}</p></div>`;
    }).join("");

    $("#judgeRows").innerHTML = (judging.submitted || []).map((r) => {
      const pos = r.position === "first" ? "1" : r.position === "second" ? "2" : r.position === "third" ? "3" : "";
      return `<tr>
        <td><div class="t-main">${esc(r.teamName)}</div><div class="t-id">${esc(r.id)}</div><div class="t-sub">${esc(r.venue || "")}</div></td>
        <td>${(r.members || []).map((m) => `${esc(m.name)} <span class="t-sub">${esc(m.regNo)}</span>`).join("<br>")}</td>
        <td>${r.submittedLink ? `<a href="${esc(r.submittedLink)}" target="_blank" rel="noopener">Open</a>` : "—"}</td>
        <td class="t-sub">${r.submittedAt ? karachiDateTime(r.submittedAt) : "—"}<div>${r.submittedMinutesAfterStart != null ? r.submittedMinutesAfterStart + " min after start" : ""}</div></td>
        <td>
          <select class="pos-select" data-pos="${esc(r.id)}" ${res.published ? "disabled" : ""}>
            <option value="">None</option>
            <option value="1" ${pos === "1" ? "selected" : ""}>1st</option>
            <option value="2" ${pos === "2" ? "selected" : ""}>2nd</option>
            <option value="3" ${pos === "3" ? "selected" : ""}>3rd</option>
          </select>
        </td>
        <td><input type="checkbox" data-rev="${esc(r.id)}" ${r.reviewed ? "checked" : ""} /></td>
        <td><textarea class="notes" maxlength="500" data-notes="${esc(r.id)}">${esc(r.notes || "")}</textarea></td>
      </tr>`;
    }).join("");

    $("#missRows").innerHTML = (judging.notSubmitted || []).map((r) => `<tr>
      <td>${esc(r.teamName)} <div class="t-id">${esc(r.id)}</div></td>
      <td>${(r.members || []).map((m) => esc(m.name)).join(" · ")}</td>
      <td class="t-sub">${(r.memberIds || []).map(esc).join(" · ")}</td>
      <td>${esc(r.venue || "—")}</td>
      <td>${stateLabel(r)}</td>
    </tr>`).join("");
  }

  async function setPosition(id, position, replace) {
    const res = await api("/api/admin/results/position", {
      method: "POST",
      body: JSON.stringify({ registrationId: id, position: position || "none", replace }),
    });
    const data = await res.json();
    if (res.status === 409 && data.code === "POSITION_TAKEN") {
      if (confirm(data.errors[0])) return setPosition(id, position, true);
      await loadJudging();
      return;
    }
    if (!data.ok) {
      toast((data.errors && data.errors[0]) || "Could not assign.");
      await loadJudging();
      return;
    }
    await loadJudging();
  }

  // events
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showLoginError("");
    const btn = $("#loginBtn");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await login($("#user").value.trim(), $("#pw").value);
    } catch (err) {
      showLoginError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
  $("#logoutBtn").addEventListener("click", logout);
  $("#refreshBtn").addEventListener("click", async () => { await loadRegs(); toast("Refreshed"); });
  $("#csvBtn").addEventListener("click", () => download("/api/admin/export.csv", "vspark-registrations.csv"));
  $("#search").addEventListener("input", renderRegs);
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderRegs();
  });
  $("#mainTabs").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    document.querySelectorAll("#mainTabs button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on"));
    $("#panel-" + b.dataset.tab).classList.add("on");
    clearInterval(liveTimer);
    if (b.dataset.tab === "live") {
      await loadLive();
      liveTimer = setInterval(loadLive, 10000);
    }
    if (b.dataset.tab === "results") await loadJudging();
    if (b.dataset.tab === "comp") await loadSettings();
  });
  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act) { e.stopPropagation(); return setStatus(act.dataset.id, act.dataset.act); }
    const del = e.target.closest("[data-del]");
    if (del) return remove(del.dataset.del);
    const row = e.target.closest("#rows tr[data-id]");
    if (row) openDrawer(row.dataset.id);
  });
  $("#overlay").addEventListener("click", closeDrawer);
  $("#closeDrawer").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());

  $("#gateBtn").addEventListener("click", () => setGateUi(!gateOpen));
  $("#compForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#compAlert").classList.remove("show");
    const res = await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        driveLink: $("#driveLink").value.trim(),
        durationMinutes: Number($("#durationMinutes").value),
        defaultVenue: $("#defaultVenue").value.trim(),
        gateOpen,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      $("#compAlert").innerHTML = esc((data.errors && data.errors[0]) || "Could not save.");
      $("#compAlert").classList.add("show");
      return;
    }
    toast("Settings saved");
  });

  $("#liveRefresh").addEventListener("click", loadLive);
  $("#liveCsv").addEventListener("click", () => download("/api/admin/live/export.csv", "vspark-live.csv"));
  $("#liveSearch").addEventListener("input", renderLive);
  $("#liveTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    liveFilter = b.dataset.s;
    document.querySelectorAll("#liveTabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderLive();
  });
  document.getElementById("panel-live").addEventListener("click", async (e) => {
    const reset = e.target.closest("[data-reset]");
    if (reset) {
      if (!confirm("Reset this team's attempt? They will be able to start again.")) return;
      const res = await api("/api/admin/attempts/" + encodeURIComponent(reset.dataset.reset) + "/reset", { method: "POST", body: "{}" });
      if (!res.ok) return toast("Could not reset.");
      toast("Attempt reset");
      return loadLive();
    }
    const ext = e.target.closest("[data-extend]");
    if (ext) {
      const mins = Number(prompt("Add minutes to this team's deadline (can be negative):", "5"));
      if (!mins) return;
      const res = await api("/api/admin/attempts/" + encodeURIComponent(ext.dataset.extend) + "/extend", {
        method: "POST",
        body: JSON.stringify({ minutes: mins }),
      });
      const data = await res.json();
      if (!data.ok) return toast((data.errors && data.errors[0]) || "Could not extend.");
      toast("Deadline updated");
      return loadLive();
    }
  });

  $("#publishBtn").addEventListener("click", async () => {
    if (!confirm("Publish results? 1st, 2nd and 3rd must be filled. Winners will appear on the landing page.")) return;
    const res = await api("/api/admin/results/publish", { method: "POST", body: "{}" });
    const data = await res.json();
    if (!data.ok) return toast((data.errors && data.errors[0]) || "Could not publish.");
    toast("Results published");
    loadJudging();
  });
  $("#unpublishBtn").addEventListener("click", async () => {
    if (!confirm("Unpublish results? Winners will be hidden from the public site.")) return;
    const res = await api("/api/admin/results/unpublish", { method: "POST", body: "{}" });
    if (!res.ok) return toast("Could not unpublish.");
    toast("Results unpublished");
    loadJudging();
  });
  $("#resultsCsv").addEventListener("click", () => download("/api/admin/results/export.csv", "vspark-results.csv"));

  document.getElementById("panel-results").addEventListener("change", async (e) => {
    const pos = e.target.closest("[data-pos]");
    if (pos) return setPosition(pos.dataset.pos, pos.value);
    const rev = e.target.closest("[data-rev]");
    const notes = e.target.closest("[data-notes]");
    const id = (rev && rev.dataset.rev) || (notes && notes.dataset.notes);
    if (!id) return;
    const row = (judging.submitted || []).find((t) => t.id === id);
    const reviewed = rev ? rev.checked : !!row?.reviewed;
    const text = notes ? notes.value : row?.notes || "";
    await api("/api/admin/reviews", {
      method: "POST",
      body: JSON.stringify({ registrationId: id, reviewed, notes: text }),
    });
    loadJudging();
  });

  const saved = store.get();
  if (saved) {
    TOKEN = saved;
    $("#loginView").hidden = true;
    $("#dashView").hidden = false;
    $("#logoutBtn").hidden = false;
    loadRegs().catch(() => logout());
    loadSettings().catch(() => {});
  }
})();
