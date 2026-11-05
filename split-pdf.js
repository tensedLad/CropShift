// Split PDF: extract pages, split by custom ranges, or every N pages.
// Pages are copied with pdf-lib (lossless). Multiple outputs -> ZIP.

(function () {
  "use strict";

  const MAX_FILE_BYTES = 200 * 1024 * 1024;

  const S = { file: null, bytes: null, pdf: null, count: 0, selected: new Set(), busy: false, lazy: null };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "spStatus",
      "spScroller",
      "spInput",
      "spDropzone",
      "spWorkspace",
      "spFileName",
      "spFileInfo",
      "spChangeBtn",
      "spMode",
      "spPanelExtract",
      "spPanelRanges",
      "spPanelEvery",
      "spPages",
      "spSeparate",
      "spRanges",
      "spEvery",
      "spSummary",
      "spError",
      "spRunBtn",
      "spRunLabel",
      "spGridHint",
      "spSelTools",
      "spAllBtn",
      "spNoneBtn",
      "spGrid"
    ].forEach((id) => (el[id] = document.getElementById(id)));

    CS.bindFileIntake({
      zone: el.spDropzone,
      input: el.spInput,
      accept: CS.isPdfFile,
      onFiles: (files) => openFile(files[0]),
      onReject: () => CS.setBadge(el.spStatus, "Please choose a PDF file.", "error")
    });
    el.spChangeBtn.addEventListener("click", () => el.spInput.click());

    CS.bindSegGroup(el.spMode, onModeChange);
    el.spPages.addEventListener("input", () => {
      syncSelectionFromInput();
      updateSummary();
    });
    el.spSeparate.addEventListener("change", updateSummary);
    el.spRanges.addEventListener("input", updateSummary);
    el.spEvery.addEventListener("input", updateSummary);
    el.spAllBtn.addEventListener("click", () => setSelection(range(1, S.count)));
    el.spNoneBtn.addEventListener("click", () => setSelection([]));
    el.spGrid.addEventListener("click", (e) => {
      const card = e.target.closest(".page-card");
      if (card) togglePage(parseInt(card.dataset.page, 10));
    });
    el.spGrid.addEventListener("keydown", (e) => {
      const card = e.target.closest(".page-card");
      if (card && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        togglePage(parseInt(card.dataset.page, 10));
      }
    });
    el.spRunBtn.addEventListener("click", runSplit);
  }

  function range(a, b) {
    const out = [];
    for (let n = a; n <= b; n++) out.push(n);
    return out;
  }

  async function openFile(file) {
    if (S.busy) return;
    if (file.size > MAX_FILE_BYTES) {
      CS.setBadge(el.spStatus, "File is too large (max " + CS.formatBytes(MAX_FILE_BYTES) + ").", "error");
      return;
    }
    CS.setBadge(el.spStatus, "Opening PDF…", "working");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await CS.openPdfLib(bytes); // fail early on encrypted files
      const pdf = await CS.openPdfJs(bytes);
      if (S.pdf) S.pdf.destroy();
      if (S.lazy) S.lazy.disconnect();
      Object.assign(S, { file, bytes, pdf, count: pdf.numPages, selected: new Set() });

      el.spFileName.textContent = file.name;
      el.spFileInfo.textContent = S.count + " page" + (S.count === 1 ? "" : "s") + " · " + CS.formatBytes(file.size);
      el.spDropzone.classList.add("is-hidden");
      el.spWorkspace.classList.remove("is-hidden");
      el.spPages.value = "";
      el.spRanges.value = S.count > 1 ? "1-" + Math.ceil(S.count / 2) + ", " + (Math.ceil(S.count / 2) + 1) + "-" + S.count : "1";
      buildGrid();
      updateSummary();
      CS.setBadge(el.spStatus, "Ready", "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.spStatus, err.message || "Could not open this PDF.", "error");
    }
  }

  function buildGrid() {
    el.spGrid.innerHTML = "";
    S.lazy = CS.createLazyQueue(el.spScroller);
    const pdf = S.pdf;
    for (let n = 1; n <= S.count; n++) {
      const card = document.createElement("div");
      card.className = "page-card is-selectable";
      card.dataset.page = String(n);
      card.tabIndex = 0;
      card.setAttribute("role", "checkbox");
      card.setAttribute("aria-checked", "false");
      card.innerHTML =
        '<div class="page-thumb"><span class="page-num">' + n + "</span>" +
        '<span class="page-check" aria-hidden="true"><span class="material-symbols-outlined">check</span></span>' +
        '<span class="thumb-loading">Page ' + n + "</span></div>" +
        '<span class="page-label">Page ' + n + "</span>";
      el.spGrid.appendChild(card);
      S.lazy.observe(card, async () => {
        if (S.pdf !== pdf) return;
        const thumb = await CS.renderThumb(await pdf.getPage(n), 220);
        const slot = card.querySelector(".thumb-loading");
        if (slot) slot.replaceWith(thumb);
      });
    }
  }

  // ---------- Modes ----------
  function mode() {
    return CS.getSegValue(el.spMode) || "extract";
  }

  function onModeChange() {
    const m = mode();
    el.spPanelExtract.classList.toggle("is-hidden", m !== "extract");
    el.spPanelRanges.classList.toggle("is-hidden", m !== "ranges");
    el.spPanelEvery.classList.toggle("is-hidden", m !== "every");
    const selectable = m === "extract";
    el.spSelTools.classList.toggle("is-hidden", !selectable);
    el.spGridHint.textContent = selectable
      ? "Click pages to add or remove them from the extraction."
      : "Preview of the document's pages.";
    el.spGrid.querySelectorAll(".page-card").forEach((c) => {
      c.classList.toggle("is-selectable", selectable);
      c.tabIndex = selectable ? 0 : -1;
    });
    paintSelection();
    updateSummary();
  }

  function togglePage(n) {
    if (mode() !== "extract" || !n) return;
    const next = new Set(S.selected);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setSelection(Array.from(next));
  }

  function setSelection(pages) {
    S.selected = new Set(pages);
    el.spPages.value = compress(Array.from(S.selected).sort((a, b) => a - b));
    paintSelection();
    updateSummary();
  }

  function syncSelectionFromInput() {
    try {
      S.selected = new Set(CS.rangesToPages(CS.parseRanges(el.spPages.value, S.count)));
    } catch (_) {
      S.selected = new Set();
    }
    paintSelection();
  }

  function paintSelection() {
    const on = mode() === "extract";
    el.spGrid.querySelectorAll(".page-card").forEach((c) => {
      const sel = on && S.selected.has(parseInt(c.dataset.page, 10));
      c.classList.toggle("is-selected", sel);
      c.setAttribute("aria-checked", sel ? "true" : "false");
    });
  }

  // [1,2,3,5,7,8] -> "1-3, 5, 7-8"
  function compress(pages) {
    const parts = [];
    for (let i = 0; i < pages.length; i++) {
      const start = pages[i];
      let end = start;
      while (i + 1 < pages.length && pages[i + 1] === end + 1) end = pages[++i];
      parts.push(start === end ? String(start) : start + "-" + end);
    }
    return parts.join(", ");
  }

  // Returns [{ name, pages: [1-based] }] for the current mode, or throws.
  function plan() {
    const base = CS.baseName(S.file.name);
    const m = mode();
    if (m === "extract") {
      const pages = CS.rangesToPages(CS.parseRanges(el.spPages.value, S.count));
      if (el.spSeparate.checked) {
        return pages.map((n) => ({ name: base + "-page-" + n + ".pdf", pages: [n] }));
      }
      const label = compress(pages.slice().sort((a, b) => a - b)).replace(/, /g, "_");
      return [{ name: base + (label.length <= 30 ? "-pages-" + label : "-extract") + ".pdf", pages }];
    }
    if (m === "ranges") {
      return CS.parseRanges(el.spRanges.value, S.count).map((r) => ({
        name: base + "-" + (r.from === r.to ? "page-" + r.from : r.from + "-" + r.to) + ".pdf",
        pages: range(r.from, r.to)
      }));
    }
    const n = parseInt(el.spEvery.value, 10);
    if (!n || n < 1) throw new Error("Pages per file must be 1 or more.");
    const out = [];
    const pad = String(Math.ceil(S.count / n)).length;
    for (let start = 1, part = 1; start <= S.count; start += n, part++) {
      const end = Math.min(S.count, start + n - 1);
      out.push({
        name: base + (n === 1 ? "-page-" + String(start).padStart(pad, "0") : "-part-" + String(part).padStart(pad, "0")) + ".pdf",
        pages: range(start, end)
      });
    }
    return out;
  }

  function updateSummary() {
    if (!S.file) return;
    let jobs = null;
    let error = "";
    try {
      jobs = plan();
    } catch (err) {
      error = err.message;
    }
    const empty = mode() === "extract" && !el.spPages.value.trim();
    el.spError.textContent = empty ? "" : error;
    el.spError.classList.toggle("is-hidden", !error || empty);
    const input = mode() === "extract" ? el.spPages : mode() === "ranges" ? el.spRanges : el.spEvery;
    [el.spPages, el.spRanges, el.spEvery].forEach((i) => i.classList.remove("is-invalid"));
    if (error && !empty) input.classList.add("is-invalid");

    if (!jobs) {
      el.spSummary.textContent = empty ? "Type pages or click them below." : "";
      el.spRunBtn.disabled = true;
      el.spRunLabel.textContent = "Split & download";
      return;
    }
    const pages = jobs.reduce((s, j) => s + j.pages.length, 0);
    el.spSummary.textContent =
      jobs.length === 1
        ? "Creates 1 PDF with " + pages + " page" + (pages === 1 ? "" : "s") + "."
        : "Creates " + jobs.length + " PDFs (" + pages + " pages total), downloaded as a ZIP.";
    el.spRunBtn.disabled = S.busy;
    el.spRunLabel.textContent = jobs.length === 1 ? "Extract & download PDF" : "Split & download ZIP";
  }

  async function runSplit() {
    if (S.busy || !S.file) return;
    let jobs;
    try {
      jobs = plan();
    } catch (err) {
      CS.setBadge(el.spStatus, err.message, "error");
      return;
    }
    S.busy = true;
    el.spRunBtn.disabled = true;
    try {
      const PDFLib = await CS.ensurePdfLib();
      const src = await CS.openPdfLib(S.bytes);
      const outputs = [];
      for (let i = 0; i < jobs.length; i++) {
        CS.setBadge(el.spStatus, "Creating file " + (i + 1) + " of " + jobs.length + "…", "working");
        if (i % 5 === 0) await CS.nextFrame();
        const doc = await PDFLib.PDFDocument.create();
        const pages = await doc.copyPages(src, jobs[i].pages.map((n) => n - 1));
        pages.forEach((p) => doc.addPage(p));
        doc.setCreator("CropShift");
        doc.setProducer("CropShift (pdf-lib)");
        outputs.push({ name: jobs[i].name, bytes: await doc.save() });
      }
      if (outputs.length === 1) {
        const blob = CS.pdfBlob(outputs[0].bytes);
        CS.downloadBlob(blob, outputs[0].name);
        CS.setBadge(el.spStatus, "Saved " + outputs[0].name + " (" + CS.formatBytes(blob.size) + ")", "done");
      } else {
        CS.setBadge(el.spStatus, "Packing ZIP…", "working");
        const zip = await CS.makeZip(outputs);
        CS.downloadBlob(zip, CS.baseName(S.file.name) + "-split.zip");
        CS.setBadge(el.spStatus, outputs.length + " PDFs saved (" + CS.formatBytes(zip.size) + " ZIP)", "done");
      }
    } catch (err) {
      console.error(err);
      CS.setBadge(el.spStatus, (err && err.message) || "Split failed.", "error");
    } finally {
      S.busy = false;
      updateSummary();
    }
  }
})();
