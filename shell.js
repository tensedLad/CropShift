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

  function build() {
    const aside = document.getElementById("sidebar");
    if (!aside) return;

    const items = TOOLS.map((tool) => {
      const isActive = tool.id === active;
      return (
        '<a class="tool-btn' +
        (isActive ? " is-active" : "") +
        '" href="' +
        tool.href +
        '"' +
        (isActive ? ' aria-current="page"' : "") +
        ">" +
        '<span class="material-symbols-outlined">' +
        escapeHtml(tool.icon) +
        "</span>" +
        '<span class="tool-btn-text">' +
        '<span class="tool-btn-title">' +
        escapeHtml(tool.title) +
        "</span>" +
        '<span class="tool-btn-desc">' +
        escapeHtml(tool.desc) +
        "</span>" +
        "</span>" +
        "</a>"
      );
    }).join("");

    aside.innerHTML =
      '<div class="px-4">' +
      "<h3>Tools</h3>" +
      '<div class="tool-list">' +
      items +
      "</div>" +
      "</div>";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
