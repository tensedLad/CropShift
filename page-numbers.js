// Page Numbers & Watermark: stamp page numbers, a footer line and/or a text
// watermark onto every page of a PDF (pdf-lib), with a live canvas preview.
// Positions are computed in the page's *displayed* orientation, so rotated
// pages get their numbers at the visual bottom, upright.

(function () {
  "use strict";

  const MAX_FILE_BYTES = 200 * 1024 * 1024;
  const EDGE = 26; // distance from the page edge in points

  const S = { file: null, bytes: null, pdf: null, count: 0, previewPage: 1, busy: false, renderToken: 0 };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "pnStatus",
      "pnInput",
      "pnDropzone",
      "pnWorkspace",
      "pnFileName",
      "pnFileInfo",
      "pnChangeBtn",
      "pnNumOn",
      "pnNumFields",
      "pnPosition",
      "pnFormat",
      "pnStart",
      "pnSize",
      "pnFrom",
      "pnText",
      "pnWmOn",
      "pnWmFields",
      "pnWmText",
      "pnWmColor",
      "pnWmOpacity",
      "pnWmOpacityVal",
      "pnWmSize",
      "pnWmSizeVal",
      "pnWmAngle",
      "pnPrevBtn",
      "pnNextBtn",
      "pnPageLabel",
      "pnPreview",
      "pnRunBtn"
    ].forEach((id) => (el[id] = document.getElementById(id)));

    CS.bindFileIntake({
      zone: el.pnDropzone,
      input: el.pnInput,
      accept: CS.isPdfFile,
      onFiles: (files) => openFile(files[0]),
      onReject: () => CS.setBadge(el.pnStatus, "Please choose a PDF file.", "error")
    });
    el.pnChangeBtn.addEventListener("click", () => el.pnInput.click());

    const inputs = [
      "pnNumOn",
      "pnPosition",
      "pnFormat",
      "pnStart",
      "pnSize",
      "pnFrom",
      "pnText",
      "pnWmOn",
      "pnWmText",
      "pnWmColor",
      "pnWmOpacity",
      "pnWmSize"
    ];
    inputs.forEach((id) => {
      el[id].addEventListener("input", onSettingsChange);
      el[id].addEventListener("change", onSettingsChange);
    });
    CS.bindSegGroup(el.pnWmAngle, onSettingsChange);
    el.pnPrevBtn.addEventListener("click", () => showPage(S.previewPage - 1));
    el.pnNextBtn.addEventListener("click", () => showPage(S.previewPage + 1));
    el.pnRunBtn.addEventListener("click", apply);
    syncFieldState();
  }

  function onSettingsChange() {
    syncFieldState();
    drawPreview();
  }

  function syncFieldState() {
    el.pnWmOpacityVal.textContent = el.pnWmOpacity.value + "%";
    el.pnWmSizeVal.textContent = el.pnWmSize.value;
    toggleFields(el.pnNumFields, el.pnNumOn.checked);
    toggleFields(el.pnWmFields, el.pnWmOn.checked);
    el.pnWmAngle.querySelectorAll("button").forEach((b) => (b.disabled = !el.pnWmOn.checked));
    el.pnRunBtn.disabled = !S.file || S.busy || !(el.pnNumOn.checked || (el.pnWmOn.checked && el.pnWmText.value.trim()));
  }

  function toggleFields(box, on) {
    box.style.opacity = on ? "1" : "0.45";
    box.querySelectorAll("input, select").forEach((i) => (i.disabled = !on));
  }

  async function openFile(file) {
    if (S.busy) return;
    if (file.size > MAX_FILE_BYTES) {
      CS.setBadge(el.pnStatus, "File is too large (max " + CS.formatBytes(MAX_FILE_BYTES) + ").", "error");
      return;
    }
    CS.setBadge(el.pnStatus, "Opening PDF…", "working");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await CS.openPdfLib(bytes);
      const pdf = await CS.openPdfJs(bytes);
      if (S.pdf) S.pdf.destroy();
      Object.assign(S, { file, bytes, pdf, count: pdf.numPages, previewPage: 1 });
      el.pnFileName.textContent = file.name;
      el.pnFileInfo.textContent = S.count + " page" + (S.count === 1 ? "" : "s") + " · " + CS.formatBytes(file.size);
      el.pnFrom.max = String(S.count);
      el.pnDropzone.classList.add("is-hidden");
      el.pnWorkspace.classList.remove("is-hidden");
      syncFieldState();
      await showPage(1);
      CS.setBadge(el.pnStatus, "Ready", "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.pnStatus, err.message || "Could not open this PDF.", "error");
    }
  }

  // ---------- Settings ----------
  function settings() {
    const start = parseInt(el.pnStart.value, 10);
    const size = parseFloat(el.pnSize.value);
    const from = parseInt(el.pnFrom.value, 10);
    return {
      numbers: el.pnNumOn.checked,
      position: el.pnPosition.value,
      format: el.pnFormat.value,
      start: isNaN(start) ? 1 : Math.max(0, start),
      size: isNaN(size) ? 11 : Math.min(48, Math.max(6, size)),
      from: isNaN(from) ? 1 : Math.min(Math.max(1, from), Math.max(1, S.count)),
      footer: el.pnText.value.trim(),
      watermark: el.pnWmOn.checked && !!el.pnWmText.value.trim(),
      wmText: el.pnWmText.value.trim(),
      wmColor: el.pnWmColor.value,
      wmOpacity: parseInt(el.pnWmOpacity.value, 10) / 100,
      wmSize: parseInt(el.pnWmSize.value, 10),
      wmAngle: parseInt(CS.getSegValue(el.pnWmAngle), 10) || 0
    };
  }

  function labelFor(pageNo, st) {
    if (pageNo < st.from) return null;
    const n = st.start + (pageNo - st.from);
    const total = st.start + (S.count - st.from);
    return st.format.replace("{n}", String(n)).replace("{total}", String(total));
  }

  // Layout in display space (origin bottom-left, y up). measure(text, size) -> width.
  function layout(pageNo, dispW, dispH, st, measure) {
    const items = [];
    if (st.numbers) {
      const label = labelFor(pageNo, st);
      const top = st.position[0] === "t";
      const align = st.position[1]; // l | c | r
      const y = top ? dispH - EDGE - st.size * 0.75 : EDGE;
      if (label) {
        const w = measure(label, st.size);
        const x = align === "l" ? EDGE : align === "r" ? dispW - EDGE - w : (dispW - w) / 2;
        items.push({ text: label, x, y, size: st.size, color: "#000000", opacity: 1, angle: 0 });
      }
      if (st.footer && pageNo >= st.from) {
        const w = measure(st.footer, st.size);
        const x = align === "l" ? dispW - EDGE - w : EDGE;
        items.push({ text: st.footer, x, y, size: st.size, color: "#000000", opacity: 1, angle: 0 });
      }
    }
    if (st.watermark) {
      const size = st.wmSize;
      const w = measure(st.wmText, size, true);
      const a = (st.wmAngle * Math.PI) / 180;
      // Baseline origin so the text's visual center lands on the page center.
      const ox = -w / 2;
      const oy = -size * 0.35;
      items.push({
        text: st.wmText,
        x: dispW / 2 + ox * Math.cos(a) - oy * Math.sin(a),
        y: dispH / 2 + ox * Math.sin(a) + oy * Math.cos(a),
        size,
        color: st.wmColor,
        opacity: st.wmOpacity,
        angle: st.wmAngle,
        bold: true
      });
    }
    return items;
  }

  // ---------- Preview ----------
  async function showPage(n) {
    if (!S.pdf) return;
    S.previewPage = Math.min(Math.max(1, n), S.count);
    el.pnPageLabel.textContent = "Page " + S.previewPage + " / " + S.count;
    el.pnPrevBtn.disabled = S.previewPage <= 1;
    el.pnNextBtn.disabled = S.previewPage >= S.count;
    const token = ++S.renderToken;
    const page = await S.pdf.getPage(S.previewPage);
    const vp = page.getViewport({ scale: 1 });
    const scale = Math.min(520 / vp.width, 520 / vp.height) * Math.min(2, window.devicePixelRatio || 1);
    const canvas = await CS.renderPdfPage(page, scale, 0);
    if (token !== S.renderToken) return;
    S.base = { canvas, scale, dispW: vp.width, dispH: vp.height };
    drawPreview();
  }

  function drawPreview() {
    if (!S.base) return;
    const { canvas, scale, dispW, dispH } = S.base;
    const out = el.pnPreview;
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(canvas, 0, 0);
    const st = settings();
    const measure = (text, size, isBold) => {
      ctx.font = (isBold ? "bold " : "") + size + "px Helvetica, Arial, sans-serif";
      return ctx.measureText(text).width;
    };
    layout(S.previewPage, dispW, dispH, st, measure).forEach((it) => {
      ctx.save();
      ctx.globalAlpha = it.opacity;
      ctx.fillStyle = it.color;
      ctx.font = (it.bold ? "bold " : "") + it.size * scale + "px Helvetica, Arial, sans-serif";
      ctx.translate(it.x * scale, (dispH - it.y) * scale);
      ctx.rotate((-it.angle * Math.PI) / 180);
      ctx.fillText(it.text, 0, 0);
      ctx.restore();
    });
  }

  // ---------- Export ----------
  // Map a display-space point (origin bottom-left) to PDF user space.
  function toUser(box, rot, dx, dy) {
    const { x, y, width: W, height: H } = box;
    switch (rot) {
      case 90:
        return { x: x + W - dy, y: y + dx };
      case 180:
        return { x: x + W - dx, y: y + H - dy };
      case 270:
        return { x: x + dy, y: y + H - dx };
      default:
        return { x: x + dx, y: y + dy };
    }
  }

  async function apply() {
    if (!S.file || S.busy) return;
    S.busy = true;
    syncFieldState();
    try {
      CS.setBadge(el.pnStatus, "Loading PDF writer…", "working");
      const PDFLib = await CS.ensurePdfLib();
      const doc = await CS.openPdfLib(S.bytes);
      const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      const st = settings();
      const pages = doc.getPages();

      for (let i = 0; i < pages.length; i++) {
        if (i % 10 === 0) {
          CS.setBadge(el.pnStatus, "Stamping page " + (i + 1) + " of " + pages.length + "…", "working");
          await CS.nextFrame();
        }
        const page = pages[i];
        const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
        const box = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, ...page.getSize() };
        const swap = rot === 90 || rot === 270;
        const dispW = swap ? box.height : box.width;
        const dispH = swap ? box.width : box.height;
        const measure = (text, size, isBold) => {
          const f = isBold ? bold : font;
          return CS.fontCanEncode(f, text) ? f.widthOfTextAtSize(text, size) : measureCanvas(text, size, isBold);
        };
        const items = layout(i + 1, dispW, dispH, st, measure);
        for (const it of items) {
          const p = toUser(box, rot, it.x, it.y);
          await CS.drawTextOrImage(doc, page, it.text, {
            x: p.x,
            y: p.y,
            size: it.size,
            color: it.color,
            opacity: it.opacity,
            rotate: (it.angle + rot) % 360,
            font: it.bold ? bold : font,
            bold: !!it.bold
          });
        }
      }

      doc.setModificationDate(new Date());
      CS.setBadge(el.pnStatus, "Saving…", "working");
      const bytes = await doc.save();
      const blob = CS.pdfBlob(bytes);
      const name = CS.baseName(S.file.name) + (st.numbers ? "-numbered" : "-watermarked") + ".pdf";
      CS.downloadBlob(blob, name);
      CS.setBadge(el.pnStatus, "Saved " + name + " (" + CS.formatBytes(blob.size) + ")", "done");
    } catch (err) {
      console.error(err);
      CS.setBadge(el.pnStatus, (err && err.message) || "Could not stamp this PDF.", "error");
    } finally {
      S.busy = false;
      syncFieldState();
    }
  }

  let measureCtx = null;
  function measureCanvas(text, size, isBold) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = (isBold ? "bold " : "") + size + "px Helvetica, Arial, sans-serif";
    return measureCtx.measureText(text).width;
  }
})();
