const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const v = require("../services/validate");

describe("validation", () => {
  it("accepts FA23-BSE-062 style registration numbers", () => {
    assert.equal(v.isRegNo("fa23-bse-062"), true);
    assert.equal(v.normalizeRegNo("fa23-bse-062"), "FA23-BSE-062");
    assert.equal(v.isRegNo("SP24-BCS-001"), true);
    assert.equal(v.isRegNo("FA23-BSAI-100"), true);
    assert.equal(v.isRegNo("FA2-BSE-062"), false);
    assert.equal(v.isRegNo("FA23-B-062"), false);
    assert.equal(v.isRegNo("FA23-BSE-62"), false);
  });

  it("only allows https Google Drive / Docs URLs", () => {
    assert.equal(v.isGoogleDriveUrl("https://drive.google.com/drive/folders/abc"), true);
    assert.equal(v.isGoogleDriveUrl("https://docs.google.com/document/d/abc"), true);
    assert.equal(v.isGoogleDriveUrl("http://drive.google.com/x"), false);
    assert.equal(v.isGoogleDriveUrl("https://evil.com/?q=drive.google.com"), false);
    assert.equal(v.isGoogleDriveUrl("https://google.com"), false);
  });

  it("detects receipt magic bytes", () => {
    assert.equal(v.detectReceipt(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])).contentType, "image/jpeg");
    assert.equal(v.detectReceipt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])).contentType, "image/png");
    assert.equal(v.detectReceipt(Buffer.from("%PDF-1.4 hello")).contentType, "application/pdf");
    assert.equal(v.detectReceipt(Buffer.from("not a file")), null);
  });
});
