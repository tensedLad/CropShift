// Edit PDF: in-browser PDF editor.
//  - pdf.js renders each page; a transparent overlay canvas holds the edits.
//  - Edits live in PDF user space, so they survive zoom and page rotation and
//    are written back into the original PDF with pdf-lib (text stays text,
//    original content stays vector/selectable).
//
// Box objects (text, rect, whiteout, image) use a local frame anchored at
// their top-left corner `o` with angle `theta` (baseline direction in PDF
// space). Local x runs along the baseline, local y runs "down" the page.
//   pdf = o + lx * (cos t, sin t) + ly * (sin t, -cos t)

(function () {
  "use strict";

  const MAX_FILE_BYTES = 200 * 1024 * 1024;
  const MAX_RENDER_PIXELS = 16 * 1000 * 1000;
  const LINE = 1.2;
  const HIGHLIGHT_OPACITY = 0.35;
  const HISTORY_LIMIT = 100;
  const FONTS = {
    helv: { css: 'Helvetica, Arial, "Liberation Sans", sans-serif', asc: 0.93, std: ["Helvetica", "HelveticaBold"] },
    times: { css: '"Times New Roman", Times, "Liberation Serif", serif', asc: 0.92, std: ["TimesRoman", "TimesRomanBold"] },
    courier: { css: '"Courier New", Courier, "Liberation Mono", monospace', asc: 0.87, std: ["Courier", "CourierBold"] }
  };
  const SWATCHES = ["#111827", "#1d4ed8", "#dc2626", "#16a34a", "#facc15", "#ffffff"];
  const SIZE_LABEL = { text: "Font", draw: "Width", highlight: "Width", rect: "Border" };

  const S = {
    file: null,
    bytes: null,
    pdf: null,
    pages: [],
    zoom: 1,
    fitMode: true,
    tool: "select",
    colors: { text: "#111827", draw: "#1d4ed8", highlight: "#facc15", rect: "#dc2626" },
    sizes: { text: 14, draw: 2, highlight: 14, rect: 2 },
    font: "helv",
    bold: false,
    sel: null, // { page, obj }
    images: new Map(),
    seq: 0,
    undo: [],
    redo: [],
    dirty: false,
    action: null,
    editing: null,
    queue: [],
    pumping: false,
    io: null,
    busy: false
  };
  const el = {};
  const measureCtx = document.createElement("canvas").getContext("2d");

  document.addEventListener("DOMContentLoaded", init);

  // =====================================================================
  // Setup
  // =====================================================================
  function init() {
    [
      "peFileLabel",
      "peStatus",
      "peFileInput",
      "peImageInput",
      "peStart",
      "peDropzone",
      "peEditor",
      "peTools",
      "peStyleGroup",
      "peSwatches",
      "peColor",
      "peSize",
      "peSizeLabel",
      "peFont",
      "peBold",
      "peUndo",
      "peRedo",
      "peDelete",
      "peZoomOut",
      "peZoomFit",
      "peZoomLabel",
      "peZoomIn",
      "peOpenBtn",
      "peSaveImgBtn",
      "peSaveBtn",
      "peScroll",
      "pePages",
      "peSigModal",
      "peSigClose",
      "peSigMode",
      "peSigDrawPanel",
      "peSigTypePanel",
      "peSigPad",
      "peSigName",
      "peSigFonts",
      "peSigTypePreview",
      "peSigColors",
      "peSigClear",
      "peSigUse"
    ].forEach((id) => (el[id] = document.getElementById(id)));

    CS.bindFileIntake({
      zone: el.peDropzone,
      input: el.peFileInput,
      accept: (f) => CS.isPdfFile(f) || (S.pdf && CS.isImageFile(f)),
      onFiles: (files) => {
        const f = files[0];
        if (CS.isPdfFile(f)) confirmDiscard() && openFile(f);
        else insertImageFile(f);
      },
      onReject: () => CS.setBadge(el.peStatus, "Please choose a PDF file.", "error")
    });
    el.peOpenBtn.addEventListener("click", () => el.peFileInput.click());

    el.peSwatches.innerHTML = SWATCHES.map(
      (c) =>
        '<button type="button" class="pe-swatch" data-color="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '" title="' + c + '"></button>'
    ).join("");
    el.peSwatches.addEventListener("click", (e) => {
      const b = e.target.closest("[data-color]");
      if (b) setColor(b.dataset.color);
    });
    el.peColor.addEventListener("input", () => setColor(el.peColor.value));

    el.peTools.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tool]");
      if (b) setTool(b.dataset.tool);
    });
    el.peSize.addEventListener("change", onSizeChange);
    el.peFont.addEventListener("change", () => {
      S.font = el.peFont.value;
      applyToSelection((o) => o.type === "text" && (o.font = S.font));
    });
    el.peBold.addEventListener("click", () => {
      S.bold = !S.bold;
      el.peBold.setAttribute("aria-pressed", S.bold ? "true" : "false");
      applyToSelection((o) => o.type === "text" && (o.bold = S.bold));
    });

    el.peUndo.addEventListener("click", undo);
    el.peRedo.addEventListener("click", redo);
    el.peDelete.addEventListener("click", deleteSelection);
    el.peZoomIn.addEventListener("click", () => setZoom(S.zoom * 1.2));
    el.peZoomOut.addEventListener("click", () => setZoom(S.zoom / 1.2));
    el.peZoomFit.addEventListener("click", () => {
      S.fitMode = true;
      setZoom(fitZoom());
    });
    el.peSaveBtn.addEventListener("click", savePdf);
    el.peSaveImgBtn.addEventListener("click", saveImages);

    el.peImageInput.addEventListener("change", () => {
      const f = el.peImageInput.files && el.peImageInput.files[0];
      el.peImageInput.value = "";
      if (f) insertImageFile(f);
    });

    el.pePages.addEventListener("click", onPageBarClick);
    document.addEventListener("keydown", onKeyDown);

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (S.pdf && S.fitMode) setZoom(fitZoom(), true);
      }, 150);
    });

    window.addEventListener("beforeunload", (e) => {
      if (S.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    initSignature();
    syncStyleControls();
  }

  function confirmDiscard() {
    return !S.dirty || window.confirm("Discard your unsaved edits and open another PDF?");
  }

  // =====================================================================
  // Opening a PDF
  // =====================================================================
  async function openFile(file) {
    if (S.busy) return;
    if (file.size > MAX_FILE_BYTES) {
      CS.setBadge(el.peStatus, "File is too large (max " + CS.formatBytes(MAX_FILE_BYTES) + ").", "error");
      return;
    }
    S.busy = true;
    CS.setBadge(el.peStatus, "Opening PDF…", "working");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await CS.openPdfLib(bytes); // validates encryption/damage up front
      const pdf = await CS.openPdfJs(bytes);

      teardown();
      S.file = file;
      S.bytes = bytes;
      S.pdf = pdf;
      S.undo = [];
      S.redo = [];
      S.dirty = false;
      S.sel = null;
      S.images = new Map();

      for (let n = 1; n <= pdf.numPages; n++) {
        if (n % 20 === 0) CS.setBadge(el.peStatus, "Reading page " + n + " of " + pdf.numPages + "…", "working");
        const pg = await pdf.getPage(n);
        const p = { num: n, pg, rotate: pg.rotate || 0, extraRot: 0, deleted: false, objects: [], near: false, renderedZoom: 0 };
        buildPageDom(p);
        S.pages.push(p);
      }

      el.peFileLabel.textContent = "· " + file.name;
      el.peStart.classList.add("is-hidden");
      el.peEditor.classList.remove("is-hidden");

      S.io = new IntersectionObserver(onIntersect, { root: el.peScroll, rootMargin: "1200px 0px" });
      S.pages.forEach((p) => S.io.observe(p.wrap));
      S.fitMode = true;
      setZoom(fitZoom(), true);
      el.peScroll.scrollTop = 0;
      updateHistoryButtons();
      CS.setBadge(el.peStatus, pdf.numPages + " page" + (pdf.numPages === 1 ? "" : "s") + " · pick a tool", "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.peStatus, err.message || "Could not open this PDF.", "error");
    } finally {
      S.busy = false;
    }
  }

  function teardown() {
    cancelEdit();
    if (S.io) S.io.disconnect();
    S.io = null;
    S.queue = [];
    if (S.pdf) S.pdf.destroy();
    S.pdf = null;
    S.pages = [];
    el.pePages.innerHTML = "";
  }

  function buildPageDom(p) {
    const wrap = document.createElement("div");
    wrap.className = "pe-page-wrap";
    wrap.dataset.num = String(p.num);
    wrap.innerHTML =
      '<div class="pe-page-bar">' +
      '<span class="pe-page-name">Page ' + p.num + "</span>" +
      '<span class="pe-page-actions">' +
      '<button type="button" class="icon-btn" data-page-act="rotl" aria-label="Rotate page ' + p.num + ' left" title="Rotate page left"><span class="material-symbols-outlined" aria-hidden="true">rotate_left</span></button>' +
      '<button type="button" class="icon-btn" data-page-act="rotr" aria-label="Rotate page ' + p.num + ' right" title="Rotate page right"><span class="material-symbols-outlined" aria-hidden="true">rotate_right</span></button>' +
      '<button type="button" class="icon-btn is-danger" data-page-act="del" aria-label="Remove page ' + p.num + '" title="Remove page"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>' +
      "</span></div>" +
      '<div class="pe-page">' +
      '<canvas class="pe-base" aria-hidden="true"></canvas>' +
      '<canvas class="pe-overlay" aria-label="Page ' + p.num + ' editing surface"></canvas>' +
      '<div class="pe-deleted-mask is-hidden"><span>This page will be removed</span>' +
      '<button type="button" class="action-btn" data-page-act="restore"><span class="material-symbols-outlined" aria-hidden="true">undo</span> Restore page</button></div>' +
      "</div>";
    p.wrap = wrap;
    p.pageEl = wrap.querySelector(".pe-page");
    p.base = wrap.querySelector(".pe-base");
    p.overlay = wrap.querySelector(".pe-overlay");
    p.mask = wrap.querySelector(".pe-deleted-mask");
    p.overlay.addEventListener("pointerdown", (e) => onPointerDown(e, p));
    p.overlay.addEventListener("pointermove", (e) => onPointerMove(e, p));
    p.overlay.addEventListener("pointerup", (e) => onPointerUp(e, p));
    p.overlay.addEventListener("pointercancel", (e) => onPointerUp(e, p));
    p.overlay.addEventListener("dblclick", (e) => onDoubleClick(e, p));
    el.pePages.appendChild(wrap);
  }

  // =====================================================================
  // Layout, zoom & rendering
  // =====================================================================
  function dpr() {
    return Math.min(3, window.devicePixelRatio || 1);
  }

  function rotationOf(p) {
    return (((p.rotate + p.extraRot) % 360) + 360) % 360;
  }

  function viewportFor(p, scale) {
    return p.pg.getViewport({ scale, rotation: rotationOf(p) });
  }

  function fitZoom() {
    const avail = Math.max(200, el.peScroll.clientWidth - 40);
    let widest = 0;
    S.pages.forEach((p) => {
      const vp = viewportFor(p, 1);
      widest = Math.max(widest, vp.width);
    });
    return Math.min(2.5, avail / (widest || 612));
  }

  function setZoom(z, keepFit) {
    if (!S.pages.length) return;
    if (!keepFit) S.fitMode = false;
    commitEdit();
    const zoom = Math.min(5, Math.max(0.2, z));
    const sc = el.peScroll;
    const ratio = sc.scrollHeight > 0 ? (sc.scrollTop + sc.clientHeight / 2) / sc.scrollHeight : 0;
    S.zoom = zoom;
    S.pages.forEach(layoutPage);
    sc.scrollTop = ratio * sc.scrollHeight - sc.clientHeight / 2;
    el.peZoomLabel.textContent = Math.round((zoom / (96 / 72)) * 100) + "%";
    S.pages.forEach((p) => {
      if (p.near) {
        drawOverlay(p);
        schedule(p);
      }
    });
  }

  function layoutPage(p) {
    p.vp = viewportFor(p, S.zoom);
    const w = Math.round(p.vp.width);
    const h = Math.round(p.vp.height);
    p.cssW = w;
    p.cssH = h;
    p.pageEl.style.width = w + "px";
    p.pageEl.style.height = h + "px";
    p.base.style.width = w + "px";
    p.base.style.height = h + "px";
    p.overlay.style.width = w + "px";
    p.overlay.style.height = h + "px";
  }

  function onIntersect(entries) {
    entries.forEach((entry) => {
      const p = S.pages.find((pg) => pg.wrap === entry.target);
      if (!p) return;
      p.near = entry.isIntersecting;
      if (p.near) {
        drawOverlay(p);
        schedule(p);
      } else {
        release(p);
      }
    });
  }

  function schedule(p) {
    if (p.renderedZoom === S.zoom && p.renderedRot === rotationOf(p)) return;
    if (!S.queue.includes(p)) S.queue.push(p);
    pump();
  }

  async function pump() {
    if (S.pumping) return;
    S.pumping = true;
    try {
      while (S.queue.length) {
        // Render the page closest to the middle of the viewport first.
        const mid = el.peScroll.scrollTop + el.peScroll.clientHeight / 2;
        S.queue.sort((a, b) => Math.abs(a.wrap.offsetTop - mid) - Math.abs(b.wrap.offsetTop - mid));
        const p = S.queue.shift();
        if (!p.near || !S.pages.includes(p)) continue;
        await renderBase(p);
      }
    } finally {
      S.pumping = false;
    }
  }

  async function renderBase(p) {
    const zoom = S.zoom;
    const rot = rotationOf(p);
    let scale = zoom * dpr();
    const vp1 = viewportFor(p, 1);
    const area = vp1.width * vp1.height * scale * scale;
    if (area > MAX_RENDER_PIXELS) scale *= Math.sqrt(MAX_RENDER_PIXELS / area);
    const vp = viewportFor(p, scale);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      await p.pg.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (err) {
      console.error(err);
      return;
    }
    if (!p.near || !S.pages.includes(p)) return;
    canvas.className = "pe-base";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.width = p.cssW + "px";
    canvas.style.height = p.cssH + "px";
    p.base.replaceWith(canvas);
    p.base = canvas;
    p.renderedZoom = zoom;
    p.renderedRot = rot;
    if (zoom !== S.zoom || rot !== rotationOf(p)) schedule(p);
  }

  function release(p) {
    p.base.width = 0;
    p.base.height = 0;
    p.overlay.width = 0;
    p.overlay.height = 0;
    p.renderedZoom = 0;
    S.queue = S.queue.filter((q) => q !== p);
  }

  // =====================================================================
  // Geometry helpers
  // =====================================================================
  function toPdf(p, x, y) {
    const r = p.vp.convertToPdfPoint(x, y);
    return { x: r[0], y: r[1] };
  }

  function toScreen(p, x, y) {
    const r = p.vp.convertToViewportPoint(x, y);
    return { x: r[0], y: r[1] };
  }

  function eventPoint(e, p) {
    const rect = p.overlay.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Baseline angle (PDF space) that reads left-to-right on screen.
  function screenTheta(p) {
    const a = toPdf(p, 0, 0);
    const b = toPdf(p, 10, 0);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  function localToPdf(o, lx, ly) {
    const c = Math.cos(o.theta);
    const s = Math.sin(o.theta);
    return { x: o.ox + lx * c + ly * s, y: o.oy + lx * s - ly * c };
  }

  function pdfToLocal(o, x, y) {
    const c = Math.cos(o.theta);
    const s = Math.sin(o.theta);
    const dx = x - o.ox;
    const dy = y - o.oy;
    return { x: dx * c + dy * s, y: dx * s - dy * c };
  }

  function cssFont(o) {
    return (o.bold ? "bold " : "") + o.size + "px " + FONTS[o.font || "helv"].css;
  }

  function textLines(o) {
    return String(o.text || "").split("\n");
  }

  // Width / height of a box object in local (pt) units.
  function boxSize(o) {
    if (o.type !== "text") return { w: o.w, h: o.h };
    measureCtx.font = cssFont(o);
    const lines = textLines(o);
    let w = 0;
    lines.forEach((l) => (w = Math.max(w, measureCtx.measureText(l).width)));
    return { w: Math.max(w, o.size * 0.5), h: lines.length * o.size * LINE };
  }

  function hitTest(p, pt) {
    const tol = 5 / S.zoom;
    for (let i = p.objects.length - 1; i >= 0; i--) {
      const o = p.objects[i];
      if (S.editing && S.editing.obj === o) continue;
      if (o.type === "path") {
        const lim = o.width / 2 + tol;
        const pts = o.points;
        for (let k = 0; k < pts.length; k++) {
          const a = pts[k];
          const b = pts[Math.min(k + 1, pts.length - 1)];
          if (distToSegment(pt.x, pt.y, a[0], a[1], b[0], b[1]) <= lim) return o;
        }
      } else {
        const l = pdfToLocal(o, pt.x, pt.y);
        const sz = boxSize(o);
        if (l.x >= -tol && l.y >= -tol && l.x <= sz.w + tol && l.y <= sz.h + tol) return o;
      }
    }
    return null;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function handleHit(p, screenPt) {
    if (!S.sel || S.sel.page !== p || S.sel.obj.type === "path") return false;
    const o = S.sel.obj;
    const sz = boxSize(o);
    const corner = localToPdf(o, sz.w, sz.h);
    const s = toScreen(p, corner.x, corner.y);
    return Math.hypot(s.x - screenPt.x, s.y - screenPt.y) <= 12;
  }

  // =====================================================================
  // Overlay drawing
  // =====================================================================
  function drawOverlay(p) {
    if (!p.near || !p.vp) return;
    const ratio = dpr();
    const w = Math.max(1, Math.round(p.cssW * ratio));
    const h = Math.max(1, Math.round(p.cssH * ratio));
    if (p.overlay.width !== w || p.overlay.height !== h) {
      p.overlay.width = w;
      p.overlay.height = h;
    }
    const ctx = p.overlay.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = p.vp.transform;
    const k = ratio;
    ctx.setTransform(t[0] * k, t[1] * k, t[2] * k, t[3] * k, t[4] * k, t[5] * k);

    p.objects.forEach((o) => {
      if (S.editing && S.editing.obj === o) return;
      drawObject(ctx, o);
    });
    if (S.action && S.action.page === p && S.action.temp) drawObject(ctx, S.action.temp);
    if (S.sel && S.sel.page === p) drawSelection(ctx, S.sel.obj);
  }

  function withBox(ctx, o, fn) {
    ctx.save();
    ctx.translate(o.ox, o.oy);
    ctx.rotate(o.theta);
    ctx.scale(1, -1);
    fn();
    ctx.restore();
  }

  function drawObject(ctx, o) {
    if (o.type === "path") {
      const pts = o.points;
      if (!pts.length) return;
      ctx.save();
      ctx.globalAlpha = o.opacity;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      ctx.restore();
      return;
    }
    withBox(ctx, o, () => {
      if (o.type === "text") {
        ctx.font = cssFont(o);
        ctx.fillStyle = o.color;
        ctx.textBaseline = "alphabetic";
        const asc = FONTS[o.font || "helv"].asc;
        textLines(o).forEach((line, i) => ctx.fillText(line, 0, o.size * asc + i * o.size * LINE));
      } else if (o.type === "whiteout") {
        ctx.fillStyle = o.color || "#ffffff";
        ctx.fillRect(0, 0, o.w, o.h);
      } else if (o.type === "rect") {
        ctx.strokeStyle = o.color;
        ctx.lineWidth = o.stroke;
        ctx.strokeRect(0, 0, o.w, o.h);
      } else if (o.type === "image") {
        const img = S.images.get(o.imageId);
        if (img) ctx.drawImage(img.el, 0, 0, o.w, o.h);
      }
    });
  }

  function drawSelection(ctx, o) {
    const px = 1 / S.zoom;
    ctx.save();
    ctx.strokeStyle = "#1473e6";
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([5 * px, 4 * px]);
    if (o.type === "path") {
      const pad = o.width / 2 + 3 * px;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      o.points.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
      ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
    } else {
      const sz = boxSize(o);
      withBox(ctx, o, () => {
        const pad = 3 * px;
        ctx.strokeRect(-pad, -pad, sz.w + pad * 2, sz.h + pad * 2);
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffffff";
        const hs = 9 * px;
        ctx.fillRect(sz.w - hs / 2, sz.h - hs / 2, hs, hs);
        ctx.strokeRect(sz.w - hs / 2, sz.h - hs / 2, hs, hs);
      });
    }
    ctx.restore();
  }

  function redraw(p) {
    if (p) drawOverlay(p);
    else S.pages.forEach(drawOverlay);
  }

  // =====================================================================
  // Tools & style
  // =====================================================================
  function setTool(tool) {
    if (!S.pdf && tool !== "select") return;
    commitEdit();
    if (tool === "image") {
      el.peImageInput.click();
      return;
    }
    if (tool === "sign") {
      openSignature();
      return;
    }
    S.tool = tool;
    el.peEditor.dataset.tool = tool;
    el.peTools.querySelectorAll("[data-tool]").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.tool === tool ? "true" : "false");
    });
    if (tool !== "select") select(null);
    syncStyleControls();
  }

  // The style controls follow the selected object, otherwise the active tool.
  function styleTarget() {
    if (S.sel) {
      const o = S.sel.obj;
      if (o.type === "text") return "text";
      if (o.type === "rect") return "rect";
      if (o.type === "path") return o.opacity < 1 ? "highlight" : "draw";
      return null;
    }
    return SIZE_LABEL[S.tool] ? S.tool : null;
  }

  function syncStyleControls() {
    const target = styleTarget();
    const o = S.sel && S.sel.obj;
    el.peStyleGroup.classList.toggle("is-disabled", !target);
    [el.peColor, el.peSize, el.peFont, el.peBold].forEach((c) => (c.disabled = !target));
    el.peSwatches.querySelectorAll("button").forEach((b) => (b.disabled = !target));
    const isText = target === "text";
    el.peFont.classList.toggle("is-hidden", !isText);
    el.peBold.classList.toggle("is-hidden", !isText);
    if (!target) return;
    const color = o ? o.color : S.colors[target];
    const size = o ? (o.type === "text" ? o.size : o.type === "rect" ? o.stroke : o.width) : S.sizes[target];
    el.peColor.value = color;
    el.peSize.value = String(Math.round(size * 10) / 10);
    el.peSizeLabel.textContent = SIZE_LABEL[target];
    if (isText) {
      el.peFont.value = o ? o.font || "helv" : S.font;
      el.peBold.setAttribute("aria-pressed", (o ? o.bold : S.bold) ? "true" : "false");
    }
    el.peSwatches.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.color.toLowerCase() === String(color).toLowerCase() ? "true" : "false");
    });
  }

  function setColor(color) {
    const target = styleTarget();
    if (!target) return;
    S.colors[target] = color;
    if (!applyToSelection((o) => o.type !== "image" && o.type !== "whiteout" && (o.color = color))) syncStyleControls();
    if (S.editing) {
      S.editing.obj.color = color;
      S.editing.ta.style.color = color;
    }
  }

  function onSizeChange() {
    const target = styleTarget();
    if (!target) return;
    let v = parseFloat(el.peSize.value);
    if (isNaN(v)) v = S.sizes[target];
    v = Math.min(200, Math.max(target === "text" ? 4 : 0.5, v));
    S.sizes[target] = v;
    const changed = applyToSelection((o) => {
      if (o.type === "text") o.size = v;
      else if (o.type === "rect") o.stroke = v;
      else if (o.type === "path") o.width = v;
    });
    if (!changed) syncStyleControls();
    if (S.editing) {
      S.editing.obj.size = v;
      positionEditor();
    }
  }

  // Apply a mutation to the selected object with undo support.
  function applyToSelection(fn) {
    if (!S.sel) return false;
    pushHistory();
    fn(S.sel.obj);
    redraw(S.sel.page);
    syncStyleControls();
    return true;
  }

  function select(page, obj) {
    const prev = S.sel && S.sel.page;
    S.sel = page && obj ? { page, obj } : null;
    if (prev && prev !== page) redraw(prev);
    if (page) redraw(page);
    el.peDelete.disabled = !S.sel;
    syncStyleControls();
  }

  // =====================================================================
  // History
  // =====================================================================
  function snapshot() {
    return JSON.stringify(S.pages.map((p) => ({ o: p.objects, r: p.extraRot, d: p.deleted })));
  }

  function pushHistory() {
    S.undo.push(snapshot());
    if (S.undo.length > HISTORY_LIMIT) S.undo.shift();
    S.redo = [];
    S.dirty = true;
    updateHistoryButtons();
  }

  function restore(state) {
    const data = JSON.parse(state);
    data.forEach((d, i) => {
      const p = S.pages[i];
      const relayout = p.extraRot !== d.r;
      p.objects = d.o;
      p.extraRot = d.r;
      p.deleted = d.d;
      applyDeletedState(p);
      if (relayout) {
        layoutPage(p);
        if (p.near) schedule(p);
      }
    });
    S.sel = null;
    el.peDelete.disabled = true;
    redraw();
    syncStyleControls();
  }

  function undo() {
    commitEdit();
    if (!S.undo.length) return;
    S.redo.push(snapshot());
    restore(S.undo.pop());
    S.dirty = true;
    updateHistoryButtons();
  }

  function redo() {
    commitEdit();
    if (!S.redo.length) return;
    S.undo.push(snapshot());
    restore(S.redo.pop());
    S.dirty = true;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    el.peUndo.disabled = !S.undo.length;
    el.peRedo.disabled = !S.redo.length;
  }

  function newId() {
    return "o" + ++S.seq;
  }

  // =====================================================================
  // Pointer interaction
  // =====================================================================
  function onPointerDown(e, p) {
    if (e.button !== 0 || p.deleted || !p.vp) return;
    if (S.editing) {
      const editingHere = S.editing.page === p;
      commitEdit();
      // A click elsewhere while typing only ends the edit (like most editors).
      if (S.tool === "text" && editingHere) return;
    }
    const sp = eventPoint(e, p);
    const pt = toPdf(p, sp.x, sp.y);
    try {
      p.overlay.setPointerCapture(e.pointerId);
    } catch (_) {
      /* pointer already gone */
    }
    e.preventDefault();

    const tool = S.tool;
    if (tool === "select") {
      if (handleHit(p, sp)) {
        const o = S.sel.obj;
        S.action = { kind: "resize", page: p, obj: o, before: snapshot(), start: { ...o, size0: boxSize(o) } };
        return;
      }
      const hit = hitTest(p, pt);
      if (hit) {
        select(p, hit);
        S.action = {
          kind: "move",
          page: p,
          obj: hit,
          before: snapshot(),
          last: pt,
          moved: false
        };
        return;
      }
      select(null);
      if (e.pointerType !== "mouse") {
        S.action = { kind: "pan", page: p, x: e.clientX, y: e.clientY, top: el.peScroll.scrollTop, left: el.peScroll.scrollLeft };
      }
      return;
    }

    if (tool === "text") {
      const hit = hitTest(p, pt);
      if (hit && hit.type === "text") {
        startEdit(p, hit, false);
        return;
      }
      const size = S.sizes.text;
      // Put the click point at the middle of the first line.
      const theta = screenTheta(p);
      const probe = { ox: pt.x, oy: pt.y, theta };
      const o0 = localToPdf(probe, -2 / S.zoom, -size * 0.6);
      const obj = {
        id: newId(),
        type: "text",
        ox: o0.x,
        oy: o0.y,
        theta,
        text: "",
        size,
        color: S.colors.text,
        font: S.font,
        bold: S.bold
      };
      startEdit(p, obj, true);
      return;
    }

    if (tool === "draw" || tool === "highlight") {
      const hl = tool === "highlight";
      S.action = {
        kind: "path",
        page: p,
        last: sp,
        temp: {
          id: newId(),
          type: "path",
          points: [[pt.x, pt.y]],
          width: S.sizes[tool],
          color: S.colors[tool],
          opacity: hl ? HIGHLIGHT_OPACITY : 1
        }
      };
      redraw(p);
      return;
    }

    if (tool === "rect" || tool === "whiteout") {
      S.action = { kind: "box", page: p, tool, start: sp, temp: null };
    }
  }

  function onPointerMove(e, p) {
    const a = S.action;
    if (!a) {
      if (S.tool === "select" && e.pointerType === "mouse" && p.vp) {
        const sp = eventPoint(e, p);
        const cursor = handleHit(p, sp) ? "nwse-resize" : hitTest(p, toPdf(p, sp.x, sp.y)) ? "move" : "";
        p.overlay.style.cursor = cursor;
      }
      return;
    }
    if (a.page !== p) return;
    const sp = eventPoint(e, p);
    const pt = toPdf(p, sp.x, sp.y);

    if (a.kind === "pan") {
      el.peScroll.scrollTop = a.top - (e.clientY - a.y);
      el.peScroll.scrollLeft = a.left - (e.clientX - a.x);
      return;
    }
    if (a.kind === "move") {
      const dx = pt.x - a.last.x;
      const dy = pt.y - a.last.y;
      if (!dx && !dy) return;
      translateObj(a.obj, dx, dy);
      a.last = pt;
      a.moved = true;
      redraw(p);
      return;
    }
    if (a.kind === "resize") {
      const o = a.obj;
      const s0 = a.start;
      const l = pdfToLocal(s0, pt.x, pt.y);
      if (o.type === "text") {
        const k = Math.max(0.1, l.y / s0.size0.h);
        o.size = Math.min(200, Math.max(4, s0.size * k));
      } else if (o.type === "image") {
        const k = Math.max(l.x / s0.w, l.y / s0.h, 8 / Math.max(s0.w, s0.h));
        o.w = s0.w * k;
        o.h = s0.h * k;
      } else {
        o.w = Math.max(4, l.x);
        o.h = Math.max(4, l.y);
      }
      a.moved = true;
      redraw(p);
      return;
    }
    if (a.kind === "path") {
      if (Math.hypot(sp.x - a.last.x, sp.y - a.last.y) < 1.5) return;
      a.temp.points.push([pt.x, pt.y]);
      a.last = sp;
      redraw(p);
      return;
    }
    if (a.kind === "box") {
      const x0 = Math.min(a.start.x, sp.x);
      const y0 = Math.min(a.start.y, sp.y);
      const w = Math.abs(sp.x - a.start.x) / S.zoom;
      const h = Math.abs(sp.y - a.start.y) / S.zoom;
      const o = toPdf(p, x0, y0);
      a.temp = {
        id: a.temp ? a.temp.id : newId(),
        type: a.tool,
        ox: o.x,
        oy: o.y,
        theta: screenTheta(p),
        w,
        h,
        color: a.tool === "whiteout" ? "#ffffff" : S.colors.rect,
        stroke: S.sizes.rect
      };
      redraw(p);
    }
  }

  function onPointerUp(e, p) {
    const a = S.action;
    if (!a || a.page !== p) return;
    S.action = null;
    try {
      p.overlay.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* already released */
    }

    if ((a.kind === "move" || a.kind === "resize") && a.moved) {
      S.undo.push(a.before);
      if (S.undo.length > HISTORY_LIMIT) S.undo.shift();
      S.redo = [];
      S.dirty = true;
      updateHistoryButtons();
      syncStyleControls();
    } else if (a.kind === "path") {
      pushHistory();
      p.objects.push(simplifyPath(a.temp));
    } else if (a.kind === "box" && a.temp && a.temp.w * S.zoom > 3 && a.temp.h * S.zoom > 3) {
      pushHistory();
      p.objects.push(a.temp);
      select(p, a.temp);
    }
    redraw(p);
  }

  function onDoubleClick(e, p) {
    if (S.tool !== "select" || !p.vp) return;
    const sp = eventPoint(e, p);
    const hit = hitTest(p, toPdf(p, sp.x, sp.y));
    if (hit && hit.type === "text") startEdit(p, hit, false);
  }

  function translateObj(o, dx, dy) {
    if (o.type === "path") {
      o.points.forEach((pt) => {
        pt[0] += dx;
        pt[1] += dy;
      });
    } else {
      o.ox += dx;
      o.oy += dy;
    }
  }

  // Drop points that are almost collinear to keep files small.
  function simplifyPath(o) {
    const pts = o.points;
    if (pts.length < 3) return o;
    const out = [pts[0]];
    const tol = 0.25;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1];
      const b = pts[i + 1];
      if (distToSegment(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]) > tol) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    o.points = out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    return o;
  }

  // =====================================================================
  // Text editing (textarea placed over the page)
  // =====================================================================
  function startEdit(p, obj, isNew) {
    commitEdit();
    const ta = document.createElement("textarea");
    ta.className = "pe-textarea";
    ta.value = obj.text || "";
    ta.setAttribute("wrap", "off");
    ta.setAttribute("spellcheck", "true");
    ta.setAttribute("aria-label", "Text");
    p.pageEl.appendChild(ta);
    S.editing = { page: p, obj, ta, isNew, before: snapshot(), original: obj.text };
    select(isNew ? null : p, isNew ? null : obj);
    positionEditor();
    redraw(p);
    ta.addEventListener("input", positionEditor);
    ta.addEventListener("blur", () => setTimeout(commitEdit, 0));
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        commitEdit();
      }
      e.stopPropagation();
    });
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }

  function positionEditor() {
    const ed = S.editing;
    if (!ed) return;
    const { page: p, obj: o, ta } = ed;
    o.text = ta.value;
    const s = toScreen(p, o.ox, o.oy);
    const e1 = localToPdf(o, 1, 0);
    const s1 = toScreen(p, e1.x, e1.y);
    const angle = Math.atan2(s1.y - s.y, s1.x - s.x);
    const sz = boxSize(Object.assign({}, o, { text: ta.value || " " }));
    ta.style.left = s.x + "px";
    ta.style.top = s.y + "px";
    ta.style.transform = "rotate(" + angle + "rad)";
    ta.style.font = (o.bold ? "bold " : "") + o.size * S.zoom + "px " + FONTS[o.font || "helv"].css;
    ta.style.lineHeight = String(LINE);
    ta.style.color = o.color;
    ta.style.width = Math.ceil(sz.w * S.zoom + o.size * S.zoom) + "px";
    ta.style.height = Math.ceil(sz.h * S.zoom + 2) + "px";
  }

  function commitEdit() {
    const ed = S.editing;
    if (!ed) return;
    S.editing = null;
    const { page: p, obj: o, ta, isNew, before } = ed;
    const text = ta.value.replace(/\s+$/, "");
    ta.remove();
    if (isNew) {
      if (text) {
        S.undo.push(before);
        o.text = text;
        p.objects.push(o);
        markChanged();
        select(p, o);
      }
    } else if (!text) {
      S.undo.push(before);
      p.objects = p.objects.filter((x) => x !== o);
      markChanged();
      select(null);
    } else if (text !== ed.original) {
      S.undo.push(before);
      o.text = text;
      markChanged();
    } else {
      o.text = ed.original;
    }
    redraw(p);
  }

  function cancelEdit() {
    const ed = S.editing;
    if (!ed) return;
    S.editing = null;
    ed.obj.text = ed.original;
    ed.ta.remove();
  }

  function markChanged() {
    if (S.undo.length > HISTORY_LIMIT) S.undo.shift();
    S.redo = [];
    S.dirty = true;
    updateHistoryButtons();
  }

  // =====================================================================
  // Keyboard
  // =====================================================================
  function onKeyDown(e) {
    if (!S.pdf || !el.peSigModal.classList.contains("is-hidden")) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && S.sel) {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === "Escape") {
      select(null);
    } else if (S.sel && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const p = S.sel.page;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const a = toPdf(p, 0, 0);
      const b = toPdf(p, dx * S.zoom, dy * S.zoom);
      pushHistory();
      translateObj(S.sel.obj, b.x - a.x, b.y - a.y);
      redraw(p);
    } else if (!mod && !e.altKey) {
      const map = { v: "select", t: "text", d: "draw", h: "highlight", r: "rect", w: "whiteout", i: "image", s: "sign" };
      if (map[key]) {
        e.preventDefault();
        setTool(map[key]);
      }
    }
  }

  function deleteSelection() {
    if (!S.sel) return;
    const { page, obj } = S.sel;
    pushHistory();
    page.objects = page.objects.filter((o) => o !== obj);
    select(null);
    redraw(page);
  }

  // =====================================================================
  // Page actions
  // =====================================================================
  function onPageBarClick(e) {
    const btn = e.target.closest("[data-page-act]");
    if (!btn) return;
    const wrap = btn.closest(".pe-page-wrap");
    const p = S.pages.find((pg) => pg.wrap === wrap);
    if (!p) return;
    commitEdit();
    const act = btn.dataset.pageAct;
    if (act === "rotl" || act === "rotr") {
      pushHistory();
      p.extraRot = (p.extraRot + (act === "rotl" ? -90 : 90) + 360) % 360;
      layoutPage(p);
      drawOverlay(p);
      schedule(p);
    } else if (act === "del") {
      if (S.pages.filter((pg) => !pg.deleted).length <= 1) {
        CS.setBadge(el.peStatus, "A PDF needs at least one page.", "error");
        return;
      }
      pushHistory();
      p.deleted = true;
      if (S.sel && S.sel.page === p) select(null);
      applyDeletedState(p);
    } else if (act === "restore") {
      pushHistory();
      p.deleted = false;
      applyDeletedState(p);
    }
  }

  function applyDeletedState(p) {
    p.wrap.classList.toggle("is-deleted", p.deleted);
    p.mask.classList.toggle("is-hidden", !p.deleted);
    const del = p.wrap.querySelector('[data-page-act="del"]');
    if (del) del.disabled = p.deleted;
  }

  // =====================================================================
  // Images & signatures
  // =====================================================================
  function currentPage() {
    const sc = el.peScroll;
    const mid = sc.scrollTop + sc.clientHeight / 2;
    let best = null;
    let bestD = Infinity;
    S.pages.forEach((p) => {
      if (p.deleted) return;
      const top = p.wrap.offsetTop;
      const d = mid < top ? top - mid : mid > top + p.wrap.offsetHeight ? mid - top - p.wrap.offsetHeight : 0;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    });
    return best;
  }

  async function insertImageFile(file) {
    if (!S.pdf) return;
    try {
      const img = await CS.loadImage(file);
      const max = 2000;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const jpeg = /jpe?g$/i.test(file.type);
      const blob = await CS.canvasToBlob(c, jpeg ? "image/jpeg" : "image/png", 0.9);
      placeImage(c, new Uint8Array(await blob.arrayBuffer()), jpeg ? "jpg" : "png", 0.45);
    } catch (err) {
      CS.setBadge(el.peStatus, err.message || "Could not read the image.", "error");
    }
  }

  function placeImage(canvas, bytes, kind, widthFrac) {
    const p = currentPage();
    if (!p || !p.vp) return;
    const id = "img" + ++S.seq;
    S.images.set(id, { el: canvas, bytes, kind });
    const dispW = p.cssW / S.zoom;
    const w = Math.min(dispW * widthFrac, canvas.width * 0.75);
    const h = (w * canvas.height) / canvas.width;
    // Center of the visible part of the page.
    const sc = el.peScroll;
    const pageTop = p.pageEl.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    const visTop = Math.max(0, -pageTop);
    const visBottom = Math.min(p.cssH, sc.clientHeight - pageTop);
    const cy = (visTop + visBottom) / 2;
    const cx = p.cssW / 2;
    const o = toPdf(p, cx - (w * S.zoom) / 2, Math.max(0, cy - (h * S.zoom) / 2));
    const obj = { id: newId(), type: "image", ox: o.x, oy: o.y, theta: screenTheta(p), w, h, imageId: id };
    pushHistory();
    p.objects.push(obj);
    setTool("select");
    select(p, obj);
    CS.setBadge(el.peStatus, "Drag to move, use the corner handle to resize.", "done");
  }

  const SIG = { mode: "draw", color: "#111827", font: "Dancing Script", strokes: [], drawing: null };

  function initSignature() {
    el.peSigClose.addEventListener("click", closeSignature);
    el.peSigModal.addEventListener("click", (e) => {
      if (e.target === el.peSigModal) closeSignature();
    });
    el.peSigModal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSignature();
    });
    CS.bindSegGroup(el.peSigMode, (v) => {
      SIG.mode = v;
      el.peSigDrawPanel.classList.toggle("is-hidden", v !== "draw");
      el.peSigTypePanel.classList.toggle("is-hidden", v !== "type");
      requestAnimationFrame(() => {
        sizeSigPad();
        drawTypedSignature();
        if (v === "type") el.peSigName.focus();
      });
    });
    CS.bindSegGroup(el.peSigColors, (v) => {
      SIG.color = v;
      paintSigPad();
      drawTypedSignature();
    });
    CS.bindSegGroup(el.peSigFonts, (v) => {
      SIG.font = v;
      drawTypedSignature();
    });
    el.peSigName.addEventListener("input", drawTypedSignature);
    el.peSigClear.addEventListener("click", () => {
      SIG.strokes = [];
      el.peSigName.value = "";
      paintSigPad();
      drawTypedSignature();
    });
    el.peSigUse.addEventListener("click", useSignature);

    const pad = el.peSigPad;
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      SIG.drawing = [sigPoint(e)];
      SIG.strokes.push(SIG.drawing);
      paintSigPad();
    });
    pad.addEventListener("pointermove", (e) => {
      if (!SIG.drawing) return;
      SIG.drawing.push(sigPoint(e));
      paintSigPad();
    });
    const end = () => (SIG.drawing = null);
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
  }

  function sigPoint(e) {
    const r = el.peSigPad.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  function openSignature() {
    if (!S.pdf) return;
    el.peSigModal.classList.remove("is-hidden");
    requestAnimationFrame(() => {
      sizeSigPad();
      drawTypedSignature();
      (SIG.mode === "type" ? el.peSigName : el.peSigUse).focus();
    });
  }

  function closeSignature() {
    el.peSigModal.classList.add("is-hidden");
  }

  function sizeSigPad() {
    [el.peSigPad, el.peSigTypePreview].forEach((c) => {
      const r = c.getBoundingClientRect();
      if (!r.width) return;
      c.width = Math.round(r.width * dpr());
      c.height = Math.round(r.height * dpr());
    });
    paintSigPad();
  }

  function paintSigPad(target) {
    const c = target || el.peSigPad;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    if (!target) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = "#d4d4d8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.width * 0.06, c.height * 0.78);
      ctx.lineTo(c.width * 0.94, c.height * 0.78);
      ctx.stroke();
    }
    ctx.strokeStyle = SIG.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, c.width / 220);
    SIG.strokes.forEach((stroke) => {
      ctx.beginPath();
      stroke.forEach(([x, y], i) => {
        const px = x * c.width;
        const py = y * c.height;
        if (i === 0) ctx.moveTo(px, py);
        else {
          const [x0, y0] = stroke[i - 1];
          ctx.quadraticCurveTo(x0 * c.width, y0 * c.height, (px + x0 * c.width) / 2, (py + y0 * c.height) / 2);
        }
      });
      if (stroke.length === 1) ctx.lineTo(stroke[0][0] * c.width + 0.5, stroke[0][1] * c.height);
      ctx.stroke();
    });
  }

  function drawTypedSignature(target) {
    const c = target || el.peSigTypePreview;
    if (!c.width) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    if (!target) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
    }
    const name = el.peSigName.value.trim();
    if (!name) return;
    let size = c.height * 0.55;
    ctx.font = size + "px '" + SIG.font + "', cursive";
    const w = ctx.measureText(name).width;
    if (w > c.width * 0.9) {
      size *= (c.width * 0.9) / w;
      ctx.font = size + "px '" + SIG.font + "', cursive";
    }
    ctx.fillStyle = SIG.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, c.width / 2, c.height / 2);
  }

  async function useSignature() {
    const out = document.createElement("canvas");
    out.width = 1500;
    out.height = 500;
    if (SIG.mode === "draw") {
      if (!SIG.strokes.length) {
        CS.setBadge(el.peStatus, "Draw your signature first.", "error");
        return;
      }
      paintSigPad(out);
    } else {
      if (!el.peSigName.value.trim()) {
        el.peSigName.focus();
        return;
      }
      if (document.fonts && document.fonts.load) {
        try {
          await document.fonts.load("100px '" + SIG.font + "'");
        } catch (_) {
          /* fall back to cursive */
        }
      }
      drawTypedSignature(out);
    }
    const trimmed = trimCanvas(out);
    if (!trimmed) return;
    const blob = await CS.canvasToBlob(trimmed, "image/png");
    closeSignature();
    placeImage(trimmed, new Uint8Array(await blob.arrayBuffer()), "png", 0.3);
  }

  // Crop transparent margins.
  function trimCanvas(c) {
    const ctx = c.getContext("2d");
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const pad = 12;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const out = document.createElement("canvas");
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext("2d").drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // =====================================================================
  // Export
  // =====================================================================
  async function buildPdf() {
    commitEdit();
    const PDFLib = await CS.ensurePdfLib();
    const { degrees, rgb } = PDFLib;
    const doc = await CS.openPdfLib(S.bytes);
    const pages = doc.getPages();
    const fonts = {};
    const images = new Map();

    const getFont = async (key, bold) => {
      const name = FONTS[key || "helv"].std[bold ? 1 : 0];
      if (!fonts[name]) fonts[name] = await doc.embedFont(PDFLib.StandardFonts[name]);
      return fonts[name];
    };
    const color = (hex) => {
      const c = CS.hexToRgb01(hex);
      return rgb(c.r, c.g, c.b);
    };

    for (let i = 0; i < S.pages.length; i++) {
      const sp = S.pages[i];
      if (sp.deleted) continue;
      const page = pages[i];
      if (sp.extraRot) {
        const cur = page.getRotation().angle || 0;
        page.setRotation(degrees((((cur + sp.extraRot) % 360) + 360) % 360));
      }
      for (const o of sp.objects) {
        const deg = (o.theta * 180) / Math.PI;
        if (o.type === "text") {
          const font = await getFont(o.font, o.bold);
          const asc = FONTS[o.font || "helv"].asc;
          const lines = textLines(o);
          for (let li = 0; li < lines.length; li++) {
            if (!lines[li]) continue;
            const pos = localToPdf(o, 0, o.size * asc + li * o.size * LINE);
            await CS.drawTextOrImage(doc, page, lines[li], {
              x: pos.x,
              y: pos.y,
              size: o.size,
              color: o.color,
              rotate: deg,
              font,
              cssFont: FONTS[o.font || "helv"].css,
              bold: o.bold
            });
          }
        } else if (o.type === "rect" || o.type === "whiteout") {
          const b = localToPdf(o, 0, o.h);
          const opts = { x: b.x, y: b.y, width: o.w, height: o.h, rotate: degrees(deg) };
          if (o.type === "whiteout") {
            opts.color = color(o.color || "#ffffff");
            opts.borderWidth = 0;
          } else {
            opts.borderColor = color(o.color);
            opts.borderWidth = o.stroke;
          }
          page.drawRectangle(opts);
        } else if (o.type === "image") {
          const src = S.images.get(o.imageId);
          if (!src) continue;
          let emb = images.get(o.imageId);
          if (!emb) {
            emb = src.kind === "jpg" ? await doc.embedJpg(src.bytes) : await doc.embedPng(src.bytes);
            images.set(o.imageId, emb);
          }
          const b = localToPdf(o, 0, o.h);
          page.drawImage(emb, { x: b.x, y: b.y, width: o.w, height: o.h, rotate: degrees(deg) });
        } else if (o.type === "path") {
          drawPathPdf(PDFLib, doc, page, o, color(o.color));
        }
      }
    }

    for (let i = S.pages.length - 1; i >= 0; i--) {
      if (S.pages[i].deleted) doc.removePage(i);
    }
    doc.setModificationDate(new Date());
    doc.setProducer("CropShift (pdf-lib)");
    return doc.save();
  }

  // Freehand strokes as one PDF path with round caps/joins (+ opacity via ExtGState).
  function drawPathPdf(PDFLib, doc, page, o, strokeColor) {
    const ops = [PDFLib.pushGraphicsState()];
    if (o.opacity < 1) {
      const gs = doc.context.obj({ Type: "ExtGState", CA: o.opacity, ca: o.opacity });
      const name = page.node.newExtGState("GS", doc.context.register(gs));
      ops.push(PDFLib.setGraphicsState(name));
    }
    ops.push(
      PDFLib.setStrokingColor(strokeColor),
      PDFLib.setLineWidth(o.width),
      PDFLib.setLineCap(PDFLib.LineCapStyle.Round),
      PDFLib.setLineJoin(PDFLib.LineJoinStyle.Round)
    );
    const pts = o.points;
    ops.push(PDFLib.moveTo(pts[0][0], pts[0][1]));
    if (pts.length === 1) ops.push(PDFLib.lineTo(pts[0][0] + 0.01, pts[0][1]));
    for (let i = 1; i < pts.length; i++) ops.push(PDFLib.lineTo(pts[i][0], pts[i][1]));
    ops.push(PDFLib.stroke(), PDFLib.popGraphicsState());
    page.pushOperators(...ops);
  }

  async function savePdf() {
    if (!S.pdf || S.busy) return;
    S.busy = true;
    setSaveDisabled(true);
    try {
      CS.setBadge(el.peStatus, "Saving PDF…", "working");
      const bytes = await buildPdf();
      const blob = CS.pdfBlob(bytes);
      const name = CS.baseName(S.file.name) + "-edited.pdf";
      CS.downloadBlob(blob, name);
      S.dirty = false;
      CS.setBadge(el.peStatus, "Saved " + name + " (" + CS.formatBytes(blob.size) + ")", "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.peStatus, (err && err.message) || "Could not save the PDF.", "error");
    } finally {
      S.busy = false;
      setSaveDisabled(false);
    }
  }

  async function saveImages() {
    if (!S.pdf || S.busy) return;
    S.busy = true;
    setSaveDisabled(true);
    let pdf = null;
    try {
      CS.setBadge(el.peStatus, "Preparing pages…", "working");
      const bytes = await buildPdf();
      pdf = await CS.openPdfJs(bytes);
      const base = CS.baseName(S.file.name);
      const pad = String(pdf.numPages).length;
      const outputs = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        CS.setBadge(el.peStatus, "Rendering image " + n + " of " + pdf.numPages + "…", "working");
        const page = await pdf.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        let scale = 150 / 72;
        const area = vp.width * vp.height * scale * scale;
        if (area > MAX_RENDER_PIXELS) scale *= Math.sqrt(MAX_RENDER_PIXELS / area);
        const canvas = await CS.renderPdfPage(page, scale, 0);
        outputs.push({ name: base + "-page-" + String(n).padStart(pad, "0") + ".jpg", blob: await CS.canvasToBlob(canvas, "image/jpeg", 0.9) });
        canvas.width = canvas.height = 0;
        await CS.nextFrame();
      }
      if (outputs.length === 1) {
        CS.downloadBlob(outputs[0].blob, outputs[0].name);
      } else {
        CS.downloadBlob(await CS.makeZip(outputs), base + "-edited-images.zip");
      }
      CS.setBadge(el.peStatus, "Saved " + outputs.length + " image" + (outputs.length === 1 ? "" : "s"), "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.peStatus, (err && err.message) || "Could not export images.", "error");
    } finally {
      if (pdf) pdf.destroy();
      S.busy = false;
      setSaveDisabled(false);
    }
  }

  function setSaveDisabled(on) {
    el.peSaveBtn.disabled = on;
    el.peSaveImgBtn.disabled = on;
  }
})();
