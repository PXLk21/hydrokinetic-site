/* Interactive model panel: inputs -> HydroModel.simulate -> stage cards + charts + CSV. */
(function () {
  "use strict";
  var M = window.HydroModel;
  var root = document.getElementById("try-root");
  if (!M || !root) return;

  var GROUPS = [
    { title: "Water and pipe", fields: [
      { k: "Q0", label: "Flow at start", unit: "m³/s", min: 0, max: 100 },
      { k: "Q1", label: "Flow at end of run", unit: "m³/s", min: 0, max: 100, hint: "Set lower than the start flow to test a falling flow." },
      { k: "Pin", label: "Inlet pressure", unit: "Pa", min: 0, max: 1e8 },
      { k: "Pout", label: "Outlet pressure", unit: "Pa", min: 0, max: 1e8 } ] },
    { title: "Turbine and generator", fields: [
      { k: "etaT", label: "Turbine efficiency", unit: "0 to 1", min: 0.01, max: 1 },
      { k: "rpm", label: "Turbine speed", unit: "rpm", min: 1, max: 100000 },
      { k: "etaG", label: "Generator efficiency", unit: "0 to 1", min: 0.01, max: 1 },
      { k: "R", label: "Load resistance", unit: "Ω", min: 0.001, max: 100000 } ] },
    { title: "Protection limits", fields: [
      { k: "Qmin", label: "Minimum flow", unit: "m³/s", min: 0, max: 100 },
      { k: "Pmin", label: "Minimum inlet pressure", unit: "Pa", min: 0, max: 1e8 },
      { k: "Vmax", label: "Maximum voltage", unit: "V", min: 0.1, max: 100000 },
      { k: "Imax", label: "Maximum current", unit: "A", min: 0.1, max: 100000 } ] },
    { title: "Battery and DC load", fields: [
      { k: "cap", label: "Battery capacity", unit: "kWh", min: 0.001, max: 10000 },
      { k: "soc0", label: "Starting charge", unit: "%", min: 0, max: 100 },
      { k: "load", label: "DC load", unit: "W", min: 0, max: 1e6 },
      { k: "maxChg", label: "Charging power limit", unit: "W", min: 0, max: 1e6 },
      { k: "etaC", label: "Charging efficiency", unit: "0 to 1", min: 0.01, max: 1 } ] },
    { title: "Run", fields: [
      { k: "tOff", label: "Generator available until", unit: "s", min: 0, max: 86400 },
      { k: "T", label: "Run length", unit: "s", min: 10, max: 86400 } ] }
  ];
  var BY_KEY = {};
  GROUPS.forEach(function (g) { g.fields.forEach(function (f) { BY_KEY[f.k] = f; }); });

  var PRESETS = {
    base: { label: "Your model" },
    lowflow: { label: "Falling flow", set: { Q1: 0.30 } },
    overcurrent: { label: "Overcurrent", set: { R: 1.0 } },
    early: { label: "Generator stops early", set: { tOff: 600 } }
  };

  var el = {};
  var state = Object.assign({}, M.DEFAULTS);
  var lastResult = null;

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- number formatting ---------- */
  function trimNum(x, d) { return String(parseFloat(x.toFixed(d))); }
  function fmtPower(w) { return Math.abs(w) >= 1000 ? (w / 1000).toFixed(3) + " kW" : w.toFixed(1) + " W"; }
  function fmtTime(s) { return s >= 600 ? trimNum(s / 60, 1) + " min" : trimNum(s, 0) + " s"; }
  function fmtGrouped(x) { return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

  /* ---------- build inputs ---------- */
  function buildInputs() {
    var form = root.querySelector("#try-form");
    GROUPS.forEach(function (g) {
      var fs = make("fieldset", "grp");
      fs.appendChild(make("legend", null, g.title));
      var grid = make("div", "fields");
      g.fields.forEach(function (f) {
        var wrap = make("div", "field");
        var id = "in-" + f.k;
        var lab = make("label", null, f.label);
        lab.htmlFor = id;
        var line = make("div", "inline");
        var inp = make("input");
        inp.type = "number"; inp.id = id; inp.step = "any"; inp.inputMode = "decimal";
        inp.value = String(state[f.k]); inp.dataset.k = f.k;
        inp.setAttribute("aria-describedby", id + "-msg");
        line.appendChild(inp); line.appendChild(make("span", "unit", f.unit));
        var msg = make("div", "msg"); msg.id = id + "-msg";
        wrap.appendChild(lab); wrap.appendChild(line);
        if (f.hint) wrap.appendChild(make("div", "hint", f.hint));
        wrap.appendChild(msg);
        grid.appendChild(wrap);
        el[f.k] = { input: inp, msg: msg };
      });
      fs.appendChild(grid); form.appendChild(fs);
    });
    form.addEventListener("input", onInput);
    form.addEventListener("submit", function (e) { e.preventDefault(); });
  }

  function readInputs() {
    var next = {}, bad = 0;
    Object.keys(BY_KEY).forEach(function (k) {
      var f = BY_KEY[k], ui = el[k], raw = ui.input.value.trim(), v = Number(raw);
      var err = "";
      if (raw === "" || !isFinite(v)) err = "Enter a number.";
      else if (v < f.min) err = "Must be at least " + f.min + ".";
      else if (v > f.max) err = "Must be at most " + f.max + ".";
      ui.msg.textContent = err;
      ui.input.setAttribute("aria-invalid", err ? "true" : "false");
      if (err) bad++; else next[k] = v;
    });
    return { values: next, bad: bad };
  }

  function onInput() {
    var r = readInputs();
    if (r.bad) {
      showBanner("error", r.bad === 1 ? "One input needs fixing. Results show the last valid values." : r.bad + " inputs need fixing. Results show the last valid values.");
      return;
    }
    state = r.values;
    run();
  }

  function setAll(values) {
    state = Object.assign({}, M.DEFAULTS, values || {});
    Object.keys(BY_KEY).forEach(function (k) { el[k].input.value = String(state[k]); });
    readInputs(); run();
  }

  /* ---------- results ---------- */
  function showBanner(kind, text) {
    el.banner.className = "banner " + kind;
    el.banner.textContent = text;
    el.banner.hidden = !text;
  }

  function card(title, rows, badge) {
    var c = make("section", "stage");
    var h = make("h4", null, title);
    c.appendChild(h);
    if (badge) c.appendChild(badge);
    var dl = make("dl", "vals");
    rows.forEach(function (r) {
      dl.appendChild(make("dt", null, r[0]));
      dl.appendChild(make("dd", r[2] || null, r[1]));
    });
    c.appendChild(dl);
    return c;
  }

  function checkRow(ok, text) {
    var li = make("li", "chk " + (ok ? "pass" : "fail"));
    li.appendChild(make("span", "mark", ok ? "Pass" : "Fail"));
    li.appendChild(make("span", null, text));
    return li;
  }


  /* ---------- AI early warning: the same detector watching the simulated generator ---------- */
  function aiWatch(res) {
    var Dm = window.HydroDetector, N = res.N, i;
    if (!Dm) return null;
    var out = { nb: Math.max(30, Math.min(300, Math.round(N * 0.05))), alertT: null, cause: null, status: "ok" };
    if (!(res.first.Pg > 0)) { out.status = "nopower"; return out; }
    var stop = res.tripIndex >= 0 ? res.tripIndex : N + 1;
    if (stop <= out.nb + 3) { out.status = "early"; return out; }
    var chans = ["flow", "voltage", "current"], rows = [];
    for (i = 0; i < out.nb; i++) rows.push({ flow: res.Q[i], voltage: res.V[i], current: res.I[i] });
    var det = new Dm.Detector(Dm.learn(rows, chans, 0.05));
    for (i = out.nb; i < Math.min(N + 1, stop); i++) {
      var r = det.step({ flow: res.Q[i], voltage: res.V[i], current: res.I[i] }, res.t[i]);
      if (r.alert) { out.alertT = res.t[i]; out.cause = r.cause; break; }
    }
    return out;
  }

  function aiCard(ai, res) {
    var badge = make("p", "badge pass"), c;
    if (ai.status === "nopower") { badge.className = "badge fail"; badge.textContent = "No power, so nothing to watch"; }
    else if (ai.status === "early") { badge.className = "badge fail"; badge.textContent = "Protection trips before the AI has learned normal"; }
    else if (ai.alertT !== null && res.tripTime !== null) badge.textContent = "AI warns " + fmtTime(res.tripTime - ai.alertT) + " before the protection trips";
    else if (ai.alertT !== null) badge.textContent = "AI alert raised; the protection never trips";
    else if (res.tripTime !== null) { badge.className = "badge fail"; badge.textContent = "AI raised no alert before the trip"; }
    else badge.textContent = "No alert and no trip: all steady";
    c = card("6 · AI early warning", [
      ["Learned normal from", ai.status === "ok" ? "first " + fmtTime(ai.nb * res.dt) + " (assumed healthy)" : "-"],
      ["AI alert", ai.alertT !== null ? fmtTime(ai.alertT) + ": " + ai.cause : "none"],
      ["Protection trip", res.tripTime === null ? "never" : fmtTime(res.tripTime)]
    ], badge);
    c.appendChild(make("p", "fine", "Same detector as the bench rig: 3 readings in a row outside normal. Tolerance here is the larger of 3 × spread and 5 %, because this is a different machine."));
    return c;
  }

  function render(res) {
    var s = res.first, st = el.stages;
    st.textContent = "";

    st.appendChild(card("1 · Pipeline", [
      ["Flow", state.Q0 === state.Q1 ? trimNum(state.Q0, 5) + " m³/s" : trimNum(state.Q0, 5) + " to " + trimNum(state.Q1, 5) + " m³/s"],
      ["Pressure drop", fmtGrouped(s.dP) + " Pa"],
      ["Hydraulic power", fmtPower(s.Phyd), "big"]
    ]));
    st.appendChild(card("2 · Turbine", [
      ["Mechanical power", fmtPower(s.Pm), "big"],
      ["Torque", s.torque.toFixed(1) + " N·m"],
      ["Speed", s.w.toFixed(1) + " rad/s"]
    ]));
    st.appendChild(card("3 · Generator", [
      ["Electrical power", fmtPower(s.Pg), "big"],
      ["Voltage", s.V.toFixed(1) + " V"],
      ["Current", s.I.toFixed(1) + " A"]
    ]));

    var badge = make("p", "badge " + (res.tripTime === null ? "pass" : "fail"));
    badge.textContent = res.tripTime === null ? "Never trips: power passes through all run" :
      (res.tripTime === 0 ? "Tripped from the start: output is 0" : "Trips at " + fmtTime(res.tripTime) + ": output falls to 0");
    var prot = card("4 · Protection", [], badge);
    var ul = make("ul", "checks");
    var c0 = s.checks;
    ul.appendChild(checkRow(c0.flow, "Flow " + trimNum(state.Q0, 5) + " vs minimum " + trimNum(state.Qmin, 5) + " m³/s"));
    ul.appendChild(checkRow(c0.pressure, "Inlet pressure " + fmtGrouped(state.Pin) + " vs minimum " + fmtGrouped(state.Pmin) + " Pa"));
    ul.appendChild(checkRow(c0.voltage, "Voltage " + s.V.toFixed(1) + " vs maximum " + trimNum(state.Vmax, 2) + " V"));
    ul.appendChild(checkRow(c0.current, "Current " + s.I.toFixed(1) + " vs maximum " + trimNum(state.Imax, 2) + " A"));
    prot.insertBefore(ul, prot.querySelector(".vals"));
    prot.querySelector(".vals").remove();
    var note = make("p", "fine", "Checks shown at the start of the run.");
    if (res.tripChecks) {
      var why = [];
      if (!res.tripChecks.flow) why.push("flow below minimum");
      if (!res.tripChecks.pressure) why.push("inlet pressure below minimum");
      if (!res.tripChecks.voltage) why.push("voltage above maximum");
      if (!res.tripChecks.current) why.push("current above maximum");
      note.textContent = "First trip cause: " + why.join(", ") + ". Output is off for " + Math.round(res.offFraction * 100) + "% of the run.";
    }
    prot.appendChild(note);
    st.appendChild(prot);

    var bat = card("5 · Energy and battery", [
      ["Energy generated", res.endE.toFixed(3) + " kWh", "big"],
      ["Battery at end", res.endSOC.toFixed(1) + "% (" + (res.endSOC * state.cap / 100).toFixed(4) + " kWh)"],
      ["Lowest to highest", res.minSOC.toFixed(1) + "% to " + res.maxSOC.toFixed(1) + "%"],
      ["Charging power", Math.max(res.chargeAtStart, 0).toFixed(1) + " W"],
      ["DC load at 12 V", (state.load / 12).toFixed(2) + " A"]
    ]);
    var avail = Math.max(s.Pg - state.load, 0);
    if ((res.tripTime === null || res.tripTime > 0) && avail > state.maxChg) {
      bat.appendChild(make("p", "fine", "The battery takes at most " + trimNum(state.maxChg, 1) + " W, so most of the generator output is counted as energy but not stored."));
    }
    if (res.endSOC <= 0.05) bat.appendChild(make("p", "fine warn", "The battery runs flat before the end of the run."));
    st.appendChild(bat);
    var ai = aiWatch(res);
    res.aiT = ai ? ai.alertT : null;
    if (ai) st.appendChild(aiCard(ai, res));

    var warn = [];
    if (state.Pout >= state.Pin) warn.push("Outlet pressure is not below inlet pressure, so there is no pressure drop and no power.");
    if (state.tOff > state.T) warn.push("The generator stays available for the whole run.");
    showBanner("note", warn.join(" "));
    draw(res);
  }

  /* ---------- charts ---------- */
  function themeColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, d) { var x = cs.getPropertyValue(n).trim(); return x || d; }
    return { ink: v("--ink", "#0f2a33"), muted: v("--muted", "#4d6670"), line: v("--line", "#d3e0e0"), accent: v("--accent", "#0a7a80"), bad: v("--bad", "#c0392b"), card: v("--card", "#fff") };
  }

  function niceMax(x) {
    if (x <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
    var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return n * p;
  }

  function drawChart(canvas, cfg) {
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c = themeColors(), L = 52, R = 14, Tp = 12, B = 44, pw = W - L - R, ph = H - Tp - B;
    g.clearRect(0, 0, W, H);
    g.font = "12px 'IBM Plex Sans', system-ui, sans-serif";
    var tMax = cfg.t[cfg.t.length - 1] || 1, inMin = tMax >= 600, xs = inMin ? 60 : 1;
    var yMax = cfg.yMax != null ? cfg.yMax : niceMax(Math.max.apply(null, cfg.series.map(function (s) { return Math.max.apply(null, s.y); })) * 1.08);
    var yMin = cfg.yMin || 0;
    function X(t) { return L + (t / tMax) * pw; }
    function Y(v) { return Tp + ph - ((v - yMin) / (yMax - yMin)) * ph; }
    g.strokeStyle = c.line; g.fillStyle = c.muted; g.lineWidth = 1; g.textBaseline = "middle"; g.textAlign = "right";
    for (var i = 0; i <= 4; i++) {
      var v = yMin + (yMax - yMin) * i / 4, y = Y(v);
      g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke();
      g.fillText(cfg.fmt ? cfg.fmt(v) : trimNum(v, 2), L - 6, y);
    }
    g.textAlign = "center"; g.textBaseline = "top";
    for (var j = 0; j <= 4; j++) {
      var tv = tMax * j / 4;
      g.fillText(trimNum(tv / xs, 1), X(tv), Tp + ph + 8);
    }
    g.textAlign = "center"; g.fillText("Time (" + (inMin ? "min" : "s") + ")", L + pw / 2, Tp + ph + 26);
    (cfg.markers || []).forEach(function (m) {
      if (m.t == null || m.t < 0 || m.t > tMax) return;
      g.strokeStyle = c.bad; g.setLineDash([4, 3]); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(X(m.t), Tp); g.lineTo(X(m.t), Tp + ph); g.stroke(); g.setLineDash([]);
      g.fillStyle = c.ink; g.textBaseline = "top"; g.textAlign = X(m.t) > L + pw * 0.7 ? "right" : "left";
      g.fillText(m.label, X(m.t) + (g.textAlign === "left" ? 5 : -5), Tp + 2 + (m.row || 0) * 15);
    });
    cfg.series.forEach(function (s) {
      g.strokeStyle = s.color === "accent" ? c.accent : c.muted; g.lineWidth = s.w || 2; g.lineJoin = "round";
      g.setLineDash(s.dash || []); g.beginPath();
      s.y.forEach(function (val, idx) { var px = X(cfg.t[idx]), py = Y(val); if (idx === 0) g.moveTo(px, py); else g.lineTo(px, py); });
      g.stroke(); g.setLineDash([]);
    });
    var last = cfg.series[0], lv = last.y[last.y.length - 1];
    g.fillStyle = c.accent; g.beginPath(); g.arc(X(tMax), Y(lv), 3.5, 0, 6.283); g.fill();
    g.fillStyle = c.ink; g.textAlign = "right"; g.textBaseline = lv > (yMax + yMin) / 2 ? "top" : "bottom";
    g.fillText((cfg.fmt ? cfg.fmt(lv) : trimNum(lv, 2)) + (cfg.unit ? " " + cfg.unit : ""), X(tMax) - 6, Y(lv) + (g.textBaseline === "top" ? 6 : -6));
  }

  function draw(res) {
    if (!res) return;
    var t = res.t;
    var offMark = state.tOff < state.T ? { t: state.tOff, label: "generator off", row: 1 } : null;
    var tripMark = res.tripTime !== null && res.tripTime > 0 ? { t: res.tripTime, label: "trip", row: 0 } : null;
    var aiMark = res.aiT != null ? { t: res.aiT, label: "AI alert", row: 2 } : null;
    var markers = [tripMark, offMark, aiMark].filter(Boolean);
    var kw = res.Pprot.map(function (x) { return x / 1000; }), kwRaw = res.Pgen.map(function (x) { return x / 1000; });
    drawChart(el.c1, { t: t, series: [{ y: kw, color: "accent" }, { y: kwRaw, color: "muted", w: 1.5, dash: [5, 3] }], fmt: function (v) { return trimNum(v, 2); }, unit: "kW", markers: [tripMark, aiMark].filter(Boolean) });
    drawChart(el.c2, { t: t, series: [{ y: res.SOC, color: "accent" }], yMin: 0, yMax: 100, fmt: function (v) { return trimNum(v, 1); }, unit: "%", markers: markers });
    drawChart(el.c3, { t: t, series: [{ y: res.E, color: "accent" }], fmt: function (v) { return trimNum(v, 2); }, unit: "kWh", markers: [tripMark, aiMark].filter(Boolean) });
    el.c1.setAttribute("aria-label", "Electrical power over the run. Starts at " + fmtPower(res.first.Pg) + (res.tripTime === null ? " and never trips." : " and trips at " + fmtTime(res.tripTime) + "."));
    el.c2.setAttribute("aria-label", "Battery state of charge. Starts at " + trimNum(state.soc0, 1) + "% and ends at " + res.endSOC.toFixed(1) + "%.");
    el.c3.setAttribute("aria-label", "Total generated energy rising to " + res.endE.toFixed(3) + " kilowatt-hours.");
  }

  function run() {
    lastResult = M.simulate(state);
    render(lastResult);
  }

  /* ---------- CSV ---------- */
  function toCsv(res) {
    var rows = ["time_s,flow_m3s,power_unprotected_W,power_to_bus_W,energy_kWh,battery_power_W,battery_soc_pct"];
    var step = Math.max(1, Math.floor(res.N / 600));
    for (var i = 0; i <= res.N; i += step) {
      rows.push([res.t[i].toFixed(1), res.Q[i].toFixed(5), res.Pgen[i].toFixed(2), res.Pprot[i].toFixed(2), res.E[i].toFixed(5), res.Pbat[i].toFixed(2), res.SOC[i].toFixed(3)].join(","));
    }
    return rows.join("\n") + "\n";
  }

  /* ---------- wire up ---------- */
  function init() {
    el.banner = root.querySelector("#try-banner");
    el.stages = root.querySelector("#try-stages");
    el.c1 = root.querySelector("#ch-power"); el.c2 = root.querySelector("#ch-soc"); el.c3 = root.querySelector("#ch-energy");
    el.status = root.querySelector("#try-status");
    buildInputs();
    root.querySelectorAll("[data-preset]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = PRESETS[b.dataset.preset];
        setAll(p.set);
        root.querySelectorAll("[data-preset]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      });
    });
    root.querySelector("[data-preset='base']").setAttribute("aria-pressed", "true");
    run();

    var redraw = function () { if (lastResult) draw(lastResult); };
    window.addEventListener("resize", redraw);
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (window.matchMedia) { try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw); } catch (e) {} }
    document.addEventListener("hydro:opened", redraw);

    var csvBtn = root.querySelector("#try-csv");
    csvBtn.hidden = false;
    csvBtn.addEventListener("click", function () {
      if (!lastResult) return;
      try {
        var blob = new Blob([toCsv(lastResult)], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = "hydrokinetic_results.csv";
        document.body.appendChild(a); a.click(); a.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        el.status.textContent = "Saved.";
      } catch (e) { el.status.textContent = "Could not save the file in this browser."; }
    });
  }
  init();
})();
