(() => {
  const { esc } = window.VSP;
  const $ = (s, r = document) => r.querySelector(s);
  const form = $("#regForm");
  const REG_RE = /^(FA|SP)\d{2}-[A-Z]{2,4}-\d{3}$/;
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRe = /^(\+92|0)?3\d{9}$/;

  fetch("/api/meta")
    .then((r) => r.json())
    .then((d) => {
      if (d.institute) $("#instituteBadge").textContent = d.institute;
      const opts = (d.programs || []).map((p) => `<option value="${esc(p.code)}">${esc(p.label)}</option>`).join("");
      ["member1Program", "member2Program"].forEach((id) => {
        const el = document.getElementById(id);
        el.insertAdjacentHTML("beforeend", opts);
      });
    })
    .catch(() => {});

  document.querySelectorAll(".regno").forEach((el) => {
    el.addEventListener("input", () => {
      const start = el.selectionStart;
      el.value = el.value.toUpperCase();
      try { el.setSelectionRange(start, start); } catch {}
    });
  });

  const txnField = $("#txnField");
  $("#paymentMethod").addEventListener("change", () => {
    txnField.style.display = $("#paymentMethod").value === "On-campus Desk" ? "none" : "";
  });

  const receipt = $("#receipt");
  receipt.addEventListener("change", () => {
    const f = receipt.files && receipt.files[0];
    const meta = $("#receiptMeta");
    const prev = $("#receiptPreview");
    prev.innerHTML = "";
    $("#receiptBox").classList.remove("invalid");
    if (!f) {
      meta.textContent = "JPG, PNG or PDF · max 2 MB";
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      meta.textContent = "File is larger than 2 MB.";
      $("#receiptBox").classList.add("invalid");
      receipt.value = "";
      return;
    }
    meta.textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
    if (f.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.alt = "Receipt preview";
      img.src = URL.createObjectURL(f);
      prev.appendChild(img);
    }
  });

  function setError(id, message) {
    const input = document.getElementById(id);
    if (!input) return;
    const field = input.closest(".field");
    if (!field) return;
    field.classList.toggle("invalid", !!message);
    const err = $(".err", field);
    if (err) err.textContent = message || "";
  }

  function member2Started() {
    return ["member2Name", "member2RegNo", "member2Program"].some((id) => form.elements[id].value.trim());
  }

  function validate() {
    const v = (n) => form.elements[n].value.trim();
    let first = null;
    const fail = (id, msg) => {
      setError(id, msg);
      if (!first) first = document.getElementById(id);
    };
    ["teamName", "email", "phone", "paymentMethod", "transactionId", "member1Name", "member1RegNo", "member1Program", "member2Name", "member2RegNo", "member2Program"].forEach((id) => setError(id, ""));
    $("#receiptBox").classList.remove("invalid");
    $("#receiptErr").textContent = "";

    if (!v("teamName")) fail("teamName", "Enter a team name.");
    if (!emailRe.test(v("email"))) fail("email", "Enter a valid email.");
    if (!phoneRe.test(v("phone").replace(/[\s-]/g, ""))) fail("phone", "Use a number like 03001234567.");
    if (v("member1Name").length < 3) fail("member1Name", "Enter the full name.");
    if (!REG_RE.test(v("member1RegNo").toUpperCase())) fail("member1RegNo", "Use FA23-BSE-062 format.");
    if (!v("member1Program")) fail("member1Program", "Select a program.");
    if (member2Started()) {
      if (v("member2Name").length < 3) fail("member2Name", "Complete member 2 or clear the fields.");
      if (!REG_RE.test(v("member2RegNo").toUpperCase())) fail("member2RegNo", "Use FA23-BSE-062 format.");
      if (!v("member2Program")) fail("member2Program", "Select a program.");
    }
    if (!v("paymentMethod")) fail("paymentMethod", "Select a payment method.");
    else if (v("paymentMethod") !== "On-campus Desk" && v("transactionId").length < 6)
      fail("transactionId", "Enter the transaction ID (at least 6 characters).");
    const f = receipt.files && receipt.files[0];
    if (!f) {
      $("#receiptBox").classList.add("invalid");
      $("#receiptErr").textContent = "Upload a receipt.";
      if (!first) first = receipt;
    } else if (f.size > 2 * 1024 * 1024) {
      $("#receiptBox").classList.add("invalid");
      $("#receiptErr").textContent = "Max 2 MB.";
      if (!first) first = receipt;
    }
    const agree = $("#acceptedRules").checked;
    $("#agreeWrap").classList.toggle("invalid", !agree);
    if (!agree && !first) first = $("#acceptedRules");
    return first;
  }

  function showAlert(errors) {
    $("#alert").innerHTML = "<b>Please fix the following:</b><ul>" + errors.map((e) => `<li>${esc(e)}</li>`).join("") + "</ul>";
    $("#alert").classList.add("show");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#alert").classList.remove("show");
    const bad = validate();
    if (bad) {
      bad.scrollIntoView({ behavior: "smooth", block: "center" });
      if (bad.focus) bad.focus({ preventScroll: true });
      return;
    }
    const fd = new FormData(form);
    fd.set("acceptedRules", $("#acceptedRules").checked ? "true" : "false");
    fd.set("member1RegNo", fd.get("member1RegNo").toUpperCase());
    if (fd.get("member2RegNo")) fd.set("member2RegNo", String(fd.get("member2RegNo")).toUpperCase());
    const btn = $("#submitBtn");
    btn.disabled = true;
    btn.textContent = "Submitting…";
    try {
      const res = await fetch("/api/register", { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok) {
        $("#rid").textContent = data.id;
        form.hidden = true;
        $("#success").classList.add("show");
        $("#success").scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        showAlert(data.errors || ["Something went wrong."]);
      }
    } catch {
      showAlert(["Could not reach the server. Please try again."]);
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit registration";
    }
  });

  $("#againBtn").addEventListener("click", () => {
    form.reset();
    $("#receiptPreview").innerHTML = "";
    form.hidden = false;
    $("#success").classList.remove("show");
  });
})();
