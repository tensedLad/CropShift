// Extract Text: OCR for images (tesseract.js, runs in a Web Worker) and text
// extraction for PDFs (pdf.js text layer, with OCR fallback for scanned pages).

(function () {
  "use strict";

  const MAX_FILE_BYTES = 200 * 1024 * 1024;
  const OCR_SCALE = 2.5; // ~180 DPI for PDF pages that need OCR
  const MAX_PIXELS = 14 * 1000 * 1000;

  const S = { files: [], kind: null, busy: false, worker: null, workerLang: null, thumbUrl: null };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "ocrStatus",
      "ocrInput",
      "ocrDropzone",
      "ocrWorkspace",
      "ocrFileIcon",
      "ocrFileName",
      "ocrFileInfo",
      "ocrChangeBtn",
      "ocrThumbWrap",
      "ocrThumb",
      "ocrLang",
      "ocrPdfOpts",
      "ocrUseLayer",
      "ocrProgress",
      "ocrRunBtn",
      "ocrResult",
      "ocrStats",
      "ocrCopyBtn",
      "ocrSaveBtn",
      "ocrOutput"
    ].forEach((id) => (el[id] = document.getElementById(id)));

    CS.bindFileIntake({
      zone: el.ocrDropzone,
      input: el.ocrInput,
      multiple: true,
      accept: (f) => CS.isImageFile(f) || CS.isPdfFile(f),
      onFiles: setFiles,
      onReject: () => CS.setBadge(el.ocrStatus, "Use an image or a PDF.", "error")
    });
    el.ocrChangeBtn.addEventListener("click", () => el.ocrInput.click());
    el.ocrRunBtn.addEventListener("click", run);
    el.ocrCopyBtn.addEventListener("click", copyText);
    el.ocrSaveBtn.addEventListener("click", () => {
      const base = S.files.length === 1 ? CS.baseName(S.files[0].name) : "extracted";
      CS.downloadBlob(new Blob([el.ocrOutput.value], { type: "text/plain;charset=utf-8" }), base + ".txt");
    });
    el.ocrOutput.addEventListener("input", updateStats);
    el.ocrLang.addEventListener("change", () => {
      try {
        localStorage.setItem("cropshift.ocrLang", el.ocrLang.value);
      } catch (_) {
        /* storage unavailable */
      }
    });
    try {
      const saved = localStorage.getItem("cropshift.ocrLang");
      if (saved && el.ocrLang.querySelector('option[value="' + saved + '"]')) el.ocrLang.value = saved;
    } catch (_) {
      /* storage unavailable */
    }
  }

  function setFiles(files) {
    if (S.busy) return;
    // A PDF is processed on its own; images can be batched.
    const pdf = files.find(CS.isPdfFile);
    const list = pdf ? [pdf] : files.filter(CS.isImageFile);
    const tooBig = list.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      CS.setBadge(el.ocrStatus, tooBig.name + " is too large.", "error");
      return;
    }
    S.files = list;
    S.kind = pdf ? "pdf" : "image";

    el.ocrDropzone.classList.add("is-hidden");
    el.ocrWorkspace.classList.remove("is-hidden");
    el.ocrResult.classList.add("is-hidden");
    el.ocrOutput.value = "";
    el.ocrFileIcon.textContent = pdf ? "picture_as_pdf" : "image";
    el.ocrFileName.textContent = list.length === 1 ? list[0].name : list.length + " images";
    el.ocrFileInfo.textContent = CS.formatBytes(list.reduce((s, f) => s + f.size, 0));
    el.ocrPdfOpts.classList.toggle("is-hidden", !pdf);

    if (S.thumbUrl) URL.revokeObjectURL(S.thumbUrl);
    S.thumbUrl = null;
    if (!pdf && list.length === 1) {
      S.thumbUrl = URL.createObjectURL(list[0]);
      el.ocrThumb.src = S.thumbUrl;
      el.ocrThumbWrap.classList.remove("is-hidden");
    } else {
      el.ocrThumbWrap.classList.add("is-hidden");
    }
    el.ocrRunBtn.disabled = false;
    CS.setBadge(el.ocrStatus, "Ready", "");
  }

  // ---------- OCR worker ----------
  async function getWorker(lang) {
    if (S.worker && S.workerLang === lang) return S.worker;
    if (S.worker) {
      await S.worker.terminate();
      S.worker = null;
    }
    const Tesseract = await CS.ensureTesseract();
    CS.setBadge(el.ocrStatus, "Loading OCR engine & language data…", "working");
    S.worker = await Tesseract.createWorker(lang, 1, {
      logger: (m) => {
        if (m && m.status === "recognizing text" && S.onProgress) S.onProgress(m.progress || 0);
      }
    });
    S.workerLang = lang;
    return S.worker;
  }

  async function ocr(source, lang, onProgress) {
    const worker = await getWorker(lang);
    S.onProgress = onProgress;
    try {
      const result = await worker.recognize(source);
      return (result && result.data && result.data.text) || "";
    } finally {
      S.onProgress = null;
    }
  }

  // ---------- Run ----------
  async function run() {
    if (S.busy || !S.files.length) return;
    S.busy = true;
    el.ocrRunBtn.disabled = true;
    el.ocrProgress.classList.remove("is-hidden");
    setProgress(0);
    const lang = el.ocrLang.value;

    try {
      const text = S.kind === "pdf" ? await extractPdf(S.files[0], lang) : await extractImages(S.files, lang);
      el.ocrOutput.value = text.replace(/\n{3,}/g, "\n\n").trim();
      el.ocrResult.classList.remove("is-hidden");
      updateStats();
      el.ocrResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
      CS.setBadge(
        el.ocrStatus,
        el.ocrOutput.value ? "Done" : "No text found. Try a sharper image or another language.",
        el.ocrOutput.value ? "done" : "error"
      );
    } catch (err) {
      console.error(err);
      CS.setBadge(el.ocrStatus, (err && err.message) || "Text extraction failed.", "error");
    } finally {
      S.busy = false;
      el.ocrRunBtn.disabled = false;
      setProgress(1);
      setTimeout(() => el.ocrProgress.classList.add("is-hidden"), 800);
    }
  }

  async function extractImages(files, lang) {
    const parts = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      CS.setBadge(el.ocrStatus, "Reading " + (files.length > 1 ? "image " + (i + 1) + " of " + files.length : "image") + "…", "working");
      const img = await CS.loadImage(f); // decodes formats tesseract can't (webp, avif) and applies EXIF rotation
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (img.naturalWidth * img.naturalHeight)));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const text = await ocr(canvas, lang, (p) => setProgress((i + p) / files.length));
      parts.push(files.length > 1 ? "===== " + f.name + " =====\n" + text.trim() : text.trim());
      setProgress((i + 1) / files.length);
    }
    return parts.join("\n\n");
  }

  async function extractPdf(file, lang) {
    CS.setBadge(el.ocrStatus, "Opening PDF…", "working");
    const pdf = await CS.openPdfJs(new Uint8Array(await file.arrayBuffer()));
    const useLayer = el.ocrUseLayer.checked;
    const parts = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        let text = "";
        if (useLayer) {
          CS.setBadge(el.ocrStatus, "Reading page " + n + " of " + pdf.numPages + "…", "working");
          const content = await page.getTextContent();
          text = content.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : " ")).join("");
          text = text.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
        }
        if (text.replace(/\s/g, "").length < 15) {
          // Scanned page (or text layer disabled): OCR the rendered page.
          CS.setBadge(el.ocrStatus, "OCR page " + n + " of " + pdf.numPages + "…", "working");
          const vp = page.getViewport({ scale: 1 });
          let scale = OCR_SCALE;
          const area = vp.width * vp.height * scale * scale;
          if (area > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / area);
          const canvas = await CS.renderPdfPage(page, scale, 0);
          text = (await ocr(canvas, lang, (p) => setProgress((n - 1 + p) / pdf.numPages))).trim();
          canvas.width = canvas.height = 0;
        }
        parts.push(pdf.numPages > 1 ? "===== Page " + n + " =====\n" + text : text);
        setProgress(n / pdf.numPages);
        page.cleanup();
      }
    } finally {
      pdf.destroy();
    }
    return parts.join("\n\n");
  }

  // ---------- Output ----------
  function setProgress(fraction) {
    el.ocrProgress.firstElementChild.style.width = Math.round(Math.min(1, Math.max(0, fraction)) * 100) + "%";
  }

  function updateStats() {
    const text = el.ocrOutput.value;
    const words = (text.match(/\S+/g) || []).length;
    el.ocrStats.textContent = words + " words · " + text.length + " characters";
  }

  async function copyText() {
    const text = el.ocrOutput.value;
    try {
      await navigator.clipboard.writeText(text);
      CS.setBadge(el.ocrStatus, "Copied to clipboard", "done");
    } catch (_) {
      el.ocrOutput.select();
      document.execCommand("copy");
      CS.setBadge(el.ocrStatus, "Copied to clipboard", "done");
    }
  }
})();
