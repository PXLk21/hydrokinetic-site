/* Healthy-baseline anomaly detector, as described in the project docs (status_log.md, 7 Nov 2026).
   - Each channel has a centre and a tolerance; a reading is "outside" when it is more than one tolerance from the centre.
   - Three readings in a row outside normal raise an alert, named by the direction of the worst value.
   - A gate ignores readings while the pump is off and for 5 s after a start, stop or jump.
   The rig's own numbers: centre 8.087 V, 61.1 mA, 15.54 L/min, 0.212 V ripple;
   tolerance 1.5 % voltage, 8 % current, 4 % flow, +15 % ripple (upper side only). */
(function (root) {
  "use strict";

  function ch(centre, tolFrac, sides) { return { centre: centre, tol: centre * tolFrac, sides: sides || "both" }; }

  var BENCH_MODEL = {
    channels: {
      voltage: ch(8.087, 0.015),
      current: ch(61.1, 0.08),
      flow: ch(15.54, 0.04),
      ripple: ch(0.212, 0.15, "high")
    },
    consecutive: 3,
    gate: true,
    holdSeconds: 5,
    offBelowFlow: 2,   // L/min: below this the pump counts as off
    jumpTol: 2.5       // a one-second change larger than this many tolerances counts as a jump (assumed value)
  };

  var CAUSES = {
    voltage: { high: "Voltage too high", low: "Voltage too low" },
    current: { high: "Current too high", low: "Current lost" },
    flow: { high: "Flow above normal", low: "Flow below normal" },
    ripple: { high: "Ripple too high", low: "Ripple too low" }
  };

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  /* Learn centre and tolerance from healthy rows: median, spread = 1.4826 x MAD,
     tolerance = larger of 3 x spread and a relative floor (the rule used by ai/train_anomaly.py and in the SKAB test). */
  function learn(rows, names, floor) {
    var channels = {};
    names.forEach(function (n) {
      var v = rows.map(function (r) { return r[n]; });
      var c = median(v), mad = median(v.map(function (x) { return Math.abs(x - c); }));
      channels[n] = { centre: c, tol: Math.max(3 * 1.4826 * mad, floor * Math.abs(c)), sides: "both" };
    });
    return { channels: channels, consecutive: 3, gate: false, holdSeconds: 0, offBelowFlow: 0, jumpTol: 1e9 };
  }

  function Detector(model) { this.m = model; this.reset(); }
  Detector.prototype.reset = function () { this.prev = null; this.wasOn = null; this.holdUntil = -1; this.count = 0; };

  Detector.prototype.step = function (row, t) {
    var m = this.m, names = Object.keys(m.channels), i, n, c;
    var pumpOn = m.gate ? row.flow >= m.offBelowFlow : true;
    if (m.gate && this.prev) {
      if (pumpOn !== this.wasOn) this.holdUntil = t + m.holdSeconds;
      else if (pumpOn) {
        for (i = 0; i < names.length; i++) {
          n = names[i]; c = m.channels[n];
          if (Math.abs(row[n] - this.prev[n]) > m.jumpTol * c.tol) { this.holdUntil = t + m.holdSeconds; break; }
        }
      }
    }
    this.prev = row; this.wasOn = pumpOn;

    var dev = {}, worstCh = null, worstAbs = -1, worstSign = 1;
    for (i = 0; i < names.length; i++) {
      n = names[i]; c = m.channels[n];
      var d = (row[n] - c.centre) / c.tol;
      if (c.sides === "high") d = Math.max(d, 0);
      dev[n] = d;
      if (Math.abs(d) > worstAbs) { worstAbs = Math.abs(d); worstCh = n; worstSign = d >= 0 ? 1 : -1; }
    }
    var gated = m.gate && (!pumpOn || t < this.holdUntil);
    if (gated) { this.count = 0; return { gated: true, pumpOn: pumpOn, dev: dev, worst: { ch: worstCh, abs: worstAbs, sign: worstSign }, count: 0, alert: false, cause: null }; }
    this.count = worstAbs > 1 ? this.count + 1 : 0;
    var alert = this.count >= m.consecutive;
    return {
      gated: false, pumpOn: pumpOn, dev: dev, worst: { ch: worstCh, abs: worstAbs, sign: worstSign },
      count: this.count, alert: alert,
      cause: alert && CAUSES[worstCh] ? CAUSES[worstCh][worstSign > 0 ? "high" : "low"] : null
    };
  };

  var api = { BENCH_MODEL: BENCH_MODEL, CAUSES: CAUSES, Detector: Detector, learn: learn };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HydroDetector = api;
})(typeof window !== "undefined" ? window : this);
