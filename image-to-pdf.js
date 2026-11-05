// Image to PDF: combine images into one PDF (reorder, rotate, page size,
// margins, compression). Runs fully in the browser with pdf-lib.

(function () {
  "use strict";

  const MAX_FILES = 300;
  const THUMB_BOX = 260;
  // Long-side pixel cap and JPEG quality per quality preset.
  const QUALITY = {
    high: { maxSide: 6000, jpeg: 0.95, keepPng: true },
    balanced: { maxSide: 2480, jpeg: 0.85, keepPng: false },
    small: { maxSide: 1600, jpeg: 0.68, keepPng: false }
  };

  const S = { items: [], seq: 0, resultBlob: null, busy: false };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "i2pStatus",
      "i2pScroller",
      "i2pInput",
      "i2pDropzone",
      "i2pWorkspace",
      "i2pCount",
      "i2pAddBtn",
      "i2pSortBtn",
      "i2pClearBtn",
      "i2pGrid",
      "i2pPageSize",
      "i2pOrient",
      "i2pMargin",
      "i2pQuality",
      "i2pName",
      "i2pRunBtn",
      "i2pResult",
      "i2pResultPages",
      "i2pResultSize",
      "i2pDownloadBtn"
    ].forEach((id) => (el[id] = document.getElementById(id)));

    CS.bindFileIntake({
      zone: el.i2pDropzone,
      input: el.i2pInput,
      multiple: true,
      accept: CS.isImageFile,
      onFiles: addFiles,
      onReject: () => CS.setBadge(el.i2pStatus, "Only image files can be added.", "error")
    });

    el.i2pAddBtn.addEventListener("click", () => el.i2pInput.click());
    el.i2pSortBtn.addEventListener("click", sortByName);
    el.i2pClearBtn.addEventListener("click", clearAll);
    el.i2pRunBtn.addEventListener("click", createPdf);
    el.i2pDownloadBtn.addEventListener("click", () => {
      if (S.resultBlob) CS.downloadBlob(S.resultBlob, outputName());
    });

    ["i2pOrient", "i2pMargin", "i2pQuality"].forEach((id) => CS.bindSegGroup(el[id], invalidateResult));
    el.i2pPageSize.addEventListener("change", () => {
      const fit = el.i2pPageSize.value === "fit";
      el.i2pOrient.querySelectorAll("button").forEach((b) => (b.disabled = fit));
      invalidateResult();
    });

    el.i2pGrid.addEventListener("click", onGridClick);
    CS.makeSortable(el.i2pGrid, {
      item: ".page-card",
      handle: ".drag-handle",
      scroller: el.i2pScroller,
      onChange: syncOrderFromDom
    });
  }

  // ---------- Items ----------
  async function addFiles(files) {
    const room = MAX_FILES - S.items.length;
    if (room <= 0) {
      CS.setBadge(el.i2pStatus, "Page limit reached (" + MAX_FILES + ").", "error");
      return;
    }
    const batch = files.slice(0, room);
    if (!S.items.length) {
      const first = batch[0];
      el.i2pName.value = batch.length === 1 ? CS.baseName(first.name) : "images";
    }

    el.i2pDropzone.classList.add("is-hidden");
    el.i2pWorkspace.classList.remove("is-hidden");
    CS.setBadge(el.i2pStatus, "Reading images…", "working");

    let failed = 0;
    for (const file of batch) {
      const item = { id: "i" + ++S.seq, file, name: file.name || "image", rotation: 0, thumb: null, card: null };
      S.items.push(item);
      item.card = buildCard(item);
      el.i2pGrid.appendChild(item.card);
      try {
        const img = await CS.loadImage(file);
        item.width = img.naturalWidth;
        item.height = img.naturalHeight;
        item.thumb = makeThumb(img);
        paintThumb(item);
      } catch (err) {
        failed++;
        removeItem(item.id, true);
      }
    }
    refresh();
    invalidateResult();
    if (failed) CS.setBadge(el.i2pStatus, failed + " file(s) could not be read.", "error");
    else CS.setBadge(el.i2pStatus, S.items.length + " image" + (S.items.length === 1 ? "" : "s") + " ready", "done");
    if (files.length > room) CS.setBadge(el.i2pStatus, "Only the first " + MAX_FILES + " images were added.", "error");
  }

  function makeThumb(img) {
    const scale = Math.min(1, THUMB_BOX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function buildCard(item) {
    const card = document.createElement("div");
    card.className = "page-card";
    card.dataset.id = item.id;
    card.innerHTML =
      '<div class="page-thumb"><span class="page-num"></span><span class="thumb-loading">Loading</span></div>' +
      '<span class="page-label" title="' + CS.escapeHtml(item.name) + '">' + CS.escapeHtml(item.name) + "</span>" +
      '<div class="page-card-foot">' +
      '<button type="button" class="icon-btn drag-handle" aria-label="Drag to reorder (or use arrow keys)" title="Drag to reorder"><span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span></button>' +
      '<div class="page-actions">' +
      '<button type="button" class="icon-btn" data-act="rotl" aria-label="Rotate left" title="Rotate left"><span class="material-symbols-outlined" aria-hidden="true">rotate_left</span></button>' +
      '<button type="button" class="icon-btn" data-act="rotr" aria-label="Rotate right" title="Rotate right"><span class="material-symbols-outlined" aria-hidden="true">rotate_right</span></button>' +
      '<button type="button" class="icon-btn is-danger" data-act="del" aria-label="Remove" title="Remove"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>' +
      "</div></div>";
    return card;
  }

  function paintThumb(item) {
    if (!item.thumb || !item.card) return;
    const box = item.card.querySelector(".page-thumb");
    const old = box.querySelector("canvas, .thumb-loading");
    const view = CS.rotateCanvas(item.thumb, item.rotation);
    const shown = view === item.thumb ? cloneCanvas(item.thumb) : view;
    if (old) old.replaceWith(shown);
    else box.appendChild(shown);
  }

  function cloneCanvas(src) {
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  function onGridClick(e) {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const card = btn.closest(".page-card");
    const item = S.items.find((it) => it.id === card.dataset.id);
    if (!item) return;
    if (btn.dataset.act === "del") {
      removeItem(item.id);
      return;
    }
    item.rotation = (item.rotation + (btn.dataset.act === "rotl" ? -90 : 90) + 360) % 360;
    paintThumb(item);
    invalidateResult();
  }

  function removeItem(id, silent) {
    const idx = S.items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const [item] = S.items.splice(idx, 1);
    if (item.card) item.card.remove();
    if (!silent) {
      refresh();
      invalidateResult();
    }
  }

  function syncOrderFromDom() {
    const order = Array.from(el.i2pGrid.children).map((c) => c.dataset.id);
    S.items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    refresh();
    invalidateResult();
  }

  function sortByName() {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    S.items.sort((a, b) => collator.compare(a.name, b.name));
    S.items.forEach((it) => el.i2pGrid.appendChild(it.card));
    refresh();
    invalidateResult();
  }

  function clearAll() {
    S.items = [];
    el.i2pGrid.innerHTML = "";
    refresh();
    invalidateResult();
    CS.setBadge(el.i2pStatus, "Ready", "");
  }

  function refresh() {
    const n = S.items.length;
    S.items.forEach((it, i) => {
      const num = it.card && it.card.querySelector(".page-num");
      if (num) num.textContent = String(i + 1);
    });
    el.i2pCount.textContent = n ? "(" + n + ")" : "";
    el.i2pRunBtn.disabled = !n || S.busy;
    if (!n) {
      el.i2pWorkspace.classList.add("is-hidden");
      el.i2pDropzone.classList.remove("is-hidden");
    }
  }

  function invalidateResult() {
    S.resultBlob = null;
    el.i2pResult.classList.add("is-hidden");
  }

  function outputName() {
    return CS.outputFileName(el.i2pName.value, "images", "pdf");
  }

  // ---------- PDF creation ----------
  async function createPdf() {
    if (!S.items.length || S.busy) return;
    S.busy = true;
    el.i2pRunBtn.disabled = true;
    invalidateResult();

    try {
      CS.setBadge(el.i2pStatus, "Loading PDF writer…", "working");
      const PDFLib = await CS.ensurePdfLib();
      const doc = await PDFLib.PDFDocument.create();
      const preset = QUALITY[CS.getSegValue(el.i2pQuality)] || QUALITY.balanced;
      const margin = parseFloat(CS.getSegValue(el.i2pMargin)) || 0;
      const sizeKey = el.i2pPageSize.value;
      const orient = CS.getSegValue(el.i2pOrient) || "auto";

      for (let i = 0; i < S.items.length; i++) {
        const item = S.items[i];
        CS.setBadge(el.i2pStatus, "Adding page " + (i + 1) + " of " + S.items.length + "…", "working");
        await CS.nextFrame();

        const img = await CS.loadImage(item.file);
        const prepared = await prepareImage(img, item, preset);
        const embedded = prepared.png ? await doc.embedPng(prepared.bytes) : await doc.embedJpg(prepared.bytes);
        const imgW = prepared.width;
        const imgH = prepared.height;

        let pageW;
        let pageH;
        if (sizeKey === "fit") {
          // 96 px per inch -> points, so the page is roughly the photo's on-screen size.
          const ptScale = 72 / 96;
          pageW = imgW * ptScale + margin * 2;
          pageH = imgH * ptScale + margin * 2;
        } else {
          const base = CS.PAGE_SIZES[sizeKey] || CS.PAGE_SIZES.a4;
          const landscape = orient === "landscape" || (orient === "auto" && imgW > imgH);
          pageW = landscape ? base[1] : base[0];
          pageH = landscape ? base[0] : base[1];
        }

        const boxW = Math.max(1, pageW - margin * 2);
        const boxH = Math.max(1, pageH - margin * 2);
        const scale = Math.min(boxW / imgW, boxH / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const page = doc.addPage([pageW, pageH]);
        page.drawImage(embedded, {
          x: (pageW - drawW) / 2,
          y: (pageH - drawH) / 2,
          width: drawW,
          height: drawH
        });
      }

      const name = outputName();
      doc.setTitle(CS.baseName(name));
      doc.setCreator("CropShift");
      doc.setProducer("CropShift (pdf-lib)");
      CS.setBadge(el.i2pStatus, "Saving PDF…", "working");
      const bytes = await doc.save();
      S.resultBlob = CS.pdfBlob(bytes);

      el.i2pResultPages.textContent = String(S.items.length);
      el.i2pResultSize.textContent = CS.formatBytes(S.resultBlob.size);
      el.i2pResult.classList.remove("is-hidden");
      el.i2pResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
      CS.setBadge(el.i2pStatus, "PDF ready — " + CS.formatBytes(S.resultBlob.size), "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.i2pStatus, (err && err.message) || "Could not create the PDF.", "error");
    } finally {
      S.busy = false;
      el.i2pRunBtn.disabled = !S.items.length;
    }
  }

  // Draw the image (rotated, downscaled to the preset cap) and encode it.
  async function prepareImage(img, item, preset) {
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    const scale = Math.min(1, preset.maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const isPng = /png$/i.test(item.file.type) || /\.png$/i.test(item.name);
    const keepPng = preset.keepPng && isPng;

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!keepPng) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);

    const out = CS.rotateCanvas(c, item.rotation);
    const blob = keepPng
      ? await CS.canvasToBlob(out, "image/png")
      : await CS.canvasToBlob(out, "image/jpeg", preset.jpeg);
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      png: keepPng,
      width: out.width,
      height: out.height
    };
  }
})();
