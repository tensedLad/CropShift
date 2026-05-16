const state = {
  image: null,
  imageBitmap: null,
  sourceCanvas: null,
  sourceCtx: null,
  previewCanvas: null,
  previewCtx: null,
  sourceData: null,
  fileName: "",
  corners: [],
  defaultCorners: [],
  view: { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 },
  activeCorner: -1,
  keyboardCorner: 0,
  pointerId: null,
  previewQueued: false,
  isRenderingFinal: false,
  cvReady: false,
  pendingAutoDetect: false,
  cornerMode: localStorage.getItem("cropshift_corner_mode") || "4",
  rotation: 0
};

function onOpenCvReady() {
  state.cvReady = true;
  if (state.pendingAutoDetect && state.image && state.sourceData) {
    const detected = autoDetectCorners();
    state.pendingAutoDetect = false;
    if (detected) {
      updateMeta();
      afterCornerChange();
      setStatus("Document edges auto-detected. Drag a corner handle to refine.");
    }
  }
}

function onOpenCvFailed() {
  state.cvReady = false;
  state.pendingAutoDetect = false;
  if (state.image) {
    setStatus("Auto-detection is unavailable. Drag a corner handle to shape the crop.");
  }
}

window.onOpenCvReady = onOpenCvReady;
window.onOpenCvFailed = onOpenCvFailed;

const els = {};
const HANDLE_RADIUS = 10;
const HANDLE_HIT_RADIUS = 22;
const PREVIEW_MAX_SIDE = 680;
const PREVIEW_MAX_PIXELS = 520000;
const MAX_SOURCE_PIXELS = 24000000;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  setDownloadQualityVisibility();
  resizeCanvases();
  drawSource();
  window.addEventListener("resize", () => {
    resizeCanvases();
    drawSource();
    queuePreviewRender();
  });
});

function bindElements() {
  state.sourceCanvas = document.getElementById("sourceCanvas");
  state.sourceCtx = state.sourceCanvas.getContext("2d");
  state.previewCanvas = document.getElementById("previewCanvas");
  state.previewCtx = state.previewCanvas.getContext("2d");

  [
    "fileInput",
    "uploadZone",
    "fileName",
    "imageSize",
    "selectionSize",
    "engineStatus",
    "statusMessage",
    "rotateButton",
    "cornerModeGroup",
    "resetButton",
    "fitButton",
    "clearButton",
    "emptyState",
    "previewEmpty",
    "previewInfo",
    "formatGroup",
    "qualityInput",
    "qualityLabel",
    "downloadButton"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  // Store selected format state
  state.selectedFormat = "image/jpeg";
  state.selectedExt = "jpg";

  if (els.cornerModeGroup) {
    els.cornerModeGroup.querySelectorAll(".mode-btn").forEach((b) => {
      if (b.dataset.mode === state.cornerMode) {
        b.classList.remove("bg-zinc-700", "text-zinc-400");
        b.classList.add("bg-[#1473e6]", "text-white");
        b.setAttribute("aria-pressed", "true");
      } else {
        b.classList.remove("bg-[#1473e6]", "text-white");
        b.classList.add("bg-zinc-700", "text-zinc-400");
        b.setAttribute("aria-pressed", "false");
      }
    });
  }
}

function bindEvents() {
  if (els.cornerModeGroup) {
    els.cornerModeGroup.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => setCornerMode(btn.dataset.mode));
    });
  }
  if (els.rotateButton) {
    els.rotateButton.addEventListener("click", rotateImageRight);
  }
  els.uploadZone.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) loadFile(file);
  });

  let dragCounter = 0;

  document.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragCounter++;
    els.uploadZone.classList.add("is-dragging");
  });

  document.addEventListener("dragover", (event) => {
    event.preventDefault();
  });

  document.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      els.uploadZone.classList.remove("is-dragging");
    }
  });

  document.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter = 0;
    els.uploadZone.classList.remove("is-dragging");
    const [file] = event.dataTransfer.files;
    if (file) loadFile(file);
  });

  document.addEventListener("paste", onPasteImage);

  state.sourceCanvas.addEventListener("pointerdown", onPointerDown);
  state.sourceCanvas.addEventListener("pointermove", onPointerMove);
  state.sourceCanvas.addEventListener("pointerup", endPointerDrag);
  state.sourceCanvas.addEventListener("pointercancel", endPointerDrag);
  state.sourceCanvas.addEventListener("keydown", onCanvasKeyDown);
  state.sourceCanvas.addEventListener("focus", () => {
    if (!state.imageBitmap || !isValidCornerSet(state.corners)) return;
    state.activeCorner = state.keyboardCorner;
    drawSource(state.keyboardCorner);
  });
  state.sourceCanvas.addEventListener("blur", () => {
    if (state.pointerId !== null) return;
    state.activeCorner = -1;
    drawSource();
  });
  state.sourceCanvas.addEventListener("pointerleave", () => {
    if (state.activeCorner === -1) drawSource();
  });

  els.resetButton.addEventListener("click", () => {
    state.pendingAutoDetect = false;
    state.keyboardCorner = 0;
    state.corners = cloneCorners(state.defaultCorners);
    setStatus("Corners reset to the document-safe inset.");
    afterCornerChange();
  });

  els.fitButton.addEventListener("click", () => {
    state.pendingAutoDetect = false;
    state.keyboardCorner = 0;
    state.corners = imageBoundsCorners();
    setStatus("Selection fitted to the full image.");
    afterCornerChange();
  });

  els.clearButton.addEventListener("click", clearImage);

  // Format toggle buttons
  els.formatGroup.querySelectorAll(".format-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectFormatButton(btn);
    });
  });

  els.qualityInput.addEventListener("change", () => {
    let val = parseInt(els.qualityInput.value, 10);
    if (isNaN(val)) val = 100;
    val = Math.max(65, Math.min(100, val));
    els.qualityInput.value = val;
  });

  els.downloadButton.addEventListener("click", downloadCrop);
}

