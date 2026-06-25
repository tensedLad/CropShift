// File Resizer tool + tool switching for the CropShift workspace.
// Runs entirely client-side. Images are recompressed with <canvas>; PDFs are
// re-rendered and recompressed in the browser using pdf.js + pdf-lib (loaded
// lazily from a CDN only when a PDF is processed). No server required.

(function () {
  "use strict";

  const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const PDFLIB_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";

  const MAX_FILE_BYTES = 50 * 1024 * 1024; // ~50 MB soft cap

  const R = {
    file: null,
    resultBlob: null,
    resultName: null
  };

  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "resizerStatus",
      "resizerFileInput",
      "resizerDropzone",
      "resizerWorkspace",
      "resizerFileIcon",
      "resizerFileName",
      "resizerFileInfo",
      "resizerThumbWrap",
      "resizerThumb",
      "resizerTargetInput",
      "resizerUnit",
      "resizerRunBtn",
      "resizerResult",
      "resizerOrigSize",
      "resizerNewSize",
      "resizerSaved",
      "resizerChangeBtn",
      "resizerDownloadBtn"
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });

    if (!el.resizerDropzone) return;

    el.resizerDropzone.addEventListener("click", () => el.resizerFileInput.click());
    el.resizerChangeBtn.addEventListener("click", () => el.resizerFileInput.click());
    el.resizerFileInput.addEventListener("change", (e) => {
      const [file] = e.target.files;
      if (file) handleFile(file);
      el.resizerFileInput.value = "";
    });

    el.resizerTargetInput.addEventListener("input", refreshRunState);
    el.resizerUnit.addEventListener("change", refreshRunState);
    el.resizerRunBtn.addEventListener("click", runResize);
    el.resizerDownloadBtn.addEventListener("click", downloadResult);

    bindResizerDragAndDrop();
    document.addEventListener("paste", onResizerPaste);
  }

  // ---------- File intake ----------
  function bindResizerDragAndDrop() {
    const zone = document;
    let counter = 0;

    const isActive = () => true;

    zone.addEventListener("dragenter", (e) => {
      if (!isActive()) return;
      e.preventDefault();
      counter++;
      el.resizerDropzone.classList.add("is-dragging");
    });
    zone.addEventListener("dragover", (e) => {
      if (!isActive()) return;
      e.preventDefault();
    });
    zone.addEventListener("dragleave", (e) => {
      if (!isActive()) return;
      e.preventDefault();
      counter--;
      if (counter <= 0) {
        counter = 0;
        el.resizerDropzone.classList.remove("is-dragging");
      }
    });
    zone.addEventListener("drop", (e) => {
      if (!isActive()) return;
      e.preventDefault();
      e.stopPropagation();
      counter = 0;
      el.resizerDropzone.classList.remove("is-dragging");
      const [file] = e.dataTransfer.files;
      if (file) handleFile(file);
    });
  }

  function onResizerPaste(event) {
    if (window.activeTool !== "resizer") return;
    const data = event.clipboardData;
    if (!data) return;
    const file = Array.from(data.files).find(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf"
    );
    if (file) {
      event.preventDefault();
      handleFile(file);
    }
  }

  function handleFile(file) {
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

    if (file.type.startsWith("video/")) {
      setStatus("Videos aren't supported.", "error");
      return;
    }
    if (!isImage && !isPdf) {
      setStatus("Only images and PDFs are supported.", "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus(`File is too large (max ${formatBytes(MAX_FILE_BYTES)}).`, "error");
      return;
    }

    R.file = file;
    R.resultBlob = null;
    R.resultName = null;

    el.resizerDropzone.classList.add("is-hidden");
    el.resizerWorkspace.classList.remove("is-hidden");
    el.resizerResult.classList.add("is-hidden");
    el.resizerDownloadBtn.disabled = true;

    el.resizerFileName.textContent = file.name;
    el.resizerFileInfo.textContent = `${isPdf ? "PDF" : (file.type.split("/")[1] || "image").toUpperCase()} \u00b7 ${formatBytes(file.size)}`;
    el.resizerFileIcon.textContent = isPdf ? "picture_as_pdf" : "image";

    // Thumbnail (images only)
    revokeThumb();
    if (isImage) {
      const url = URL.createObjectURL(file);
      el.resizerThumb.src = url;
      el.resizerThumb.dataset.url = url;
      el.resizerThumbWrap.classList.remove("is-hidden");
    } else {
      el.resizerThumbWrap.classList.add("is-hidden");
    }

    // Pre-fill the target with the current size so it's an obvious starting point.
    const kb = file.size / 1024;
    if (kb >= 1024) {
      el.resizerUnit.value = "MB";
      el.resizerTargetInput.value = (kb / 1024).toFixed(2);
    } else {
      el.resizerUnit.value = "KB";
      el.resizerTargetInput.value = Math.max(1, Math.round(kb));
    }

    setStatus("Ready", "");
    refreshRunState();
  }

  function revokeThumb() {
    if (el.resizerThumb.dataset.url) {
      URL.revokeObjectURL(el.resizerThumb.dataset.url);
      delete el.resizerThumb.dataset.url;
    }
  }

  function getTargetBytes() {
    const val = parseFloat(el.resizerTargetInput.value);
    if (isNaN(val) || val <= 0) return 0;
    const mult = el.resizerUnit.value === "MB" ? 1024 * 1024 : 1024;
    return Math.round(val * mult);
  }

  function refreshRunState() {
    el.resizerRunBtn.disabled = !(R.file && getTargetBytes() > 0);
  }

  // ---------- Resize / compress ----------
  async function runResize() {
    if (!R.file) return;
    const targetBytes = getTargetBytes();
    if (!targetBytes) return;

    el.resizerRunBtn.disabled = true;
    el.resizerDownloadBtn.disabled = true;
    setStatus("Working\u2026", "working");

    try {
      const isPdf = R.file.type === "application/pdf" || /\.pdf$/i.test(R.file.name);
      const result = isPdf
        ? await compressPdfToTarget(R.file, targetBytes)
        : await compressImageToTarget(R.file, targetBytes);

      R.resultBlob = result.blob;
      R.resultName = result.name;
      showResult(R.file.size, result.blob.size, targetBytes);
      el.resizerDownloadBtn.disabled = false;
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : "Could not resize this file.", "error");
    } finally {
      el.resizerRunBtn.disabled = false;
    }
  }

  function showResult(origBytes, newBytes, targetBytes) {
    el.resizerResult.classList.remove("is-hidden");
    el.resizerOrigSize.textContent = formatBytes(origBytes);
    el.resizerNewSize.textContent = formatBytes(newBytes);

    const saved = origBytes - newBytes;
    const pct = origBytes > 0 ? Math.round((saved / origBytes) * 100) : 0;
    el.resizerSaved.textContent = saved > 0 ? `${pct}%` : "0%";

    if (newBytes <= targetBytes) {
      setStatus(`Done \u2014 ${formatBytes(newBytes)} (under target).`, "done");
    } else {
      setStatus(`Smallest reachable is ${formatBytes(newBytes)} (target ${formatBytes(targetBytes)}).`, "done");
    }
  }

  function downloadResult() {
    if (!R.resultBlob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(R.resultBlob);
    link.download = R.resultName || "resized-file";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ---------- Image compression ----------
  async function compressImageToTarget(file, targetBytes) {
    const img = await loadImage(file);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let mime = file.type;
    let ext;
    if (mime === "image/png") {
      ext = "png";
    } else if (mime === "image/webp") {
      ext = "webp";
    } else if (mime === "image/jpeg") {
      ext = "jpg";
    } else {
      // gif/bmp/svg/etc. -> re-encode as JPEG for predictable size control
      mime = "image/jpeg";
      ext = "jpg";
    }

    const blob = await encodeWithinTarget(canvas, mime, 0.95, targetBytes);
    return { blob, name: baseName(file.name) + "-resized." + ext };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      const url = URL.createObjectURL(file);
      img.onload = () => {
        resolve(img);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("This image could not be read."));
      };
      img.src = url;
    });
  }

  async function encodeWithinTarget(srcCanvas, mime, maxQuality, targetBytes) {
    const lossy = mime === "image/jpeg" || mime === "image/webp";
    const minQuality = 0.3;

    let blob = await canvasToBlob(srcCanvas, mime, maxQuality);
    if (!targetBytes || blob.size <= targetBytes) return blob;

    if (lossy) {
      let lo = minQuality;
      let hi = maxQuality;
      let bestUnder = null;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        const candidate = await canvasToBlob(srcCanvas, mime, mid);
        if (candidate.size <= targetBytes) {
          bestUnder = candidate;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      if (bestUnder) return bestUnder;
    }

    // Downscale dimensions (lossless formats, or lossy that can't shrink enough).
    const quality = lossy ? minQuality : undefined;
    let lo = 0.1;
    let hi = 1;
    let bestUnder = null;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      const candidate = await canvasToBlob(scaleCanvas(srcCanvas, mid), mime, quality);
      if (candidate.size <= targetBytes) {
        bestUnder = candidate;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (bestUnder) return bestUnder;
    return canvasToBlob(scaleCanvas(srcCanvas, lo), mime, quality);
  }

  // ---------- PDF compression ----------
  async function compressPdfToTarget(file, targetBytes) {
    await ensurePdfLibs();
    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    const pageCount = pdf.numPages;

    const renderScales = [2.0, 1.5, 1.2, 1.0, 0.8, 0.6, 0.45, 0.33];

    for (let s = 0; s < renderScales.length; s++) {
      setStatus(`Rendering pages (pass ${s + 1})\u2026`, "working");
      const pages = await renderPdfPages(pdf, renderScales[s], pageCount);

      // Binary search JPEG quality for the largest quality under the target.
      let lo = 0.3;
      let hi = 0.92;
      let bestEncoded = null;
      for (let i = 0; i < 5; i++) {
        const q = (lo + hi) / 2;
        const encoded = await encodePdfPages(pages, q);
        const total = encoded.reduce((sum, p) => sum + p.bytes.length, 0) + pageCount * 800 + 1024;
        if (total <= targetBytes) {
          bestEncoded = encoded;
          lo = q;
        } else {
          hi = q;
        }
      }

      if (bestEncoded) {
        const blob = await buildPdf(bestEncoded);
        if (blob.size <= targetBytes) {
          return { blob, name: baseName(file.name) + "-resized.pdf" };
        }
      }
    }

    // Best effort: smallest scale + lowest quality.
    setStatus("Applying maximum compression\u2026", "working");
    const pages = await renderPdfPages(pdf, renderScales[renderScales.length - 1], pageCount);
    const encoded = await encodePdfPages(pages, 0.3);
    const blob = await buildPdf(encoded);
    return { blob, name: baseName(file.name) + "-resized.pdf" };
  }

  async function renderPdfPages(pdf, renderScale, pageCount) {
    const pages = [];
    for (let n = 1; n <= pageCount; n++) {
      const page = await pdf.getPage(n);
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      pages.push({ canvas, ptW: baseViewport.width, ptH: baseViewport.height });
    }
    return pages;
  }

  async function encodePdfPages(pages, quality) {
    const out = [];
    for (const pg of pages) {
      const blob = await canvasToBlob(pg.canvas, "image/jpeg", quality);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      out.push({ bytes, ptW: pg.ptW, ptH: pg.ptH });
    }
    return out;
  }

  async function buildPdf(encodedPages) {
    const doc = await window.PDFLib.PDFDocument.create();
    for (const pg of encodedPages) {
      const image = await doc.embedJpg(pg.bytes);
      const page = doc.addPage([pg.ptW, pg.ptH]);
      page.drawImage(image, { x: 0, y: 0, width: pg.ptW, height: pg.ptH });
    }
    const bytes = await doc.save();
    return new Blob([bytes], { type: "application/pdf" });
  }

  let pdfLibsPromise = null;
  function ensurePdfLibs() {
    if (pdfLibsPromise) return pdfLibsPromise;
    setStatus("Loading PDF engine\u2026", "working");
    pdfLibsPromise = Promise.all([loadScript(PDFJS_SRC), loadScript(PDFLIB_SRC)])
      .then(() => {
        if (!window.pdfjsLib || !window.PDFLib) {
          throw new Error("PDF engine failed to load. Check your connection.");
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      })
      .catch((err) => {
        pdfLibsPromise = null;
        throw err;
      });
    return pdfLibsPromise;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") resolve();
        else {
          existing.addEventListener("load", resolve);
          existing.addEventListener("error", () => reject(new Error("Failed to load " + src)));
        }
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.dataset.src = src;
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(script);
    });
  }

  // ---------- Shared helpers ----------
  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed."))),
        mime,
        quality
      );
    });
  }

  function scaleCanvas(srcCanvas, factor) {
    const width = Math.max(1, Math.round(srcCanvas.width * factor));
    const height = Math.max(1, Math.round(srcCanvas.height * factor));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(srcCanvas, 0, 0, width, height);
    return canvas;
  }

  function baseName(name) {
    return (name || "file").replace(/\.[^/.]+$/, "");
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return "0 KB";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function setStatus(text, type) {
    el.resizerStatus.textContent = text;
    el.resizerStatus.classList.remove("is-working", "is-error", "is-done");
    if (type === "working") el.resizerStatus.classList.add("is-working");
    else if (type === "error") el.resizerStatus.classList.add("is-error");
    else if (type === "done") el.resizerStatus.classList.add("is-done");
  }
})();
