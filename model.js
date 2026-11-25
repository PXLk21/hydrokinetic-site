/* Hydrokinetic model: the Simulink block equations as plain functions.
   Mirrors Hydrokinetic_Energy_Harvesting_Model.slx (pipe -> turbine -> generator -> protection -> battery). */
(function (root) {
  "use strict";

  var DEFAULTS = {
    Q0: 0.55556, Q1: 0.55556,        // water flow at start / end of run (m3/s); linear ramp between
    Pin: 360000, Pout: 335000,       // inlet / outlet pressure (Pa)
    etaT: 0.75, rpm: 1500,           // turbine efficiency, speed
    etaG: 0.90, R: 1.536,            // generator efficiency, load resistance (ohm)
    Qmin: 0.41667, Pmin: 300000,     // protection: minimum flow, minimum inlet pressure
    Vmax: 150, Imax: 90,             // protection: maximum voltage, maximum current
    cap: 0.216, soc0: 50,            // battery capacity (kWh), starting charge (%)
    load: 30, maxChg: 43.2, etaC: 0.9, // DC load (W), charging power limit (W), charging efficiency
    tOff: 1800, T: 3600              // generator available until (s), run length (s)
  };

  function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }

  function instant(p, q) {
    var dP = Math.max(p.Pin - p.Pout, 0);
    var Phyd = q * dP;
    var Pm = p.etaT * Phyd;
    var w = p.rpm * 2 * Math.PI / 60;
    var torque = Pm / w;
    var Pg = p.etaG * Pm;
    var I = Math.sqrt(Pg / p.R);
    var V = I * p.R;
    var checks = {
      flow: q >= p.Qmin,
      pressure: p.Pin >= p.Pmin,
      voltage: V <= p.Vmax,
      current: I <= p.Imax
    };
    var ok = checks.flow && checks.pressure && checks.voltage && checks.current;
    return { dP: dP, Phyd: Phyd, Pm: Pm, w: w, torque: torque, Pg: Pg, I: I, V: V, checks: checks, ok: ok };
  }

  function simulate(p) {
    var N = Math.max(10, Math.min(Math.round(p.T), 3600));
    var dt = p.T / N;
    var cap = p.cap;
    var out = { N: N, dt: dt, t: [], Q: [], V: [], I: [], Pgen: [], Pprot: [], E: [], Pbat: [], SOC: [] };
    var E = 0, Eb = cap * p.soc0 / 100;
    var offSteps = 0, tripIndex = -1;
    for (var i = 0; i <= N; i++) {
      var t = i * dt;
      var q = p.Q0 + (p.Q1 - p.Q0) * i / N;
      var s = instant(p, q);
      var Pp = s.ok ? s.Pg : 0;
      var avail = t < p.tOff;
      var net = clamp(Pp - p.load, 0, p.maxChg) * p.etaC;
      var Pb = avail ? net : -p.load;
      if (i > 0) {
        E += out.Pprot[i - 1] * dt / 3.6e6;
        Eb = clamp(Eb + out.Pbat[i - 1] * dt / 3.6e6, 0, cap);
      }
      if (!s.ok) { offSteps++; if (tripIndex < 0) tripIndex = i; }
      out.t.push(t); out.Q.push(q); out.V.push(s.V); out.I.push(s.I); out.Pgen.push(s.Pg); out.Pprot.push(Pp);
      out.E.push(E); out.Pbat.push(Pb); out.SOC.push(clamp(Eb / cap * 100, 0, 100));
    }
    out.first = instant(p, p.Q0);
    out.last = instant(p, p.Q1);
    out.tripIndex = tripIndex;
    out.tripTime = tripIndex >= 0 ? out.t[tripIndex] : null;
    out.tripChecks = tripIndex >= 0 ? instant(p, out.Q[tripIndex]).checks : null;
    out.offFraction = offSteps / (N + 1);
    out.endE = out.E[N];
    out.endSOC = out.SOC[N];
    out.minSOC = Math.min.apply(null, out.SOC);
    out.maxSOC = Math.max.apply(null, out.SOC);
    out.chargeAtStart = out.Pbat[0];
    return out;
  }

  var api = { DEFAULTS: DEFAULTS, instant: instant, simulate: simulate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HydroModel = api;
})(typeof window !== "undefined" ? window : this);
