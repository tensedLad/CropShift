// PDF to Image: render PDF pages to JPG / PNG / WEBP with pdf.js.
// One page downloads directly; several are bundled into a ZIP.

(function () {
  "use strict";

  const MAX_FILE_BYTES = 200 * 1024 * 1024;
  const MAX_PIXELS = 16 * 1000 * 1000; // stay under mobile Safari's canvas limit
  const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

  const S = { file: null, pdf: null, pageCount: 0, selected: new Set(), busy: false, lazy: null };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "p2iStatus",
      "p2iScroller",
      "p2iInput",
      "p2iDropzone",
      "p2iWorkspace",
      "p2iFileName",
      "p2iFileInfo",
      "p2iChangeBtn",
      "p2iFormat",
      "p2iDpi",
      "p2iQuality",
      "p2iQualityVal",
      "p2iSelCount",
      "p2iAllBtn",
      "p2iNoneBtn",
      "p2iGrid",
      "p2iProgress",
      "p2iRunBtn",
      "p2iRunLabel"
    ].forEach((id) => (el[id] = document.getElementById(id)));

    CS.bindFileIntake({
      zone: el.p2iDropzone,
      input: el.p2iInput,
      accept: CS.isPdfFile,
      onFiles: (files) => openFile(files[0]),
      onReject: () => CS.setBadge(el.p2iStatus, "Please choose a PDF file.", "error")
    });
    el.p2iChangeBtn.addEventListener("click", () => el.p2iInput.click());

    CS.bindSegGroup(el.p2iFormat, updateQualityState);
    el.p2iQuality.addEventListener("input", () => {
      el.p2iQualityVal.textContent = el.p2iQuality.value + "%";
    });
    el.p2iAllBtn.addEventListener("click", () => selectAll(true));
    el.p2iNoneBtn.addEventListener("click", () => selectAll(false));
    el.p2iGrid.addEventListener("click", onGridClick);
    el.p2iRunBtn.addEventListener("click", convertSelected);
    updateQualityState();
  }

  function updateQualityState() {
    const lossless = CS.getSegValue(el.p2iFormat) === "png";
    el.p2iQuality.disabled = lossless;
  }

  async function openFile(file) {
    if (S.busy) return;
    if (file.size > MAX_FILE_BYTES) {
      CS.setBadge(el.p2iStatus, "File is too large (max " + CS.formatBytes(MAX_FILE_BYTES) + ").", "error");
      return;
    }
    CS.setBadge(el.p2iStatus, "Opening PDF…", "working");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await CS.openPdfJs(bytes);
      if (S.pdf) S.pdf.destroy();
      if (S.lazy) S.lazy.disconnect();
      S.file = file;
      S.pdf = pdf;
      S.pageCount = pdf.numPages;
      S.selected = new Set();
      for (let n = 1; n <= S.pageCount; n++) S.selected.add(n);

      el.p2iFileName.textContent = file.name;
      el.p2iFileInfo.textContent =
        S.pageCount + " page" + (S.pageCount === 1 ? "" : "s") + " · " + CS.formatBytes(file.size);
      el.p2iDropzone.classList.add("is-hidden");
      el.p2iWorkspace.classList.remove("is-hidden");
      buildGrid();
      refreshSelection();
      CS.setBadge(el.p2iStatus, "Ready", "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.p2iStatus, err.message || "Could not open this PDF.", "error");
    }
  }

  function buildGrid() {
    el.p2iGrid.innerHTML = "";
    S.lazy = CS.createLazyQueue(el.p2iScroller);
    const pdf = S.pdf;
    for (let n = 1; n <= S.pageCount; n++) {
      const card = document.createElement("div");
      card.className = "page-card is-selectable";
      card.dataset.page = String(n);
      card.tabIndex = 0;
      card.setAttribute("role", "checkbox");
      card.innerHTML =
        '<div class="page-thumb"><span class="page-num">' + n + "</span>" +
        '<span class="page-check" aria-hidden="true"><span class="material-symbols-outlined">check</span></span>' +
        '<span class="thumb-loading">Page ' + n + "</span></div>" +
        '<div class="page-card-foot"><span class="page-label">Page ' + n + "</span>" +
        '<button type="button" class="icon-btn" data-act="one" aria-label="Download page ' + n + '" title="Download this page"><span class="material-symbols-outlined" aria-hidden="true">download</span></button>' +
        "</div>";
      card.addEventListener("keydown", (e) => {
        if ((e.key === " " || e.key === "Enter") && e.target === card) {
          e.preventDefault();
          toggle(n);
        }
      });
      el.p2iGrid.appendChild(card);
      S.lazy.observe(card, async () => {
        if (S.pdf !== pdf) return;
        const page = await pdf.getPage(n);
        const thumb = await CS.renderThumb(page, 220);
        const slot = card.querySelector(".thumb-loading");
        if (slot) slot.replaceWith(thumb);
      });
    }
  }

  function onGridClick(e) {
    const card = e.target.closest(".page-card");
    if (!card) return;
    const n = parseInt(card.dataset.page, 10);
    if (e.target.closest('[data-act="one"]')) {
      convertPages([n]);
      return;
    }
    toggle(n);
  }

  function toggle(n) {
    if (S.selected.has(n)) S.selected.delete(n);
    else S.selected.add(n);
    refreshSelection();
  }

  function selectAll(on) {
    S.selected = new Set();
    if (on) for (let n = 1; n <= S.pageCount; n++) S.selected.add(n);
    refreshSelection();
  }

  function refreshSelection() {
    el.p2iGrid.querySelectorAll(".page-card").forEach((card) => {
      const on = S.selected.has(parseInt(card.dataset.page, 10));
      card.classList.toggle("is-selected", on);
      card.setAttribute("aria-checked", on ? "true" : "false");
    });
    const count = S.selected.size;
    el.p2iSelCount.textContent = "(" + count + " of " + S.pageCount + " selected)";
    el.p2iRunBtn.disabled = !count || S.busy;
    el.p2iRunLabel.textContent =
      count > 1 ? "Convert " + count + " pages & download ZIP" : count === 1 ? "Convert & download image" : "Select pages";
  }

  function convertSelected() {
    const pages = Array.from(S.selected).sort((a, b) => a - b);
    if (pages.length) convertPages(pages);
  }

  async function convertPages(pages) {
    if (S.busy || !S.pdf) return;
    S.busy = true;
    el.p2iRunBtn.disabled = true;
    const fmt = CS.getSegValue(el.p2iFormat) || "jpg";
    const mime = MIME[fmt];
    const quality = parseInt(el.p2iQuality.value, 10) / 100;
    const dpi = parseInt(el.p2iDpi.value, 10) || 150;
    const base = CS.baseName(S.file.name);
    const bar = el.p2iProgress.firstElementChild;
    el.p2iProgress.classList.remove("is-hidden");
    bar.style.width = "0%";

    try {
      const outputs = [];
      const pad = String(S.pageCount).length;
      for (let i = 0; i < pages.length; i++) {
        const n = pages[i];
        CS.setBadge(el.p2iStatus, "Rendering page " + n + " (" + (i + 1) + "/" + pages.length + ")…", "working");
        const page = await S.pdf.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        let scale = dpi / 72;
        const area = vp.width * vp.height * scale * scale;
        if (area > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / area);
        const canvas = await CS.renderPdfPage(page, scale, 0);
        const blob = await CS.canvasToBlob(canvas, mime, fmt === "png" ? undefined : quality);
        canvas.width = canvas.height = 0; // free memory early
        outputs.push({ name: base + "-page-" + String(n).padStart(pad, "0") + "." + fmt, blob });
        bar.style.width = Math.round(((i + 1) / pages.length) * 100) + "%";
        await CS.nextFrame();
      }

      if (outputs.length === 1) {
        CS.downloadBlob(outputs[0].blob, outputs[0].name);
        CS.setBadge(el.p2iStatus, "Saved " + outputs[0].name + " (" + CS.formatBytes(outputs[0].blob.size) + ")", "done");
      } else {
        CS.setBadge(el.p2iStatus, "Packing ZIP…", "working");
        const zip = await CS.makeZip(outputs);
        CS.downloadBlob(zip, base + "-images.zip");
        CS.setBadge(el.p2iStatus, outputs.length + " images saved (" + CS.formatBytes(zip.size) + " ZIP)", "done");
      }
    } catch (err) {
      console.error(err);
      CS.setBadge(el.p2iStatus, (err && err.message) || "Conversion failed.", "error");
    } finally {
      S.busy = false;
      setTimeout(() => el.p2iProgress.classList.add("is-hidden"), 800);
      refreshSelection();
    }
  }
})();
