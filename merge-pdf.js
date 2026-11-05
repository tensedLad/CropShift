// Merge & Organize: combine PDFs (and images) into one PDF; reorder, rotate,
// select and delete pages. Pages are copied with pdf-lib, so text and vector
// content are preserved (nothing is re-rendered).

(function () {
  "use strict";

  const MAX_FILE_BYTES = 200 * 1024 * 1024;
  const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee", "#fb923c"];

  const S = { sources: [], pages: [], seq: 0, busy: false, lazy: null };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "mgStatus",
      "mgScroller",
      "mgInput",
      "mgDropzone",
      "mgWorkspace",
      "mgCount",
      "mgAddBtn",
      "mgRotateSelBtn",
      "mgDeleteSelBtn",
      "mgReverseBtn",
      "mgClearBtn",
      "mgFiles",
      "mgGrid",
      "mgName",
      "mgRunBtn"
    ].forEach((id) => (el[id] = document.getElementById(id)));

    S.lazy = CS.createLazyQueue(el.mgScroller);

    CS.bindFileIntake({
      zone: el.mgDropzone,
      input: el.mgInput,
      multiple: true,
      accept: (f) => CS.isPdfFile(f) || CS.isImageFile(f),
      onFiles: addFiles,
      onReject: () => CS.setBadge(el.mgStatus, "Only PDFs and images can be added.", "error")
    });

    el.mgAddBtn.addEventListener("click", () => el.mgInput.click());
    el.mgRotateSelBtn.addEventListener("click", () => {
      S.pages.filter((p) => p.selected).forEach((p) => rotatePage(p, 90));
    });
    el.mgDeleteSelBtn.addEventListener("click", () => {
      S.pages.filter((p) => p.selected).forEach((p) => removePage(p, true));
      refresh();
    });
    el.mgReverseBtn.addEventListener("click", () => {
      S.pages.reverse();
      S.pages.forEach((p) => el.mgGrid.appendChild(p.card));
      refresh();
    });
    el.mgClearBtn.addEventListener("click", clearAll);
    el.mgRunBtn.addEventListener("click", savePdf);
    el.mgFiles.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-src]");
      if (btn) removeSource(btn.dataset.removeSrc);
    });

    el.mgGrid.addEventListener("click", onGridClick);
    el.mgGrid.addEventListener("keydown", (e) => {
      const card = e.target.classList && e.target.classList.contains("page-card") ? e.target : null;
      if (card && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        toggleSelect(findPage(card.dataset.id));
      }
    });
    CS.makeSortable(el.mgGrid, {
      item: ".page-card",
      handle: ".drag-handle",
      scroller: el.mgScroller,
      onChange: () => {
        const order = Array.from(el.mgGrid.children).map((c) => c.dataset.id);
        S.pages.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        refresh();
      }
    });
  }

  // ---------- Adding sources ----------
  async function addFiles(files) {
    if (S.busy) return;
    S.busy = true;
    el.mgDropzone.classList.add("is-hidden");
    el.mgWorkspace.classList.remove("is-hidden");
    if (!S.sources.length) {
      el.mgName.value = files.length === 1 ? CS.baseName(files[0].name) + "-organized" : "merged";
    }

    const errors = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        errors.push(file.name + " is too large");
        continue;
      }
      CS.setBadge(el.mgStatus, "Reading " + file.name + "…", "working");
      try {
        if (CS.isPdfFile(file)) await addPdf(file);
        else await addImage(file);
      } catch (err) {
        console.error(err);
        errors.push(file.name + ": " + (err.message || "could not be read"));
      }
    }
    S.busy = false;
    refresh();
    if (errors.length) CS.setBadge(el.mgStatus, errors[0], "error");
    else CS.setBadge(el.mgStatus, S.pages.length + " pages ready", "done");
  }

  async function addPdf(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await CS.openPdfLib(bytes); // validate (encryption, damage) before showing pages
    const pdf = await CS.openPdfJs(bytes);
    const src = newSource(file, "pdf", bytes);
    src.pdf = pdf;
    src.count = pdf.numPages;
    for (let i = 0; i < pdf.numPages; i++) addPageCard(src, i);
  }

  async function addImage(file) {
    const img = await CS.loadImage(file);
    const src = newSource(file, "image", new Uint8Array(await file.arrayBuffer()));
    src.count = 1;
    src.width = img.naturalWidth;
    src.height = img.naturalHeight;
    const scale = Math.min(1, 240 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    src.thumb = c;
    addPageCard(src, 0);
  }

  function newSource(file, kind, bytes) {
    const src = {
      id: "s" + ++S.seq,
      name: file.name || (kind === "pdf" ? "document.pdf" : "image"),
      type: file.type,
      kind,
      bytes,
      color: COLORS[S.sources.length % COLORS.length]
    };
    S.sources.push(src);
    return src;
  }

  function addPageCard(src, index) {
    const page = { id: "p" + ++S.seq, src, index, rotation: 0, selected: false, thumb: null, card: null };
    const card = document.createElement("div");
    card.className = "page-card is-selectable";
    card.dataset.id = page.id;
    card.tabIndex = 0;
    card.style.borderTop = "3px solid " + src.color;
    const label = src.kind === "pdf" ? CS.baseName(src.name) + " · p" + (index + 1) : CS.baseName(src.name);
    card.innerHTML =
      '<div class="page-thumb"><span class="page-num"></span>' +
      '<span class="page-check" aria-hidden="true"><span class="material-symbols-outlined">check</span></span>' +
      '<span class="thumb-loading">Loading</span></div>' +
      '<span class="page-label" title="' + CS.escapeHtml(label) + '">' + CS.escapeHtml(label) + "</span>" +
      '<div class="page-card-foot">' +
      '<button type="button" class="icon-btn drag-handle" aria-label="Drag to reorder (or use arrow keys)" title="Drag to reorder"><span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span></button>' +
      '<div class="page-actions">' +
      '<button type="button" class="icon-btn" data-act="rotl" aria-label="Rotate left" title="Rotate left"><span class="material-symbols-outlined" aria-hidden="true">rotate_left</span></button>' +
      '<button type="button" class="icon-btn" data-act="rotr" aria-label="Rotate right" title="Rotate right"><span class="material-symbols-outlined" aria-hidden="true">rotate_right</span></button>' +
      '<button type="button" class="icon-btn is-danger" data-act="del" aria-label="Delete page" title="Delete page"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>' +
      "</div></div>";
    page.card = card;
    S.pages.push(page);
    el.mgGrid.appendChild(card);

    if (src.kind === "image") {
      page.thumb = src.thumb;
      paintThumb(page);
    } else {
      S.lazy.observe(card, async () => {
        if (!S.pages.includes(page)) return;
        const pg = await src.pdf.getPage(index + 1);
        page.thumb = await CS.renderThumb(pg, 220);
        paintThumb(page);
      });
    }
  }

  function paintThumb(page) {
    if (!page.thumb) return;
    const box = page.card.querySelector(".page-thumb");
    const old = box.querySelector("canvas, .thumb-loading");
    let view = CS.rotateCanvas(page.thumb, page.rotation);
    if (view === page.thumb) {
      view = document.createElement("canvas");
      view.width = page.thumb.width;
      view.height = page.thumb.height;
      view.getContext("2d").drawImage(page.thumb, 0, 0);
    }
    if (old) old.replaceWith(view);
    else box.appendChild(view);
  }

  // ---------- Page actions ----------
  function findPage(id) {
    return S.pages.find((p) => p.id === id);
  }

  function onGridClick(e) {
    const card = e.target.closest(".page-card");
    if (!card) return;
    const page = findPage(card.dataset.id);
    if (!page) return;
    const btn = e.target.closest("button");
    if (btn && btn.dataset.act) {
      if (btn.dataset.act === "del") {
        removePage(page);
      } else {
        rotatePage(page, btn.dataset.act === "rotl" ? -90 : 90);
      }
      return;
    }
    if (btn) return; // drag handle
    toggleSelect(page);
  }

  function toggleSelect(page) {
    if (!page) return;
    page.selected = !page.selected;
    page.card.classList.toggle("is-selected", page.selected);
    refresh();
  }

  function rotatePage(page, delta) {
    page.rotation = (page.rotation + delta + 360) % 360;
    paintThumb(page);
  }

  function removePage(page, silent) {
    const idx = S.pages.indexOf(page);
    if (idx < 0) return;
    S.pages.splice(idx, 1);
    page.card.remove();
    if (!silent) refresh();
  }

  function removeSource(srcId) {
    S.pages.filter((p) => p.src.id === srcId).forEach((p) => removePage(p, true));
    refresh();
  }

  function clearAll() {
    S.pages.forEach((p) => p.card.remove());
    S.pages = [];
    refresh();
    CS.setBadge(el.mgStatus, "Ready", "");
  }

  function refresh() {
    // Drop sources that no longer have pages.
    S.sources = S.sources.filter((src) => {
      const used = S.pages.some((p) => p.src === src);
      if (!used && src.pdf) src.pdf.destroy();
      return used;
    });

    S.pages.forEach((p, i) => {
      p.card.querySelector(".page-num").textContent = String(i + 1);
    });
    const selected = S.pages.filter((p) => p.selected).length;
    el.mgCount.textContent = S.pages.length ? "(" + S.pages.length + (selected ? ", " + selected + " selected" : "") + ")" : "";
    el.mgRotateSelBtn.disabled = !selected;
    el.mgDeleteSelBtn.disabled = !selected;
    el.mgRunBtn.disabled = !S.pages.length || S.busy;

    el.mgFiles.innerHTML = S.sources
      .map(
        (src) =>
          '<span class="file-chip"><span class="file-chip-dot" style="background:' + src.color + '"></span>' +
          '<span class="file-chip-name" title="' + CS.escapeHtml(src.name) + '">' + CS.escapeHtml(src.name) + "</span>" +
          '<button type="button" class="icon-btn" data-remove-src="' + src.id + '" aria-label="Remove ' + CS.escapeHtml(src.name) + '" title="Remove file"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></span>'
      )
      .join("");

    if (!S.pages.length) {
      el.mgWorkspace.classList.add("is-hidden");
      el.mgDropzone.classList.remove("is-hidden");
    }
  }

  // ---------- Export ----------
  async function savePdf() {
    if (!S.pages.length || S.busy) return;
    S.busy = true;
    el.mgRunBtn.disabled = true;
    try {
      CS.setBadge(el.mgStatus, "Building PDF…", "working");
      const PDFLib = await CS.ensurePdfLib();
      const out = await PDFLib.PDFDocument.create();

      // Copy each source's pages in one call so shared fonts/images are not duplicated.
      const copied = new Map(); // src.id -> Map(index -> PDFPage)
      for (const src of S.sources) {
        if (src.kind !== "pdf") continue;
        const indices = Array.from(new Set(S.pages.filter((p) => p.src === src).map((p) => p.index)));
        const doc = await CS.openPdfLib(src.bytes);
        const pages = await out.copyPages(doc, indices);
        const map = new Map();
        indices.forEach((idx, i) => map.set(idx, pages[i]));
        copied.set(src.id, map);
      }

      const images = new Map();
      for (let i = 0; i < S.pages.length; i++) {
        const p = S.pages[i];
        if (i % 10 === 0) {
          CS.setBadge(el.mgStatus, "Adding page " + (i + 1) + " of " + S.pages.length + "…", "working");
          await CS.nextFrame();
        }
        let page;
        if (p.src.kind === "pdf") {
          page = out.addPage(copied.get(p.src.id).get(p.index));
        } else {
          let embedded = images.get(p.src.id);
          if (!embedded) {
            embedded = await embedImage(out, p.src);
            images.set(p.src.id, embedded);
          }
          const landscape = embedded.width > embedded.height;
          const a4 = CS.PAGE_SIZES.a4;
          const pw = landscape ? a4[1] : a4[0];
          const ph = landscape ? a4[0] : a4[1];
          const s = Math.min(pw / embedded.width, ph / embedded.height);
          page = out.addPage([pw, ph]);
          page.drawImage(embedded, {
            x: (pw - embedded.width * s) / 2,
            y: (ph - embedded.height * s) / 2,
            width: embedded.width * s,
            height: embedded.height * s
          });
        }
        if (p.rotation) {
          const cur = page.getRotation().angle || 0;
          page.setRotation(PDFLib.degrees((((cur + p.rotation) % 360) + 360) % 360));
        }
      }

      const name = outputName();
      out.setTitle(CS.baseName(name));
      out.setCreator("CropShift");
      out.setProducer("CropShift (pdf-lib)");
      CS.setBadge(el.mgStatus, "Saving…", "working");
      const bytes = await out.save();
      const blob = CS.pdfBlob(bytes);
      CS.downloadBlob(blob, name);
      CS.setBadge(el.mgStatus, "Saved " + name + " — " + S.pages.length + " pages, " + CS.formatBytes(blob.size), "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.mgStatus, (err && err.message) || "Could not build the PDF.", "error");
    } finally {
      S.busy = false;
      el.mgRunBtn.disabled = !S.pages.length;
    }
  }

  async function embedImage(doc, src) {
    const isPng = /png$/i.test(src.type) || /\.png$/i.test(src.name);
    if (isPng) return doc.embedPng(src.bytes);
    // JPEG and others: re-encode through a canvas so EXIF orientation (phone
    // photos) is baked in; embedding raw JPEG bytes would ignore it.
    const img = await CS.loadImage(new Blob([src.bytes], { type: src.type }));
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    const blob = await CS.canvasToBlob(c, "image/jpeg", 0.92);
    return doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  }

  function outputName() {
    return CS.outputFileName(el.mgName.value, "merged", "pdf");
  }
})();
