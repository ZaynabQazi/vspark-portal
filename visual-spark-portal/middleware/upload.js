const multer = require("multer");
const { RECEIPT_MAX_BYTES } = require("../options");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 },
});

function receiptUpload(req, res, next) {
  upload.single("receipt")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ ok: false, errors: ["Receipt must be 2 MB or smaller."] });
    }
    return res.status(400).json({ ok: false, errors: ["Could not read the receipt file."] });
  });
}

module.exports = { receiptUpload };