function onPasteImage(event) {
  const file = getClipboardImageFile(event.clipboardData);
  if (!file) return;

  event.preventDefault();
  els.uploadZone.classList.remove("is-dragging");
  loadFile(file);
}

function getClipboardImageFile(clipboardData) {
  if (!clipboardData) return null;

  const file = Array.from(clipboardData.files).find((item) => item.type.startsWith("image/"));
  if (file) return file.name ? file : nameClipboardBlob(file);

  const item = Array.from(clipboardData.items).find((entry) => entry.kind === "file" && entry.type.startsWith("image/"));
  if (!item) return null;

  const blob = item.getAsFile();
  return blob ? nameClipboardBlob(blob) : null;
}

function nameClipboardBlob(blob) {
  const extension = clipboardExtension(blob.type);
  const name = `pasted-image-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  return new File([blob], name, { type: blob.type || "image/png", lastModified: Date.now() });
}

function clipboardExtension(type) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp"
  };
  return map[type] || "png";
}

async function loadFile(file) {
  if (!file.type.startsWith("image/")) {
    setError("Choose an image file.");
    return;
  }

  clearObjectUrl();
  setBusy("Loading image...");

  try {
    const url = URL.createObjectURL(file);
    state.image = new Image();
    state.image.decoding = "async";
    
    await new Promise((resolve, reject) => {
      state.image.onload = resolve;
      state.image.onerror = () => reject(new Error("Image load error"));
      state.image.src = url;
    });
    
    const pixelCount = state.image.naturalWidth * state.image.naturalHeight;
    if (pixelCount === 0) {
      clearImage();
      setError("Image has invalid dimensions and cannot be processed.");
      return;
    }
    if (pixelCount > MAX_SOURCE_PIXELS) {
      clearImage();
      setError(`Image is too large. Use an image under ${formatMegaPixels(MAX_SOURCE_PIXELS)} megapixels.`);
      return;
    }
    
    state.fileName = file.name;
    state.rotation = 0;
    await buildSourceImageData();
    initializeCorners();
    const detected = autoDetectCorners();
    resizeCanvases();
    updateMeta();
    setControlsEnabled(true);
    els.emptyState.classList.add("is-hidden");
    els.previewEmpty.classList.add("is-hidden");
    autoSelectFormat(file.name);
    if (detected) {
      setStatus("Document edges auto-detected. Drag a corner handle to refine.");
    } else if (!state.cvReady) {
      state.pendingAutoDetect = true;
      setStatus("Auto-detection is loading. Drag a corner handle to shape the crop.");
    } else {
      setStatus("Drag a corner handle to shape the crop.");
    }
    afterCornerChange();
  } catch (error) {
    console.error(error);
    clearImage();
    setError("This image could not be loaded by the browser.");
  }
}

async function buildSourceImageData() {
  const isRotated = state.rotation === 90 || state.rotation === 270;
  const width = isRotated ? state.image.naturalHeight : state.image.naturalWidth;
  const height = isRotated ? state.image.naturalWidth : state.image.naturalHeight;
  
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.drawImage(state.image, -state.image.naturalWidth / 2, -state.image.naturalHeight / 2);
  ctx.restore();
  
  state.sourceData = ctx.getImageData(0, 0, width, height);

  try {
    state.imageBitmap = await createImageBitmap(canvas);
  } catch (e) {
    state.imageBitmap = canvas;
  }
}

function initializeCorners() {
  const width = state.imageBitmap.width;
  const height = state.imageBitmap.height;
  const inset = Math.max(8, Math.round(Math.min(width, height) * 0.04));
  if (state.cornerMode === "8") {
    state.defaultCorners = [
      { x: inset, y: inset },
      { x: width / 2, y: inset },
      { x: width - inset, y: inset },
      { x: width - inset, y: height / 2 },
      { x: width - inset, y: height - inset },
      { x: width / 2, y: height - inset },
      { x: inset, y: height - inset },
      { x: inset, y: height / 2 }
    ];
  } else {
    state.defaultCorners = [
      { x: inset, y: inset },
      { x: width - inset, y: inset },
      { x: width - inset, y: height - inset },
      { x: inset, y: height - inset }
    ];
  }
  state.corners = cloneCorners(state.defaultCorners);
}

function resizeCanvases() {
  const sourceFrame = state.sourceCanvas.parentElement.getBoundingClientRect();
  const sourceWidth = Math.max(280, Math.floor(sourceFrame.width - 36));
  const sourceHeight = Math.max(280, Math.floor(sourceFrame.height - 36));
  setCanvasDisplaySize(state.sourceCanvas, sourceWidth, sourceHeight);

  const previewFrame = state.previewCanvas.parentElement.getBoundingClientRect();
  const previewWidth = Math.max(240, Math.floor(previewFrame.width - 36));
  const previewHeight = Math.max(220, Math.floor(previewFrame.height - 36));
  setCanvasDisplaySize(state.previewCanvas, previewWidth, previewHeight);
}

function setCanvasDisplaySize(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
}

function drawSource(hoverCorner = -1) {
  const canvas = state.sourceCanvas;
  const ctx = state.sourceCtx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state.imageBitmap) {
    ctx.restore();
    return;
  }

  const fit = getImageFit(canvas.width, canvas.height, state.imageBitmap.width, state.imageBitmap.height);
  state.view = fit;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(state.imageBitmap, fit.offsetX, fit.offsetY, fit.width, fit.height);
  drawCropOverlay(ctx, hoverCorner);
  
  if (state.activeCorner !== -1) {
    drawLens(ctx, state.activeCorner);
  }

  ctx.restore();
}

function drawLens(ctx, cornerIndex) {
  if (cornerIndex === -1 || !state.imageBitmap) return;

  const point = imageToCanvas(state.corners[cornerIndex]);
  const lensRadius = 65 * pixelRatio();
  const zoom = 2; // 2x zoom
  
  // Decide where to put the lens (top left or top right)
  let lensX = 30 * pixelRatio() + lensRadius;
  let lensY = 30 * pixelRatio() + lensRadius;
  if (point.x < state.sourceCanvas.width / 2 && point.y < state.sourceCanvas.height / 2 + lensRadius) {
    lensX = state.sourceCanvas.width - 30 * pixelRatio() - lensRadius;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(lensX, lensY, lensRadius, 0, Math.PI * 2);
  ctx.clip();

  // Draw background for lens
  ctx.fillStyle = "#1a1a1a";
  ctx.fill();

  const imgPointX = state.corners[cornerIndex].x;
  const imgPointY = state.corners[cornerIndex].y;
  
  ctx.translate(lensX, lensY);
  ctx.scale(state.view.scale * zoom, state.view.scale * zoom);
  ctx.translate(-imgPointX, -imgPointY);
  
  ctx.drawImage(state.imageBitmap, 0, 0);

  ctx.restore();

  // Draw lens border and crosshair
  ctx.save();
  ctx.beginPath();
  ctx.arc(lensX, lensY, lensRadius, 0, Math.PI * 2);
  ctx.lineWidth = 4 * pixelRatio();
  ctx.strokeStyle = "#1473e6";
  ctx.stroke();
  ctx.lineWidth = 2 * pixelRatio();
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  
  // Draw crosshair
  ctx.beginPath();
  ctx.moveTo(lensX - 12 * pixelRatio(), lensY);
  ctx.lineTo(lensX + 12 * pixelRatio(), lensY);
  ctx.moveTo(lensX, lensY - 12 * pixelRatio());
  ctx.lineTo(lensX, lensY + 12 * pixelRatio());
  ctx.lineWidth = 1.5 * pixelRatio();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();

  ctx.restore();
}

function drawCropOverlay(ctx, hoverCorner) {
  if (!isValidCornerSet(state.corners)) return;

  const points = state.corners.map(imageToCanvas);
  ctx.save();
  ctx.lineWidth = 2 * pixelRatio();
  ctx.strokeStyle = "#3b82f6";
  ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  points.forEach((point, index) => {
    const active = index === state.activeCorner || index === hoverCorner;
    const isMidpoint = state.corners.length === 8 && index % 2 !== 0;
    const baseRadius = isMidpoint ? HANDLE_RADIUS - 3 : HANDLE_RADIUS;
    const radius = (active ? baseRadius + 3 : baseRadius) * pixelRatio();
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#60a5fa" : "#3b82f6";
    ctx.fill();
    ctx.lineWidth = 2 * pixelRatio();
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  });
  ctx.restore();
}

function onPointerDown(event) {
  if (!state.imageBitmap) return;
  const point = eventToCanvasPoint(event);
  const cornerIndex = findCornerAtPoint(point);
  if (cornerIndex === -1) return;

  state.pendingAutoDetect = false;
  state.keyboardCorner = cornerIndex;
  state.activeCorner = cornerIndex;
  state.pointerId = event.pointerId;
  state.sourceCanvas.focus({ preventScroll: true });
  state.sourceCanvas.setPointerCapture(event.pointerId);
  drawSource(cornerIndex);
}

function onPointerMove(event) {
  if (!state.imageBitmap) return;

  const point = eventToCanvasPoint(event);
  if (state.activeCorner === -1) {
    drawSource(findCornerAtPoint(point));
    return;
  }

  const imagePoint = canvasToImage(point);
  const maxX = state.imageBitmap.width - 1;
  const maxY = state.imageBitmap.height - 1;
  state.corners[state.activeCorner] = {
    x: clamp(imagePoint.x, 0, maxX),
    y: clamp(imagePoint.y, 0, maxY)
  };
  state.keyboardCorner = state.activeCorner;
  afterCornerChange();
}

function endPointerDrag(event) {
  if (state.pointerId !== null && event.pointerId === state.pointerId) {
    state.sourceCanvas.releasePointerCapture(event.pointerId);
  }
  state.activeCorner = -1;
  state.pointerId = null;
  drawSource();
}

function onCanvasKeyDown(event) {
  if (!state.imageBitmap || !isValidCornerSet(state.corners)) return;

  const key = event.key;
  if (key === "[" || key === "]") {
    event.preventDefault();
    const direction = key === "]" ? 1 : -1;
    state.keyboardCorner = (state.keyboardCorner + direction + state.corners.length) % state.corners.length;
    state.activeCorner = state.keyboardCorner;
    drawSource(state.keyboardCorner);
    return;
  }

  const movement = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }
  }[key];

  if (!movement) {
    if (key === "Escape") {
      state.activeCorner = -1;
      drawSource();
    }
    return;
  }

  event.preventDefault();
  state.pendingAutoDetect = false;
  const step = event.shiftKey ? 10 : 1;
  const corner = state.corners[state.keyboardCorner];
  state.corners[state.keyboardCorner] = {
    x: clamp(corner.x + movement.x * step, 0, state.imageBitmap.width - 1),
    y: clamp(corner.y + movement.y * step, 0, state.imageBitmap.height - 1)
  };
  state.activeCorner = state.keyboardCorner;
  afterCornerChange();
}

function afterCornerChange() {
  updateSelectionMeta();
  drawSource();
  queuePreviewRender();
  els.downloadButton.disabled = !isValidCornerSet(state.corners);
}

function queuePreviewRender() {
  if (state.previewQueued || !state.imageBitmap || !state.sourceData) return;
  state.previewQueued = true;
  requestAnimationFrame(() => {
    state.previewQueued = false;
    renderPreview();
  });
}

function renderPreview() {
  if (!isValidCornerSet(state.corners)) {
    clearPreview("Invalid selection");
    return;
  }

  try {
    const dims = getOutputDimensions(state.corners);
    if (!dims) {
      clearPreview("Invalid selection");
      return;
    }
    const scale = getPreviewScale(dims.width, dims.height);
    const width = Math.max(1, Math.round(dims.width * scale));
    const height = Math.max(1, Math.round(dims.height * scale));
    const data = warpPerspective(width, height, scale);
    paintPreview(data, width, height);
    els.previewInfo.textContent = `${Math.round(dims.width)} x ${Math.round(dims.height)} px export`;
  } catch (error) {
    console.error(error);
    clearPreview("Preview failed");
    setError("Preview could not be rendered. Try a smaller image or tighter crop.");
  }
}

function paintPreview(imageData, width, height) {
  const canvas = state.previewCanvas;
  const ctx = state.previewCtx;
  const fit = getImageFit(canvas.width, canvas.height, width, height);
  const temp = document.createElement("canvas");
  temp.width = width;
  temp.height = height;
  temp.getContext("2d").putImageData(imageData, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(temp, fit.offsetX, fit.offsetY, fit.width, fit.height);
  ctx.restore();
  els.previewEmpty.classList.add("is-hidden");
}

async function downloadCrop() {
  if (!state.imageBitmap || !isValidCornerSet(state.corners) || state.isRenderingFinal) return;

  state.isRenderingFinal = true;
  els.downloadButton.disabled = true;
  setBusy("Rendering full-resolution crop...");

  try {
    const dims = getOutputDimensions(state.corners);
    const width = Math.max(1, Math.round(dims.width));
    const height = Math.max(1, Math.round(dims.height));
    const imageData = warpPerspective(width, height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);

    const mime = state.selectedFormat;
    const quality = Math.max(0.65, Math.min(1, parseInt(els.qualityInput.value, 10) / 100));
    const blob = await canvasToBlob(canvas, mime, quality);
    const extension = state.selectedExt;
    const baseName = state.fileName ? state.fileName.replace(/\.[^/.]+$/, "") : "output";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${baseName}-cropped.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus("Download ready.");
  } catch (error) {
    console.error(error);
    setError("Full-resolution export failed. Try a smaller image or crop area.");
  } finally {
    state.isRenderingFinal = false;
    els.downloadButton.disabled = !isValidCornerSet(state.corners);
  }
}

function warpPerspective(width, height, outputScale) {
  const src = state.sourceData;
  const sourceCorners = state.corners.map((point) => ({
    x: point.x * outputScale,
    y: point.y * outputScale
  }));
  const output = new ImageData(width, height);
  const out = output.data;
  const srcData = src.data;
  const srcWidth = src.width;
  const srcHeight = src.height;

  if (state.cornerMode === "8" && sourceCorners.length === 8) {
    const p = sourceCorners;
    const GRID_SIZE = 20;
    const gridX = new Float32Array((GRID_SIZE + 1) * (GRID_SIZE + 1));
    const gridY = new Float32Array((GRID_SIZE + 1) * (GRID_SIZE + 1));

    for (let j = 0; j <= GRID_SIZE; j++) {
      const s = (j / GRID_SIZE) * 2 - 1;
      for (let i = 0; i <= GRID_SIZE; i++) {
        const r = (i / GRID_SIZE) * 2 - 1;
        
        const n1 = 0.25 * (1 - r) * (1 - s) * (-r - s - 1);
        const n2 = 0.25 * (1 + r) * (1 - s) * ( r - s - 1);
        const n3 = 0.25 * (1 + r) * (1 + s) * ( r + s - 1);
        const n4 = 0.25 * (1 - r) * (1 + s) * (-r + s - 1);
        const n5 = 0.5 * (1 - r * r) * (1 - s);
        const n6 = 0.5 * (1 + r) * (1 - s * s);
        const n7 = 0.5 * (1 - r * r) * (1 + s);
        const n8 = 0.5 * (1 - r) * (1 - s * s);

        const gx = n1*p[0].x + n5*p[1].x + n2*p[2].x + n6*p[3].x + n3*p[4].x + n7*p[5].x + n4*p[6].x + n8*p[7].x;
        const gy = n1*p[0].y + n5*p[1].y + n2*p[2].y + n6*p[3].y + n3*p[4].y + n7*p[5].y + n4*p[6].y + n8*p[7].y;
        
        const idx = j * (GRID_SIZE + 1) + i;
        gridX[idx] = gx;
        gridY[idx] = gy;
      }
    }

    const hMinus1 = Math.max(1, height - 1);
    const wMinus1 = Math.max(1, width - 1);

    for (let y = 0; y < height; y += 1) {
      const vj = (y / hMinus1) * GRID_SIZE;
      let j = Math.floor(vj);
      if (j >= GRID_SIZE) j = GRID_SIZE - 1;
      const dyPatch = vj - j;

      for (let x = 0; x < width; x += 1) {
        const vi = (x / wMinus1) * GRID_SIZE;
        let i = Math.floor(vi);
        if (i >= GRID_SIZE) i = GRID_SIZE - 1;
        const dxPatch = vi - i;

        const idx00 = j * (GRID_SIZE + 1) + i;
        const idx10 = idx00 + 1;
        const idx01 = (j + 1) * (GRID_SIZE + 1) + i;
        const idx11 = idx01 + 1;

        const gx0 = gridX[idx00] * (1 - dxPatch) + gridX[idx10] * dxPatch;
        const gx1 = gridX[idx01] * (1 - dxPatch) + gridX[idx11] * dxPatch;
        const sx = gx0 * (1 - dyPatch) + gx1 * dyPatch;

        const gy0 = gridY[idx00] * (1 - dxPatch) + gridY[idx10] * dxPatch;
        const gy1 = gridY[idx01] * (1 - dxPatch) + gridY[idx11] * dxPatch;
        const sy = gy0 * (1 - dyPatch) + gy1 * dyPatch;

        const targetIndex = (y * width + x) * 4;
        sampleBilinear(srcData, srcWidth, srcHeight, sx / outputScale, sy / outputScale, out, targetIndex);
      }
    }

  } else {
    const mainCorners = sourceCorners.length === 8 ? [sourceCorners[0], sourceCorners[2], sourceCorners[4], sourceCorners[6]] : sourceCorners;
    const scaledDest = [
      { x: 0, y: 0 },
      { x: width - 1, y: 0 },
      { x: width - 1, y: height - 1 },
      { x: 0, y: height - 1 }
    ];
    const homography = solveHomography(scaledDest, mainCorners);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = applyHomography(homography, x, y);
        const sx = source.x / outputScale;
        const sy = source.y / outputScale;
        const targetIndex = (y * width + x) * 4;
        sampleBilinear(srcData, srcWidth, srcHeight, sx, sy, out, targetIndex);
      }
    }
  }

  return output;
}

function solveHomography(from, to) {
  const matrix = [];
  for (let i = 0; i < 4; i += 1) {
    const x = from[i].x;
    const y = from[i].y;
    const u = to[i].x;
    const v = to[i].y;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const solution = gaussianElimination(matrix);
  return [
    solution[0],
    solution[1],
    solution[2],
    solution[3],
    solution[4],
    solution[5],
    solution[6],
    solution[7],
    1
  ];
}

function gaussianElimination(matrix) {
  const size = 8;
  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-10) {
      throw new Error("Invalid perspective selection");
    }
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];

    const divisor = matrix[col][col];
    for (let k = col; k <= size; k += 1) matrix[col][k] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let k = col; k <= size; k += 1) {
        matrix[row][k] -= factor * matrix[col][k];
      }
    }
  }
  return matrix.map((row) => row[size]);
}

function applyHomography(h, x, y) {
  const denominator = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denominator,
    y: (h[3] * x + h[4] * y + h[5]) / denominator
  };
}

function sampleBilinear(src, width, height, x, y, out, outIndex) {
  const sx = clamp(x, 0, width - 1);
  const sy = clamp(y, 0, height - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = sx - x0;
  const dy = sy - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  for (let channel = 0; channel < 4; channel += 1) {
    const top = src[i00 + channel] * (1 - dx) + src[i10 + channel] * dx;
    const bottom = src[i01 + channel] * (1 - dx) + src[i11 + channel] * dx;
    out[outIndex + channel] = top * (1 - dy) + bottom * dy;
  }
}

function getOutputDimensions(corners) {
  if (!isValidCornerSet(corners)) return null;
  const mainCorners = corners.length === 8 ? [corners[0], corners[2], corners[4], corners[6]] : corners;
  const top = distance(mainCorners[0], mainCorners[1]);
  const right = distance(mainCorners[1], mainCorners[2]);
  const bottom = distance(mainCorners[2], mainCorners[3]);
  const left = distance(mainCorners[3], mainCorners[0]);
  const width = Math.max(1, Math.round((top + bottom) / 2));
  const height = Math.max(1, Math.round((left + right) / 2));
  return { width, height };
}

function getPreviewScale(width, height) {
  const sideScale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(PREVIEW_MAX_PIXELS / Math.max(1, width * height)));
  return Math.min(sideScale, pixelScale);
}

function getImageFit(canvasWidth, canvasHeight, imageWidth, imageHeight) {
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    scale,
    width,
    height,
    offsetX: (canvasWidth - width) / 2,
    offsetY: (canvasHeight - height) / 2
  };
}

function eventToCanvasPoint(event) {
  const rect = state.sourceCanvas.getBoundingClientRect();
  const ratio = pixelRatio();
  return {
    x: (event.clientX - rect.left) * ratio,
    y: (event.clientY - rect.top) * ratio
  };
}

function findCornerAtPoint(point) {
  let nearest = -1;
  let bestDistance = Infinity;
  state.corners.forEach((corner, index) => {
    const canvasPoint = imageToCanvas(corner);
    const dist = distance(point, canvasPoint);
    if (dist < HANDLE_HIT_RADIUS * pixelRatio() && dist < bestDistance) {
      nearest = index;
      bestDistance = dist;
    }
  });
  return nearest;
}

function imageToCanvas(point) {
  return {
    x: state.view.offsetX + point.x * state.view.scale,
    y: state.view.offsetY + point.y * state.view.scale
  };
}

function canvasToImage(point) {
  return {
    x: (point.x - state.view.offsetX) / state.view.scale,
    y: (point.y - state.view.offsetY) / state.view.scale
  };
}

function imageBoundsCorners() {
  const w = state.imageBitmap.width - 1;
  const h = state.imageBitmap.height - 1;
  if (state.cornerMode === "8") {
    return [
      { x: 0, y: 0 },
      { x: w/2, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h/2 },
      { x: w, y: h },
      { x: w/2, y: h },
      { x: 0, y: h },
      { x: 0, y: h/2 }
    ];
  } else {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h }
    ];
  }
}

function isValidCornerSet(corners) {
  if (!corners || (corners.length !== 4 && corners.length !== 8)) return false;
  if (!corners.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const mainCorners = corners.length === 8 ? [corners[0], corners[2], corners[4], corners[6]] : corners;
  const minimumEdge = mainCorners.every((point, index) => {
    const next = mainCorners[(index + 1) % mainCorners.length];
    return distance(point, next) > 8;
  });
  if (!minimumEdge) return false;
  if (segmentsIntersect(mainCorners[0], mainCorners[1], mainCorners[2], mainCorners[3])) return false;
  if (segmentsIntersect(mainCorners[1], mainCorners[2], mainCorners[3], mainCorners[0])) return false;
  if (!isConvexQuadrilateral(mainCorners)) return false;
  const area = Math.abs(polygonArea(mainCorners));
  return area > 64;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return area / 2;
}

function isConvexQuadrilateral(points) {
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = crossProduct(a, b, c);
    if (Math.abs(cross) < 1e-6) return false;
    const currentSign = Math.sign(cross);
    if (sign === 0) sign = currentSign;
    if (currentSign !== sign) return false;
  }
  return true;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = crossProduct(a, b, c);
  const o2 = crossProduct(a, b, d);
  const o3 = crossProduct(c, d, a);
  const o4 = crossProduct(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function crossProduct(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function clearPreview(message) {
  const ctx = state.previewCtx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, state.previewCanvas.width, state.previewCanvas.height);
  ctx.restore();
  els.previewEmpty.textContent = message;
  els.previewEmpty.classList.remove("is-hidden");
  els.previewInfo.textContent = "Corrected output appears here.";
}

function clearImage() {
  clearObjectUrl();
  state.image = null;
  state.imageBitmap = null;
  state.sourceData = null;
  state.fileName = "";
  state.corners = [];
  state.defaultCorners = [];
  state.activeCorner = -1;
  state.keyboardCorner = 0;
  state.pendingAutoDetect = false;
  els.fileInput.value = "";
  updateMeta();
  setControlsEnabled(false);
  els.emptyState.classList.remove("is-hidden");
  clearPreview("Waiting for image");
  setStatus("Load an image to start shaping the crop.");
  drawSource();
}

function clearObjectUrl() {
  if (state.image && state.image.src && state.image.src.startsWith("blob:")) {
    URL.revokeObjectURL(state.image.src);
  }
}

function updateMeta() {
  els.fileName.textContent = state.fileName || "None loaded";
  if (state.image) {
    els.imageSize.textContent = `${state.image.naturalWidth} x ${state.image.naturalHeight} px`;
  } else {
    els.imageSize.textContent = "-";
  }
  updateSelectionMeta();
}

function updateSelectionMeta() {
  const dims = getOutputDimensions(state.corners);
  els.selectionSize.textContent = dims ? `${dims.width} x ${dims.height} px` : "-";
}

function setControlsEnabled(enabled) {
  els.resetButton.disabled = !enabled;
  if (els.rotateButton) els.rotateButton.disabled = !enabled;
  els.fitButton.disabled = !enabled;
  els.clearButton.disabled = !enabled;
  els.downloadButton.disabled = !enabled || !isValidCornerSet(state.corners);
}

function setDownloadQualityVisibility() {
  const supportsQuality = state.selectedFormat === "image/jpeg" || state.selectedFormat === "image/webp";
  els.qualityInput.disabled = !supportsQuality;
  els.qualityLabel.style.opacity = supportsQuality ? "1" : "0.45";
  els.qualityInput.style.opacity = supportsQuality ? "1" : "0.45";
}

function selectFormatButton(btn) {
  // Deselect all
  els.formatGroup.querySelectorAll(".format-btn").forEach((b) => {
    b.setAttribute("aria-pressed", "false");
  });
  // Select clicked
  btn.setAttribute("aria-pressed", "true");
  state.selectedFormat = btn.dataset.format;
  state.selectedExt = btn.dataset.ext;
  setDownloadQualityVisibility();
}

function autoSelectFormat(fileName) {
  const ext = fileName.split(".").pop().toLowerCase();
  const map = { jpg: "jpg", jpeg: "jpeg", png: "png", webp: "webp" };
  const targetExt = map[ext] || "jpg";
  const btn = els.formatGroup.querySelector(`[data-ext="${targetExt}"]`);
  if (btn) selectFormatButton(btn);
}

function setBusy(message) {
  els.engineStatus.textContent = "Working";
  els.engineStatus.style.background = "#30270e";
  els.engineStatus.style.color = "#fbbf24";
  els.statusMessage.textContent = message;
}

function setStatus(message) {
  els.engineStatus.textContent = "Ready";
  els.engineStatus.style.background = "#16351f";
  els.engineStatus.style.color = "#34d399";
  els.statusMessage.textContent = message;
}

function setError(message) {
  els.engineStatus.textContent = "Issue";
  els.engineStatus.style.background = "#351818";
  els.engineStatus.style.color = "#f87171";
  els.statusMessage.textContent = message;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Export failed"));
      },
      mime,
      quality
    );
  });
}

function cloneCorners(corners) {
  return corners.map((point) => ({ x: point.x, y: point.y }));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pixelRatio() {
  return window.devicePixelRatio || 1;
}

function formatMegaPixels(pixelCount) {
  return Math.round(pixelCount / 1000000);
}

// ---- OpenCV Auto-Detection ----
function autoDetectCorners() {
  if (!state.cvReady || !state.image) return false;

  // Track every allocated Mat for guaranteed cleanup
  const cleanup = [];
  const track = (m) => { cleanup.push(m); return m; };
  let bestQuad = null;

  try {
    const maxDim = 1000;
    let srcW = state.imageBitmap.width;
    let srcH = state.imageBitmap.height;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);

    const tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    tmp.getContext("2d").drawImage(state.imageBitmap, 0, 0, w, h);

    const src   = track(cv.imread(tmp));
    const gray  = track(new cv.Mat());
    const blur  = track(new cv.Mat());
    const edges = track(new cv.Mat());
    const cnts  = track(new cv.MatVector());
    const hier  = track(new cv.Mat());

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

    // 75/200: reduces false edges from textured backgrounds (leather, fabric, etc.)
    cv.Canny(blur, edges, 75, 200);

    // Dilate then morphological close to bridge gaps in document edges
    const k3 = track(cv.Mat.ones(3, 3, cv.CV_8U));
    const k5 = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
    cv.dilate(edges, edges, k3);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k5);

    cv.findContours(edges, cnts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imgArea = w * h;
    let bestScore = -1;

    // Try multiple epsilon values so a single bad approx won't miss the document
    const EPS = [0.01, 0.015, 0.02, 0.03, 0.04, 0.05];

    for (let i = 0; i < cnts.size(); i++) {
      const cnt  = cnts.get(i);
      const area = cv.contourArea(cnt);

      if (area < imgArea * 0.04) { cnt.delete(); continue; }

      const peri = cv.arcLength(cnt, true);
      cnt.delete();

      for (const eps of EPS) {
        const c2     = cnts.get(i);
        const approx = new cv.Mat();
        cv.approxPolyDP(c2, approx, eps * peri, true);
        c2.delete();

        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const qArea = cv.contourArea(approx);
          const rect  = cv.boundingRect(approx);
          const rArea = rect.width * rect.height;

          if (qArea >= imgArea * 0.04 && rArea > 0) {
            // Score = area-coverage * rectangularity^2
            // High rectangularity means the quad closely fills its bounding box
            const rectRatio = qArea / rArea;
            const score = (qArea / imgArea) * rectRatio * rectRatio;

            if (score > bestScore) {
              if (bestQuad) bestQuad.delete();
              bestScore = score;
              bestQuad  = approx;
            } else {
              approx.delete();
            }
          } else {
            approx.delete();
          }
          break; // found best 4-point for this contour, move on
        } else {
          approx.delete();
        }
      }
    }

    if (bestQuad) {
      const pts = [];
      for (let i = 0; i < 4; i++) {
        pts.push({ x: bestQuad.intAt(i, 0) / scale, y: bestQuad.intAt(i, 1) / scale });
      }
      bestQuad.delete();
      bestQuad = null;

      const pad  = 2;
      const maxX = srcW - pad;
      const maxY = srcH - pad;
      let c = orderQuadPoints(pts).map(p => ({
        x: Math.max(pad, Math.min(maxX, p.x)),
        y: Math.max(pad, Math.min(maxY, p.y))
      }));
      if (state.cornerMode === "8") {
        c = [
          c[0],
          { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 },
          c[1],
          { x: (c[1].x + c[2].x) / 2, y: (c[1].y + c[2].y) / 2 },
          c[2],
          { x: (c[2].x + c[3].x) / 2, y: (c[2].y + c[3].y) / 2 },
          c[3],
          { x: (c[3].x + c[0].x) / 2, y: (c[3].y + c[0].y) / 2 }
        ];
      }
      state.corners = c;
      return true;
    }

    return false;
  } catch (e) {
    console.warn("Auto-detection failed, using default corners:", e);
    return false;
  } finally {
    if (bestQuad) { try { bestQuad.delete(); } catch (_) {} }
    cleanup.forEach(m => { try { m.delete(); } catch (_) {} });
  }
}


function orderQuadPoints(pts) {
  // Sort by Y first (top vs bottom)
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [
    { x: top[0].x, y: top[0].y },       // top-left
    { x: top[1].x, y: top[1].y },       // top-right
    { x: bottom[1].x, y: bottom[1].y }, // bottom-right
    { x: bottom[0].x, y: bottom[0].y }  // bottom-left
  ];
}

function setCornerMode(mode) {
  if (state.cornerMode === mode) return;
  state.cornerMode = mode;
  localStorage.setItem("cropshift_corner_mode", mode);

  if (els.cornerModeGroup) {
    els.cornerModeGroup.querySelectorAll(".mode-btn").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false");
    });
  }

  if (state.corners && state.corners.length > 0) {
    if (mode === "8" && state.corners.length === 4) {
      const c = state.corners;
      state.corners = [
        c[0],
        { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 },
        c[1],
        { x: (c[1].x + c[2].x) / 2, y: (c[1].y + c[2].y) / 2 },
        c[2],
        { x: (c[2].x + c[3].x) / 2, y: (c[2].y + c[3].y) / 2 },
        c[3],
        { x: (c[3].x + c[0].x) / 2, y: (c[3].y + c[0].y) / 2 }
      ];
    } else if (mode === "4" && state.corners.length === 8) {
      const c = state.corners;
      state.corners = [c[0], c[2], c[4], c[6]];
    }
    if (state.keyboardCorner >= state.corners.length) state.keyboardCorner = 0;
    state.activeCorner = -1;
    afterCornerChange();
  }
}

async function rotateImageRight() {
  if (!state.image) return;
  state.rotation = (state.rotation + 90) % 360;
  
  const w = state.imageBitmap.width;
  const h = state.imageBitmap.height;
  const cx = w / 2;
  const cy = h / 2;

  state.corners = state.corners.map(p => {
    const x = p.x - cx;
    const y = p.y - cy;
    return {
      x: -y + cy,
      y: x + cx
    };
  });

  state.defaultCorners = state.defaultCorners.map(p => {
    const x = p.x - cx;
    const y = p.y - cy;
    return { x: -y + cy, y: x + cx };
  });

  setBusy("Rotating image...");
  await buildSourceImageData();
  resizeCanvases();
  updateMeta();
  setStatus("Image rotated.");
  afterCornerChange();
}
