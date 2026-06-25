// Shared chrome for all CropShift tool pages.
// Renders the sidebar "Tools" list (single source of truth) into <aside id="sidebar">
// and marks the active tool based on <body data-tool="...">.
// Adding a new tool = add one entry here + a matching <tool>.html page.

(function () {
  "use strict";

  const TOOLS = [
    {
      id: "scanner",
      href: "index.html",
      icon: "document_scanner",
      title: "Document Scanner",
      desc: "Crop, deskew & export"
    },
    {
      id: "resizer",
      href: "resizer.html",
      icon: "compress",
      title: "File Resizer",
      desc: "Shrink image / PDF size"
    },
    {
      id: "unlock",
      href: "unlock.html",
      icon: "lock_open",
      title: "Unlock File",
      desc: "Remove PDF / ZIP password"
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
    return '<span class="material-symbols-outlined">' + escapeHtml(icon) + "</span>";
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
      '<span class="material-symbols-outlined tool-chevron">expand_more</span>' +
      "</button>" +
      '<div id="scannerUploadPanel" class="tool-panel is-open">' +
      '<input id="fileInput" type="file" accept="image/*" class="hidden" aria-label="Upload image">' +
      '<button id="uploadZone" type="button" class="upload-zone" aria-label="Upload, drop, or paste an image">' +
      '<span class="material-symbols-outlined">cloud_upload</span>' +
      "<p>Drop, paste, or click<br>to upload</p>" +
      "</button>" +
      "</div>" +
      "</div>"
    );
  }

  function build() {
    const aside = document.getElementById("sidebar");
    if (!aside) return;

    const items = TOOLS.map((tool) => {
      const isActive = tool.id === active;
      if (tool.id === "scanner" && isActive) return scannerAccordion(tool);
      return toolLink(tool, isActive);
    }).join("");

    aside.innerHTML =
      '<div class="px-4">' +
      "<h3>Tools</h3>" +
      '<div class="tool-list">' +
      items +
      "</div>" +
      "</div>";

    const btn = document.getElementById("scannerToolBtn");
    const panel = document.getElementById("scannerUploadPanel");
    if (btn && panel) {
      btn.addEventListener("click", () => {
        const open = panel.classList.toggle("is-open");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
  }

  // Build immediately when possible so app.js can bind #uploadZone/#fileInput.
  if (document.getElementById("sidebar")) {
    build();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
