const express = require("express");
const db = require("../db");
const clock = require("../services/clock");
const { INSTITUTE } = require("../options");
const { receiptUpload } = require("../middleware/upload");
const v = require("../services/validate");

const router = express.Router();

function memberFrom(body, prefix) {
  const name = v.clean(body[prefix + "Name"], 80);
  const regNo = v.normalizeRegNo(body[prefix + "RegNo"]);
  const program = v.clean(body[prefix + "Program"], 8).toUpperCase();
  const started = !!(name || body[prefix + "RegNo"] || body[prefix + "Program"]);
  return { name, regNo, program, started };
}

router.post("/api/register", receiptUpload, async (req, res, next) => {
  try {
    const b = req.body || {};
    const teamName = v.clean(b.teamName, 80);
    const email = v.clean(b.email, 120).toLowerCase();
    const phone = v.normalizePhone(b.phone);
    const paymentMethod = v.clean(b.paymentMethod, 40);
    let transactionId = v.clean(b.transactionId, 80);
    const accepted = b.acceptedRules === true || b.acceptedRules === "true";

    const m1 = memberFrom(b, "member1");
    const m2 = memberFrom(b, "member2");

    const errors = [];
    if (!teamName) errors.push("Team / participant name is required.");
    if (!v.isEmail(email)) errors.push("Enter a valid contact email.");
    if (!v.isPhone(phone)) errors.push("Enter a valid Pakistani mobile number (03XXXXXXXXX).");

    if (m1.name.length < 3) errors.push("Member 1 name is required.");
    if (!v.isRegNo(m1.regNo)) errors.push("Member 1 registration number must look like FA23-BSE-062.");
    if (!v.isProgram(m1.program)) errors.push("Select member 1 degree program.");

    const members = [{ name: m1.name, regNo: m1.regNo, program: m1.program }];
    if (m2.started) {
      if (m2.name.length < 3) errors.push("Member 2 name is required if you start member 2.");
      if (!v.isRegNo(m2.regNo)) errors.push("Member 2 registration number must look like FA23-BSE-062.");
      if (!v.isProgram(m2.program)) errors.push("Select member 2 degree program.");
      if (m2.regNo && m2.regNo === m1.regNo) errors.push("Both members cannot share the same registration number.");
      if (!errors.some((e) => e.includes("Member 2"))) {
        members.push({ name: m2.name, regNo: m2.regNo, program: m2.program });
      }
    }

    if (!v.isPaymentMethod(paymentMethod)) errors.push("Select a payment method.");
    if (paymentMethod === "On-campus Desk") transactionId = "";
    else if (transactionId.length < 6) errors.push("Enter a valid transaction ID.");
    if (!accepted) errors.push("You must accept the competition rules.");

    const file = req.file;
    if (!file || !file.buffer) errors.push("Upload a payment receipt (JPG, PNG or PDF, max 2 MB).");
    else {
      const kind = v.detectReceipt(file.buffer);
      if (!kind) errors.push("Receipt must be a real JPG, PNG or PDF file (max 2 MB).");
    }

    if (errors.length) return res.status(400).json({ ok: false, errors });

    const memberIds = members.map((m) => m.regNo);
    for (const id of memberIds) {
      const dup = await db.registrations.findByMemberId(id);
      if (dup) {
        return res.status(409).json({
          ok: false,
          errors: [`Registration number ${id} is already registered.`],
        });
      }
    }

    const kind = v.detectReceipt(file.buffer);
    const id = await db.nextId();
    const receipt = await db.receipts.save({
      registrationId: id,
      filename: v.clean(file.originalname, 120) || `receipt.${kind.ext}`,
      contentType: kind.contentType,
      buffer: file.buffer,
    });

    const now = clock.now();
    try {
      await db.registrations.insert({
        id,
        teamName,
        email,
        phone,
        institute: INSTITUTE,
        paymentMethod,
        transactionId,
        status: "pending",
        rejectReason: "",
        statusUpdatedAt: now,
        venue: "",
        members,
        memberIds,
        receiptId: receipt._id,
        createdAt: now,
      });
    } catch (err) {
      if (err.code === "DUPLICATE_REG") {
        return res.status(409).json({
          ok: false,
          errors: ["That registration number is already registered."],
        });
      }
      throw err;
    }

    res.status(201).json({
      ok: true,
      id,
      note: "Save this ID. Use it to check your approval status and venue.",
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
