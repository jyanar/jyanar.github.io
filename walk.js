/* A random walk that begins below the text and wanders wherever it likes.
 * Past walks are remembered in localStorage and stamped in faded gray.
 *
 * The walk style is pluggable. Pick one by setting ACTIVE below, or override
 * live from the URL without editing this file, e.g.:
 *     ?walk=levy               choose a variant by name
 *     ?walk=levy&alpha=1.4     override any numeric knob of that variant
 *     ?walk=correlated&turn=0.8
 * Each variant keeps its own separate gray history. */

(function () {
  'use strict';

  var YELLOW = '#ffd94a';
  var GRAY = 'rgba(150, 152, 157, 0.30)';
  var MAX_STORED_WALKS = 15;   // gray stamps kept around
  var MAX_STORED_POINTS = 4000;

  /* ---- Walk variants. Swap ACTIVE to change the default. ---- */
  var ACTIVE = 'levy';
  var VARIANTS = {
    // Correlated random walk: fixed step length, gently drifting heading.
    // Smooth and organic; never makes sharp jumps.
    correlated: {
      kind: 'correlated',
      step: 2.0,          // px per step
      turn: 1.0,         // max heading change per step (radians)
      stepsPerSecond: 120
    },
    // Levy flight: direction uniform on [0, 2pi); step length is the magnitude
    // of a draw from a stable distribution S(alpha, beta).
    //   alpha = 2, beta = 0  ->  Gaussian steps (ordinary Brownian motion).
    //   alpha < 2            ->  heavy tails: mostly small steps, rare long jumps.
    levy: {
      kind: 'levy',
      alpha: 1.7,         // stability in (0, 2]
      beta: 0.0,          // skewness in [-1, 1] (no effect when alpha == 2)
      scale: 2.0,         // step-length multiplier
      maxStep: 300,       // clamp on a single jump (px)
      stepsPerSecond: 120
    },
    // Lattice walk: each step is a fixed distance in one of the four cardinal
    // directions (N/S/E/W), chosen uniformly. Retraces itself into a grid.
    grid: {
      kind: 'grid',
      step: 13,           // px per step (fixed, on-lattice)
      stepsPerSecond: 30
    }
  };

  var cfg = resolveConfig();
  var KEY = 'jy-walks-' + cfg.name;
  var STARTED_KEY = 'jy-walk-started';

  var OBSTACLE_PAD = 6;           // px of breathing room around each element
  var OBSTACLE_SELECTOR = 'h1, h2, h3, p, img, footer, li';

  var canvas, ctx, dot;
  var anchorX = 0, anchorY = 0;   // walk origin, document coords
  var pastWalks = [];             // as loaded at page start
  var points = [[0, 0]];          // current walk, offsets from anchor
  var heading = Math.random() * Math.PI * 2;  // used by the correlated variant
  var px = 0, py = 0;
  var obstacles = [];             // boxes to bounce off, anchor-relative coords

  /* Merge the chosen variant with any numeric ?param overrides from the URL. */
  function resolveConfig() {
    var q = null;
    try { q = new URLSearchParams(window.location.search); } catch (e) {}
    var name = (q && q.get('walk')) || ACTIVE;
    if (!VARIANTS[name]) name = ACTIVE;
    var base = VARIANTS[name];
    var c = { name: name };
    for (var k in base) c[k] = base[k];
    if (q) {
      ['alpha', 'beta', 'scale', 'maxStep', 'step', 'turn', 'stepsPerSecond']
        .forEach(function (key) {
          var v = q.get(key);
          if (v !== null && v !== '' && !isNaN(parseFloat(v))) c[key] = parseFloat(v);
        });
    }
    return c;
  }

  /* Chambers-Mallows-Stuck sampler for a standardized stable distribution.
   * At alpha == 2 this reduces to a Gaussian with standard deviation sqrt(2). */
  function sampleStable(alpha, beta) {
    var U = (Math.random() - 0.5) * Math.PI;   // uniform on (-pi/2, pi/2)
    var W = -Math.log(Math.random());          // exponential, mean 1
    if (Math.abs(alpha - 1) < 1e-8) {
      var hp = Math.PI / 2;
      return (2 / Math.PI) * ((hp + beta * U) * Math.tan(U)
        - beta * Math.log((hp * W * Math.cos(U)) / (hp + beta * U)));
    }
    var z = beta * Math.tan(Math.PI * alpha / 2);
    var B = Math.atan(z) / alpha;
    var S = Math.pow(1 + z * z, 1 / (2 * alpha));
    return S * Math.sin(alpha * (U + B)) / Math.pow(Math.cos(U), 1 / alpha)
      * Math.pow(Math.cos(U - alpha * (U + B)) / W, (1 - alpha) / alpha);
  }

  /* One increment [dx, dy] according to the active variant. */
  function nextDelta() {
    if (cfg.kind === 'levy') {
      var theta = Math.random() * Math.PI * 2;
      var len = Math.abs(sampleStable(cfg.alpha, cfg.beta)) * cfg.scale;
      if (len > cfg.maxStep) len = cfg.maxStep;
      return [Math.cos(theta) * len, Math.sin(theta) * len];
    }
    if (cfg.kind === 'grid') {
      var s = cfg.step;
      switch (Math.floor(Math.random() * 4)) {
        case 0: return [s, 0];    // E
        case 1: return [-s, 0];   // W
        case 2: return [0, s];    // S
        default: return [0, -s];  // N
      }
    }
    // correlated
    heading += (Math.random() - 0.5) * 2 * cfg.turn;
    return [Math.cos(heading) * cfg.step, Math.sin(heading) * cfg.step];
  }

  function loadPast() {
    try { pastWalks = JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { pastWalks = []; }
    if (!Array.isArray(pastWalks)) pastWalks = [];
  }

  function savePast() {
    if (points.length < 20) return;   // ignore walks that barely started
    var pts = points;
    if (pts.length > MAX_STORED_POINTS) {
      var keepEvery = Math.ceil(pts.length / MAX_STORED_POINTS);
      var sampled = [];
      for (var i = 0; i < pts.length; i += keepEvery) sampled.push(pts[i]);
      pts = sampled;
    }
    var walks = pastWalks.concat([pts]).slice(-MAX_STORED_WALKS);
    try { localStorage.setItem(KEY, JSON.stringify(walks)); } catch (e) {}
  }

  function computeAnchor() {
    var el = document.getElementById('walk-anchor');
    var r = el.getBoundingClientRect();
    anchorX = r.left + r.width / 2 + window.scrollX;
    anchorY = r.top + r.height / 2 + window.scrollY;
  }

  /* Snapshot the boxes the walk should avoid, in the same anchor-relative
   * coordinates the walk points live in. Recomputed on resize since reflow
   * moves everything around. */
  function computeObstacles() {
    obstacles = [];
    var els = document.querySelectorAll(OBSTACLE_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      obstacles.push({
        x0: r.left + window.scrollX - anchorX - OBSTACLE_PAD,
        y0: r.top + window.scrollY - anchorY - OBSTACLE_PAD,
        x1: r.right + window.scrollX - anchorX + OBSTACLE_PAD,
        y1: r.bottom + window.scrollY - anchorY + OBSTACLE_PAD
      });
    }
  }

  /* First obstacle containing (x, y), or null. Coords are anchor-relative. */
  function obstacleAt(x, y) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1) return o;
    }
    return null;
  }

  /* Take one step from (cx, cy). If it would land inside an obstacle, reflect
   * the step off whichever face(s) it crossed and try the mirrored landing;
   * if that is still blocked, hold position for this step. Returns [nx, ny]. */
  function advance(cx, cy) {
    var d = nextDelta();
    var nx = cx + d[0], ny = cy + d[1];
    var hit = obstacleAt(nx, ny);
    if (hit) {
      var flipX = !(cx > hit.x0 && cx < hit.x1);   // entered along the x axis
      var flipY = !(cy > hit.y0 && cy < hit.y1);   // entered along the y axis
      if (!flipX && !flipY) { flipX = true; flipY = true; }
      if (flipX) { d[0] = -d[0]; if (cfg.kind === 'correlated') heading = Math.PI - heading; }
      if (flipY) { d[1] = -d[1]; if (cfg.kind === 'correlated') heading = -heading; }
      nx = cx + d[0];
      ny = cy + d[1];
      if (obstacleAt(nx, ny)) { nx = cx; ny = cy; }
    }
    return [nx, ny];
  }

  function drawWalk(pts, color, width, glow) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(anchorX + pts[0][0], anchorY + pts[0][1]);
    for (var i = 1; i < pts.length; i++) {
      ctx.lineTo(anchorX + pts[i][0], anchorY + pts[i][1]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = glow ? 7 : 0;
    ctx.shadowColor = glow ? color : 'transparent';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function redrawAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < pastWalks.length; i++) {
      drawWalk(pastWalks[i], GRAY, 1.2, false);
    }
    drawWalk(points, YELLOW, 1.6, false);
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var w = document.documentElement.clientWidth;
    var h = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeAnchor();
    computeObstacles();
    redrawAll();
  }

  function moveDot() {
    dot.style.transform =
      'translate(' + (anchorX + px) + 'px,' + (anchorY + py) + 'px) translate(-50%, -50%)';
  }

  function stepOnce() {
    var n = advance(px, py);
    var nx = n[0];
    var ny = n[1];
    ctx.beginPath();
    ctx.moveTo(anchorX + px, anchorY + py);
    ctx.lineTo(anchorX + nx, anchorY + ny);
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.stroke();
    px = nx;
    py = ny;
    points.push([Math.round(nx), Math.round(ny)]);
  }

  var lastTime = 0, stepBudget = 0;
  function tick(now) {
    // Advance by real elapsed time so the speed is the same on any display
    // refresh rate. stepsPerSecond is the intuitive knob; fractions are fine.
    var dt = lastTime ? (now - lastTime) / 1000 : 0;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;   // clamp bursts after the tab was backgrounded
    stepBudget += cfg.stepsPerSecond * dt;
    while (stepBudget >= 1) { stepOnce(); stepBudget -= 1; }
    moveDot();
    requestAnimationFrame(tick);
  }

  function init() {
    var anchorEl = document.getElementById('walk-anchor');
    if (!anchorEl) return;

    canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;top:0;left:0;z-index:-1;pointer-events:none;';
    ctx = canvas.getContext('2d');
    document.body.appendChild(canvas);

    dot = document.createElement('div');
    dot.style.cssText =
      'position:absolute;top:0;left:0;width:5px;height:5px;border-radius:50%;' +
      'background:' + YELLOW + ';' +
      'z-index:-1;pointer-events:none;display:none;';
    document.body.appendChild(dot);

    loadPast();
    resize();

    window.addEventListener('resize', resize);
    window.addEventListener('pagehide', savePast);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') savePast();
    });

    var trigger = document.getElementById('walk-trigger');
    if (trigger) {
      var started = false;
      try { started = localStorage.getItem(STARTED_KEY) === 'true'; } catch (e) {}
      
      if (started) {
        trigger.remove();
        startWalk();
      } else {
        trigger.addEventListener('click', function (e) {
          e.preventDefault();
          trigger.remove();
          try { localStorage.setItem(STARTED_KEY, 'true'); } catch (e) {}
          startWalk();
        });
      }
    } else {
      startWalk();
    }
  }

  function startWalk() {
    dot.style.display = '';
    moveDot();

    if (window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // No animation: lay down a finished walk immediately.
      for (var i = 0; i < 1500; i++) {
        var n = advance(px, py);
        px = n[0];
        py = n[1];
        points.push([Math.round(px), Math.round(py)]);
      }
      redrawAll();
      moveDot();
      return;
    }

    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
