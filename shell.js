// Shared chrome for all CropShift tool pages.
// Renders the sidebar "Tools" list (single source of truth) into <aside id="sidebar">
// and marks the active tool based on <body data-tool="...">.
// Adding a new tool = add one entry here + a matching <tool>.html page.

(function () {
  "use strict";

  const GROUPS = [
    {
      title: "Scan & Images",
      tools: [
        {
          id: "scanner",
          href: "index.html",
          icon: "document_scanner",
          title: "Document Scanner",
          desc: "Crop, deskew & export"
        },
        {
          id: "image-to-pdf",
          href: "image-to-pdf.html",
          icon: "picture_as_pdf",
          title: "Image to PDF",
          desc: "JPG / PNG photos to PDF"
        },
        {
          id: "resizer",
          href: "resizer.html",
          icon: "compress",
          title: "File Resizer",
          desc: "Shrink image / PDF size"
        },
        {
          id: "extract-text",
          href: "extract-text.html",
          icon: "text_snippet",
          title: "Extract Text (OCR)",
          desc: "Copy text from image / PDF"
        }
      ]
    },
    {
      title: "PDF Tools",
      tools: [
        {
          id: "edit-pdf",
          href: "edit-pdf.html",
          icon: "edit_document",
          title: "Edit PDF",
          desc: "Text, draw, sign, white-out"
        },
        {
          id: "pdf-to-image",
          href: "pdf-to-image.html",
          icon: "photo_library",
          title: "PDF to Image",
          desc: "Pages to JPG / PNG"
        },
        {
          id: "merge-pdf",
          href: "merge-pdf.html",
          icon: "merge",
          title: "Merge & Organize",
          desc: "Combine, reorder, rotate"
        },
        {
          id: "split-pdf",
          href: "split-pdf.html",
          icon: "call_split",
          title: "Split PDF",
          desc: "Extract pages or ranges"
        },
        {
          id: "page-numbers",
          href: "page-numbers.html",
          icon: "format_list_numbered",
          title: "Page Numbers",
          desc: "Numbers & watermark"
        },
        {
          id: "unlock",
          href: "unlock.html",
          icon: "lock_open",
          title: "Unlock File",
          desc: "Remove PDF / ZIP password"
        }
      ]
    }
  ];

  const active = (document.body && document.body.dataset.tool) || "scanner";
  // Tool scripts read this to scope their global drag/drop & paste handlers.
  window.activeTool = active;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function iconSpan(icon) {
    return '<span class="material-symbols-outlined" aria-hidden="true">' + escapeHtml(icon) + "</span>";
  }

  function textBlock(tool) {
    return (
      '<span class="tool-btn-text">' +
      '<span class="tool-btn-title">' +
      escapeHtml(tool.title) +
      "</span>" +
      '<span class="tool-btn-desc">' +
      escapeHtml(tool.desc) +
      "</span>" +
      "</span>"
    );
  }

  function toolLink(tool, isActive) {
    return (
      '<a class="tool-btn' +
      (isActive ? " is-active" : "") +
      '" href="' +
      tool.href +
      '"' +
      (isActive ? ' aria-current="page"' : "") +
      ">" +
      iconSpan(tool.icon) +
      textBlock(tool) +
      "</a>"
    );
  }

  // On the scanner page the Document Scanner item becomes an accordion that
  // slides down to reveal the upload dropzone (app.js wires #fileInput/#uploadZone).
  function scannerAccordion(tool) {
    return (
      '<div class="tool-item">' +
      '<button type="button" id="scannerToolBtn" class="tool-btn is-active is-expandable" aria-expanded="true" aria-controls="scannerUploadPanel">' +
      iconSpan(tool.icon) +
      textBlock(tool) +
      '<span class="material-symbols-outlined tool-chevron" aria-hidden="true">expand_more</span>' +
      "</button>" +
      '<div id="scannerUploadPanel" class="tool-panel is-open">' +
      '<input id="fileInput" type="file" accept="image/*" class="hidden" aria-label="Upload image">' +
      '<button id="uploadZone" type="button" class="upload-zone" aria-label="Upload, drop, or paste an image">' +
      '<span class="material-symbols-outlined" aria-hidden="true">cloud_upload</span>' +
      "<p>Drop, paste, or click<br>to upload</p>" +
      "</button>" +
      "</div>" +
      "</div>"
    );
  }

  function build() {
    const aside = document.getElementById("sidebar");
    if (!aside) return;

    const sections = GROUPS.map((group) => {
      const items = group.tools
        .map((tool) => {
          const isActive = tool.id === active;
          if (tool.id === "scanner" && isActive) return scannerAccordion(tool);
          return toolLink(tool, isActive);
        })
        .join("");
      return (
        '<div class="tool-group">' +
        "<h3>" +
        escapeHtml(group.title) +
        "</h3>" +
        '<div class="tool-list">' +
        items +
        "</div>" +
        "</div>"
      );
    }).join("");

    aside.setAttribute("aria-label", "Tools");
    aside.innerHTML = '<div class="px-4">' + sections + "</div>";

    const btn = document.getElementById("scannerToolBtn");
    const panel = document.getElementById("scannerUploadPanel");
    if (btn && panel) {
      btn.addEventListener("click", () => {
        const open = panel.classList.toggle("is-open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
  }

  // Keep --nav-h in sync with the real nav height so the fixed sidebar and
  // main area never overlap when the nav wraps at smaller widths.
  function syncNavHeight() {
    const nav = document.querySelector("nav");
    if (!nav) return;
    const apply = () => {
      document.documentElement.style.setProperty("--nav-h", nav.offsetHeight + "px");
    };
    apply();
    if (window.ResizeObserver) {
      new ResizeObserver(apply).observe(nav);
    }
    window.addEventListener("resize", apply);
    window.addEventListener("load", apply);
  }

  function start() {
    build();
    syncNavHeight();
  }

  // Build immediately when possible so app.js can bind #uploadZone/#fileInput.
  if (document.getElementById("sidebar")) {
    start();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
