(() => {
  const { esc } = window.VSP;
  fetch("/api/stats")
    .then((r) => r.json())
    .then((d) => {
      const el = document.getElementById("regCount");
      if (el) el.textContent = d.total ?? 0;
    })
    .catch(() => {});

  fetch("/api/winners")
    .then((r) => r.json())
    .then((d) => {
      if (!d.published) return;
      const box = document.getElementById("winners");
      const podium = document.getElementById("podium");
      box.hidden = false;
      const slots = [
        { key: "first", label: "1st place", cls: "gold" },
        { key: "second", label: "2nd place", cls: "silver" },
        { key: "third", label: "3rd place", cls: "bronze" },
      ];
      podium.innerHTML = slots
        .map((s) => {
          const t = d[s.key];
          const names = t ? (t.members || []).map((n) => esc(n)).join(" · ") : "Not decided";
          return `<div class="card place ${s.cls}"><div class="rank">${s.label}</div><h3>${t ? esc(t.teamName) : "—"}</h3><p>${names}</p></div>`;
        })
        .join("");
    })
    .catch(() => {});
})();
