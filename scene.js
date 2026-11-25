/* Landing behaviour: hero fades with scroll, options slide in as they enter the screen. */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hero = document.getElementById("hero"), cue = document.getElementById("cue");

  if (cue) cue.addEventListener("click", function () {
    var t = document.getElementById("explore");
    if (t) t.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  });

  if (hero && !reduce) {
    var ticking = false;
    var update = function () {
      var h = hero.offsetHeight || window.innerHeight || 1;
      var p = Math.min(1, Math.max(0, (window.pageYOffset || document.documentElement.scrollTop || 0) / (h * 0.6)));
      hero.style.setProperty("--p", p.toFixed(3));
      ticking = false;
    };
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  var targets = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (reduce || !("IntersectionObserver" in window)) return;       // everything stays visible
  document.documentElement.classList.add("js-reveal");
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  targets.forEach(function (t) { io.observe(t); });

  // Safety net: anything already on screen after load is shown even if the observer is slow.
  window.setTimeout(function () {
    targets.forEach(function (t) { if (!t.classList.contains("in") && t.getBoundingClientRect().top < window.innerHeight) t.classList.add("in"); });
  }, 2500);

  // A link such as #ai opens that section and brings it into view.
  var id = (location.hash || "").slice(1), item = id && document.querySelector('.item[data-id="' + id + '"]');
  if (item) { item.classList.add("in"); window.setTimeout(function () { item.scrollIntoView({ block: "start" }); }, 60); }
})();
