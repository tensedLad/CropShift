// Unlock File tool: removes the password from PDF and ZIP files you can already
// open with the correct password. Everything runs client-side:
//   - PDF: qpdf compiled to WebAssembly (preserves text, links, structure)
//   - ZIP: zip.js (re-writes a clean, unencrypted archive)
// The password is held only in browser memory and never uploaded anywhere.

(function () {
  "use strict";

  const QPDF_JS = "https://unpkg.com/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js";
  const QPDF_WASM = "https://unpkg.com/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm";
  const ZIPJS = "https://unpkg.com/@zip.js/zip.js@2/dist/zip.min.js";

  const MAX_FILE_BYTES = 100 * 1024 * 1024;

  const U = { file: null, kind: null, resultBlob: null, resultName: null };
  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "unlockStatus",
      "unlockFileInput",
      "unlockDropzone",
      "unlockWorkspace",
      "unlockFileIcon",
      "unlockFileName",
      "unlockFileInfo",
      "unlockChangeBtn",
      "unlockPassword",
      "unlockToggle",
      "unlockRunBtn",
      "unlockResult",
      "unlockNewSize",
      "unlockDownloadBtn"
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });

    if (!el.unlockDropzone) return;

    el.unlockDropzone.addEventListener("click", () => el.unlockFileInput.click());
    el.unlockChangeBtn.addEventListener("click", () => el.unlockFileInput.click());
    el.unlockFileInput.addEventListener("change", (e) => {
      const [file] = e.target.files;
      if (file) handleFile(file);
      el.unlockFileInput.value = "";
    });

    el.unlockPassword.addEventListener("input", refreshRunState);
    el.unlockPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !el.unlockRunBtn.disabled) runUnlock();
    });
    el.unlockToggle.addEventListener("click", togglePassword);
    el.unlockRunBtn.addEventListener("click", runUnlock);
    el.unlockDownloadBtn.addEventListener("click", downloadResult);

    bindDragAndDrop();
    document.addEventListener("paste", onPaste);
  }

  function isActive() {
    return window.activeTool === "unlock";
  }

  function bindDragAndDrop() {
    const zone = document;
    let counter = 0;
    zone.addEventListener("dragenter", (e) => {
      if (!isActive()) return;
      e.preventDefault();
      counter++;
      el.unlockDropzone.classList.add("is-dragging");
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
        el.unlockDropzone.classList.remove("is-dragging");
      }
    });
    zone.addEventListener("drop", (e) => {
      if (!isActive()) return;
      e.preventDefault();
      e.stopPropagation();
      counter = 0;
      el.unlockDropzone.classList.remove("is-dragging");
      const [file] = e.dataTransfer.files;
      if (file) handleFile(file);
    });
  }

  function onPaste(event) {
    if (!isActive()) return;
    const data = event.clipboardData;
    if (!data) return;
    const file = Array.from(data.files)[0];
    if (file) {
      event.preventDefault();
      handleFile(file);
    }
  }

  function detectKind(file) {
    const name = file.name || "";
    if (/\.pdf$/i.test(name) || file.type === "application/pdf") return "pdf";
    if (
      /\.zip$/i.test(name) ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed"
    ) {
      return "zip";
    }
    return null;
  }

  function handleFile(file) {
    const kind = detectKind(file);
    if (!kind) {
      setStatus("Only password-protected PDF or ZIP files are supported.", "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus(`File is too large (max ${formatBytes(MAX_FILE_BYTES)}).`, "error");
      return;
    }

    U.file = file;
    U.kind = kind;
    U.resultBlob = null;
    U.resultName = null;

    el.unlockDropzone.classList.add("is-hidden");
    el.unlockWorkspace.classList.remove("is-hidden");
    el.unlockResult.classList.add("is-hidden");
    el.unlockDownloadBtn.disabled = true;

    el.unlockFileName.textContent = file.name;
    el.unlockFileInfo.textContent = `${kind.toUpperCase()} \u00b7 ${formatBytes(file.size)}`;
    el.unlockFileIcon.textContent = kind === "pdf" ? "picture_as_pdf" : "folder_zip";

    el.unlockPassword.value = "";
    setStatus("Enter the password", "");
    refreshRunState();
    el.unlockPassword.focus();
  }

  function togglePassword() {
    const show = el.unlockPassword.type === "password";
    el.unlockPassword.type = show ? "text" : "password";
    el.unlockToggle.querySelector(".material-symbols-outlined").textContent = show
      ? "visibility_off"
      : "visibility";
    el.unlockToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
  }

  function refreshRunState() {
    el.unlockRunBtn.disabled = !(U.file && el.unlockPassword.value.length > 0);
  }

  async function runUnlock() {
    if (!U.file) return;
    const password = el.unlockPassword.value;
    if (!password) return;

    el.unlockRunBtn.disabled = true;
    el.unlockDownloadBtn.disabled = true;
    el.unlockResult.classList.add("is-hidden");
    setStatus("Unlocking\u2026", "working");

    try {
      const result =
        U.kind === "pdf"
          ? await unlockPdf(U.file, password)
          : await unlockZip(U.file, password);

      U.resultBlob = result.blob;
      U.resultName = result.name;
      el.unlockNewSize.textContent = formatBytes(result.blob.size);
      el.unlockResult.classList.remove("is-hidden");
      el.unlockDownloadBtn.disabled = false;
      setStatus("Done \u2014 password removed.", "done");
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : "Could not unlock this file.", "error");
    } finally {
      el.unlockRunBtn.disabled = false;
    }
  }

  function downloadResult() {
    if (!U.resultBlob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(U.resultBlob);
    link.download = U.resultName || "unlocked-file";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ---------- PDF (qpdf-wasm) ----------
  async function unlockPdf(file, password) {
    const createModule = await ensureQpdf();
    setStatus("Decrypting PDF\u2026", "working");

    const qpdf = await createModule({ locateFile: () => QPDF_WASM });
    const input = "/input.pdf";
    const output = "/output.pdf";
    qpdf.FS.writeFile(input, new Uint8Array(await file.arrayBuffer()));

    let exitCode = 0;
    try {
      const rc = qpdf.callMain(["--decrypt", "--password=" + password, input, output]);
      if (typeof rc === "number") exitCode = rc;
    } catch (e) {
      // Emscripten can throw an ExitStatus instead of returning the code.
      if (e && typeof e.status === "number") exitCode = e.status;
      else if (!(e && e.name === "ExitStatus")) throw e;
    }

    let out = null;
    try {
      out = qpdf.FS.readFile(output);
    } catch (_) {
      out = null;
    }

    if (!out || !out.length) {
      if (exitCode === 2) throw new Error("Incorrect password. Please try again.");
      throw new Error("Could not unlock this PDF (it may be damaged).");
    }

    // exit code 2 means qpdf rejected the password even if a stale file existed
    if (exitCode === 2) throw new Error("Incorrect password. Please try again.");

    return {
      blob: new Blob([out], { type: "application/pdf" }),
      name: baseName(file.name) + "-unlocked.pdf"
    };
  }

  let qpdfPromise = null;
  function ensureQpdf() {
    if (qpdfPromise) return qpdfPromise;
    setStatus("Loading PDF engine\u2026", "working");
    // The qpdf build exposes its factory as the global `Module`, which collides
    // with OpenCV's global `Module`. Capture qpdf's factory and restore the
    // previous value so the scanner's OpenCV keeps working.
    const prevModule = window.Module;
    qpdfPromise = loadScript(QPDF_JS)
      .then(() => {
        const factory = window.Module;
        window.Module = prevModule;
        if (typeof factory !== "function") {
          throw new Error("PDF engine failed to load. Check your connection.");
        }
        return factory;
      })
      .catch((err) => {
        window.Module = prevModule;
        qpdfPromise = null;
        throw err;
      });
    return qpdfPromise;
  }

  // ---------- ZIP (zip.js) ----------
  async function unlockZip(file, password) {
    const zip = await ensureZip();
    setStatus("Reading archive\u2026", "working");

    const reader = new zip.ZipReader(new zip.BlobReader(file), { password });
    const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

    try {
      const entries = await reader.getEntries();
      if (!entries.length) throw new Error("This ZIP archive is empty.");

      for (const entry of entries) {
        if (entry.directory) {
          await writer.add(entry.filename, null, { directory: true });
          continue;
        }
        let data;
        try {
          data = await entry.getData(new zip.BlobWriter(), {
            password,
            checkSignature: true
          });
        } catch (e) {
          const msg = e && e.message ? e.message : "";
          if (
            msg === zip.ERR_INVALID_PASSWORD ||
            msg === zip.ERR_ENCRYPTED ||
            /password|encrypt/i.test(msg)
          ) {
            throw new Error("Incorrect password. Please try again.");
          }
          throw e;
        }
        await writer.add(entry.filename, new zip.BlobReader(data));
      }

      const blob = await writer.close();
      return { blob, name: baseName(file.name) + "-unlocked.zip" };
    } finally {
      try {
        await reader.close();
      } catch (_) {
        /* ignore */
      }
    }
  }

  let zipPromise = null;
  function ensureZip() {
    if (zipPromise) return zipPromise;
    setStatus("Loading ZIP engine\u2026", "working");
    zipPromise = loadScript(ZIPJS)
      .then(() => {
        if (!window.zip) {
          throw new Error("ZIP engine failed to load. Check your connection.");
        }
        // Run on the main thread to avoid cross-origin worker issues from a CDN.
        window.zip.configure({ useWebWorkers: false });
        return window.zip;
      })
      .catch((err) => {
        zipPromise = null;
        throw err;
      });
    return zipPromise;
  }

  // ---------- helpers ----------
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
    el.unlockStatus.textContent = text;
    el.unlockStatus.classList.remove("is-working", "is-error", "is-done");
    if (type === "working") el.unlockStatus.classList.add("is-working");
    else if (type === "error") el.unlockStatus.classList.add("is-error");
    else if (type === "done") el.unlockStatus.classList.add("is-done");
  }
})();
