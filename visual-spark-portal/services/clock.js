/** Server clock only. Tests may override `_now`. */
let _now = () => Date.now();

function now() {
  return _now();
}

function setNow(fn) {
  _now = fn;
}

function resetNow() {
  _now = () => Date.now();
}

module.exports = { now, setNow, resetNow };
