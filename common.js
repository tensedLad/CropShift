// Shared helpers for CropShift tool pages (exposed as window.CS).
// Lazy library loading (pdf.js, pdf-lib, tesseract.js), file intake (click /
// drop / paste), status badges, downloads, a tiny ZIP writer, page-range
// parsing and a pointer-based sortable grid. Everything runs client-side.

(function () {
  "use strict";

  const LIBS = {
    pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfjsWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    pdflib: "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
    tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
  };

  // Standard page sizes in PDF points (1 pt = 1/72 in).
  const PAGE_SIZES = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    legal: [612, 1008],
    a5: [419.53, 595.28]
  };

  // ---------- Script loading ----------
  const scriptCache = {};
  function loadScript(src) {
    if (scriptCache[src]) return scriptCache[src];
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load a required library. Check your connection."));
      document.head.appendChild(script);
    });
    promise.catch(() => {
      delete scriptCache[src];
    });
    scriptCache[src] = promise;
    return promise;
  }

  async function ensurePdfJs() {
    await loadScript(LIBS.pdfjs);
    if (!window.pdfjsLib) throw new Error("PDF engine failed to load. Check your connection.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
    return window.pdfjsLib;
  }

  async function ensurePdfLib() {
    await loadScript(LIBS.pdflib);
    if (!window.PDFLib) throw new Error("PDF writer failed to load. Check your connection.");
    return window.PDFLib;
  }

  async function ensureTesseract() {
    await loadScript(LIBS.tesseract);
    if (!window.Tesseract) throw new Error("OCR engine failed to load. Check your connection.");
    return window.Tesseract;
  }

  // ---------- PDF helpers ----------
  const ENCRYPTED_MSG =
    "This PDF is password-protected or encrypted. Remove the protection with Unlock File first.";

  // pdf.js transfers (detaches) the buffer it is given, so always hand it a copy.
  async function openPdfJs(bytes) {
    const pdfjsLib = await ensurePdfJs();
    const data = (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).slice();
    try {
      return await pdfjsLib.getDocument({ data }).promise;
    } catch (err) {
      if (err && err.name === "PasswordException") throw new Error(ENCRYPTED_MSG);
      throw new Error("This PDF could not be read. It may be damaged.");
    }
  }

  async function openPdfLib(bytes) {
    const PDFLib = await ensurePdfLib();
    try {
      return await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      if (err && /encrypt/i.test(err.message || "")) throw new Error(ENCRYPTED_MSG);
      throw new Error("This PDF could not be read. It may be damaged.");
    }
  }

  // Render one pdf.js page to a canvas. `rotation` is extra rotation (deg)
  // on top of the page's own /Rotate.
  async function renderPdfPage(page, scale, rotation) {
    const viewport = page.getViewport({ scale, rotation: ((page.rotate + (rotation || 0)) % 360 + 360) % 360 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  // Render a page so it fits inside a `box` px square (for thumbnails).
  async function renderThumb(page, box) {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(box / base.width, box / base.height) * Math.min(2, window.devicePixelRatio || 1);
    return renderPdfPage(page, scale, 0);
  }

  // Draw `src` rotated by `deg` (multiple of 90) into a new canvas.
  function rotateCanvas(src, deg) {
    const d = ((deg % 360) + 360) % 360;
    if (!d) return src;
    const out = document.createElement("canvas");
    const swap = d === 90 || d === 270;
    out.width = swap ? src.height : src.width;
    out.height = swap ? src.width : src.height;
    const ctx = out.getContext("2d");
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((d * Math.PI) / 180);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return out;
  }

  // Lazily run `job()` for elements as they scroll near the viewport, one at a
  // time (keeps memory flat for long PDFs). Returns { observe, disconnect }.
  function createLazyQueue(root) {
    const jobs = new Map();
    const queue = [];
    let running = false;

    const pump = async () => {
      if (running) return;
      running = true;
      while (queue.length) {
        const job = queue.shift();
        try {
          await job();
        } catch (err) {
          console.error(err);
        }
      }
      running = false;
    };

    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const job = jobs.get(entry.target);
                if (!job) return;
                jobs.delete(entry.target);
                io.unobserve(entry.target);
                queue.push(job);
              });
              pump();
            },
            { root: root || null, rootMargin: "600px 0px" }
          )
        : null;

    return {
      observe(el, job) {
        if (!io) {
          queue.push(job);
          pump();
          return;
        }
        jobs.set(el, job);
        io.observe(el);
      },
      disconnect() {
        if (io) io.disconnect();
        jobs.clear();
        queue.length = 0;
      }
    };
  }

  // pdf-lib's standard fonts only cover Latin (WinAnsi) characters.
  function fontCanEncode(font, text) {
    try {
      font.encodeText(text);
      return true;
    } catch (_) {
      return false;
    }
  }

  function hexToRgb01(hex) {
    const m = String(hex || "#000000").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
  }

  // Draw one line of text with its baseline-left at (x, y), rotated `rotate`
  // degrees CCW. Uses the PDF font when it can encode the text; otherwise
  // (e.g. Hindi, emoji) renders it to a transparent PNG so any script works.
  // opts: { x, y, size, color "#rrggbb", opacity, rotate, font, cssFont, bold }
  async function drawTextOrImage(doc, page, text, opts) {
    const PDFLib = window.PDFLib;
    const rgb = hexToRgb01(opts.color);
    const rotate = opts.rotate || 0;
    if (fontCanEncode(opts.font, text)) {
      page.drawText(text, {
        x: opts.x,
        y: opts.y,
        size: opts.size,
        font: opts.font,
        color: PDFLib.rgb(rgb.r, rgb.g, rgb.b),
        opacity: opts.opacity == null ? 1 : opts.opacity,
        rotate: PDFLib.degrees(rotate)
      });
      return;
    }
    const k = 4; // supersampling
    const px = opts.size * k;
    const css = (opts.bold ? "bold " : "") + px + "px " + (opts.cssFont || "Helvetica, Arial, sans-serif");
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = css;
    const width = Math.max(1, Math.ceil(probe.measureText(text).width));
    const c = document.createElement("canvas");
    c.width = width + 4;
    c.height = Math.ceil(px * 1.3);
    const ctx = c.getContext("2d");
    ctx.font = css;
    ctx.fillStyle = opts.color || "#000";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, 2, px);
    const blob = await canvasToBlob(c, "image/png");
    const img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
    // Image bottom sits 0.3*size below the baseline; shift along the rotated y axis.
    const rad = (rotate * Math.PI) / 180;
    const drop = opts.size * 0.3;
    const shiftX = (2 / k) * Math.cos(rad);
    const shiftY = (2 / k) * Math.sin(rad);
    page.drawImage(img, {
      x: opts.x + Math.sin(rad) * drop - shiftX,
      y: opts.y - Math.cos(rad) * drop - shiftY,
      width: c.width / k,
      height: c.height / k,
      opacity: opts.opacity == null ? 1 : opts.opacity,
      rotate: PDFLib.degrees(rotate)
    });
  }

  // ---------- Images ----------
  function loadImage(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        resolve(img);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("This image could not be read: " + (fileOrBlob.name || "image")));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed."))),
        mime || "image/png",
        quality
      );
    });
  }

  function isImageFile(file) {
    return !!file && (/^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name || ""));
  }

  function isPdfFile(file) {
    return !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
  }

  // ---------- Misc ----------
  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return "0 KB";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function baseName(name) {
    return String(name || "file").replace(/\.[^/.]+$/, "") || "file";
  }

  // Clean a user-typed file name and make sure it ends with `.ext`.
  function outputFileName(raw, fallback, ext) {
    let name = String(raw || "")
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-");
    name = name.replace(new RegExp("\\." + ext + "$", "i"), "").trim();
    return (name || fallback) + "." + ext;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  function pdfBlob(bytes) {
    return new Blob([bytes], { type: "application/pdf" });
  }

  function setBadge(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove("is-working", "is-error", "is-done");
    if (type) el.classList.add("is-" + type);
  }

  // Yield to the event loop so the status text can paint between heavy steps.
  // (setTimeout, not requestAnimationFrame: rAF pauses in background tabs and
  // would stall a long export until the user came back.)
  function nextFrame() {
    return new Promise((resolve) => setTimeout(resolve, 16));
  }

  // Parse "1-3, 5, 8-" into [{from, to}] (1-based, inclusive). Throws on bad input.
  function parseRanges(text, max) {
    const parts = String(text || "")
      .split(/[,;\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) throw new Error("Enter pages, e.g. 1-3, 5");
    return parts.map((part) => {
      const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
      let from;
      let to;
      if (m) {
        from = m[1] ? parseInt(m[1], 10) : 1;
        to = m[2] ? parseInt(m[2], 10) : max;
      } else if (/^\d+$/.test(part)) {
        from = to = parseInt(part, 10);
      } else {
        throw new Error('"' + part + '" is not a valid page or range.');
      }
      if (from < 1 || to < 1 || from > max || to > max) {
        throw new Error('"' + part + '" is outside 1-' + max + ".");
      }
      if (from > to) throw new Error('"' + part + '" goes backwards.');
      return { from, to };
    });
  }

  function rangesToPages(ranges) {
    const out = [];
    ranges.forEach((r) => {
      for (let n = r.from; n <= r.to; n++) out.push(n);
    });
    return out;
  }

  // ---------- File intake (click, drop anywhere, paste) ----------
  // opts: { zone, input, accept(file) -> bool, onFiles(files), multiple }
  function bindFileIntake(opts) {
    const { zone, input } = opts;
    const accept = opts.accept || (() => true);
    const deliver = (list) => {
      const files = Array.from(list || []).filter(accept);
      if (!files.length) {
        if (opts.onReject) opts.onReject();
        return;
      }
      opts.onFiles(opts.multiple ? files : [files[0]]);
    };

    if (zone && input) zone.addEventListener("click", () => input.click());
    if (input) {
      input.addEventListener("change", () => {
        deliver(input.files);
        input.value = "";
      });
    }

    let counter = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    document.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counter++;
      if (zone) zone.classList.add("is-dragging");
      document.body.classList.add("is-file-dragging");
    });
    document.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    });
    document.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      counter--;
      if (counter <= 0) {
        counter = 0;
        if (zone) zone.classList.remove("is-dragging");
        document.body.classList.remove("is-file-dragging");
      }
    });
    document.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counter = 0;
      if (zone) zone.classList.remove("is-dragging");
      document.body.classList.remove("is-file-dragging");
      deliver(e.dataTransfer.files);
    });

    document.addEventListener("paste", (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const files = e.clipboardData ? Array.from(e.clipboardData.files || []) : [];
      if (!files.length) return;
      e.preventDefault();
      deliver(files);
    });
  }

  // ---------- Segmented button groups ----------
  // Wires a .seg-group: clicking a button sets aria-pressed and calls onChange(value).
  function bindSegGroup(group, onChange) {
    if (!group) return;
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn || btn.disabled) return;
      setSegValue(group, btn.dataset.value);
      if (onChange) onChange(btn.dataset.value);
    });
  }

  function setSegValue(group, value) {
    group.querySelectorAll("button[data-value]").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.value === String(value) ? "true" : "false");
    });
  }

  function getSegValue(group) {
    const btn = group && group.querySelector('button[aria-pressed="true"]');
    return btn ? btn.dataset.value : null;
  }

  // ---------- Sortable grid (pointer based: mouse, touch, pen + keyboard) ----------
  // opts: { item: ".card", handle: ".drag-handle", scroller: element, onChange() }
  function makeSortable(container, opts) {
    let drag = null;
    let autoScroll = 0;
    let suppressClickUntil = 0;

    // A drag that ends over a card would otherwise also fire a click (toggle).
    container.addEventListener(
      "click",
      (e) => {
        if (Date.now() < suppressClickUntil) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );

    container.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const item = e.target.closest(opts.item);
      if (!item || !container.contains(item)) return;
      const fromHandle = !!(opts.handle && e.target.closest(opts.handle));
      if (!fromHandle && e.target.closest("button, input, select, textarea, a, label")) return;
      if (e.pointerType !== "mouse" && !fromHandle) return; // touch drags only from the handle
      drag = { item, id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
      if (fromHandle) e.preventDefault();
    });

    window.addEventListener(
      "pointermove",
      (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.active) {
          if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
          drag.active = true;
          drag.item.classList.add("is-dragging");
          document.body.classList.add("is-sorting");
        }
        e.preventDefault();
        const scroller = opts.scroller;
        if (scroller) {
          const r = scroller.getBoundingClientRect();
          autoScroll = e.clientY < r.top + 50 ? -12 : e.clientY > r.bottom - 50 ? 12 : 0;
          if (autoScroll) scroller.scrollTop += autoScroll;
        }
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const target = under && under.closest(opts.item);
        if (!target || target === drag.item || !container.contains(target)) return;
        const rect = target.getBoundingClientRect();
        const sameRow = Math.abs(rect.top - drag.item.getBoundingClientRect().top) < rect.height / 2;
        const after = sameRow
          ? e.clientX > rect.left + rect.width / 2
          : drag.item.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING;
        container.insertBefore(drag.item, after ? target.nextSibling : target);
      },
      { passive: false }
    );

    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const wasActive = drag.active;
      drag.item.classList.remove("is-dragging");
      document.body.classList.remove("is-sorting");
      drag = null;
      autoScroll = 0;
      if (wasActive) {
        suppressClickUntil = Date.now() + 250;
        if (opts.onChange) opts.onChange();
      }
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);

    // Keyboard: arrow keys on a focused handle move the item.
    container.addEventListener("keydown", (e) => {
      if (!opts.handle || !e.target.closest(opts.handle)) return;
      const item = e.target.closest(opts.item);
      if (!item) return;
      let moved = false;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        const prev = item.previousElementSibling;
        if (prev) {
          container.insertBefore(item, prev);
          moved = true;
        }
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        const next = item.nextElementSibling;
        if (next) {
          container.insertBefore(next, item);
          moved = true;
        }
      }
      if (moved) {
        e.preventDefault();
        e.target.focus();
        if (opts.onChange) opts.onChange();
      }
    });
  }

  // ---------- Minimal ZIP writer (STORE, no compression) ----------
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // files: [{ name, blob | bytes }] -> Blob (application/zip)
  async function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const used = new Set();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      let name = f.name;
      let i = 2;
      while (used.has(name)) {
        name = f.name.replace(/(\.[^.]+)?$/, "-" + i++ + "$1");
      }
      used.add(name);
      const data = f.bytes || new Uint8Array(await f.blob.arrayBuffer());
      const nameBytes = enc.encode(name);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    }

    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  window.CS = {
    LIBS,
    PAGE_SIZES,
    loadScript,
    ensurePdfJs,
    ensurePdfLib,
    ensureTesseract,
    openPdfJs,
    openPdfLib,
    renderPdfPage,
    renderThumb,
    rotateCanvas,
    createLazyQueue,
    fontCanEncode,
    hexToRgb01,
    drawTextOrImage,
    loadImage,
    canvasToBlob,
    isImageFile,
    isPdfFile,
    formatBytes,
    baseName,
    outputFileName,
    escapeHtml,
    downloadBlob,
    pdfBlob,
    setBadge,
    nextFrame,
    parseRanges,
    rangesToPages,
    bindFileIntake,
    bindSegGroup,
    setSegValue,
    getSegValue,
    makeSortable,
    makeZip
  };
})();
