# CropShift – Browser-Based Document Scanner & Perspective Crop Tool

A premium, browser-based document scanner that lets you crop, straighten, and export documents with precise perspective correction — all without uploading to any server. Your files stay 100% private in your browser tab.

## ✨ Features

### Document Scanner
- **Smart Corner Detection** – Powered by OpenCV.js, automatically detects document edges on upload, with an **Auto** button to re-run detection anytime.
- **Manual Precision** – Drag the corner handles (4 or 8 corner modes) with a live magnifying lens for pixel-perfect alignment. Full keyboard support: `[`/`]` to pick a corner, arrow keys to nudge, `Shift` for 10px steps, `Ctrl/Cmd+Z` to undo.
- **Perspective Warp** – Full homography-based perspective correction renders a perfectly flat document. 8-corner mode handles curved page edges.
- **Rotate Both Ways** – Rotate the source image 90° left or right; corners follow automatically.
- **Output Filters** – None, Grayscale, B&W (automatic Otsu threshold), or Boost (contrast stretch) applied to preview and export.
- **Export Controls** – JPG / JPEG / PNG / WEBP with adjustable quality (65–100%) and an optional **target file size (KB)** the encoder compresses down to.
- **Copy or Download** – Save the corrected crop as a file, or copy it straight to the clipboard.
- **Resizable Split View** – Draggable divider between Source and Preview panes.

### File Resizer
- Compress images (JPG, PNG, WEBP…) and PDFs to a target size (KB/MB) — quality is reduced only as much as needed.

### Unlock File
- Remove the password from PDF (qpdf WASM) and ZIP (zip.js) files you can already open. The password never leaves your browser.

### Everywhere
- **Zero Server Upload** – Everything runs client-side: your files never leave your browser.
- **Fully Responsive** – Works on desktop, tablet, and mobile; the layout adapts from a split workspace to stacked panes.
- **Dark Mode UI** – Premium dark interface with dotted grid canvas background.

## 🚀 Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/tensedLad/CropShift.git
   cd CropShift
   ```
2. Open `index.html` directly in a browser, **or** use a local dev server:
   ```bash
   npx serve .
   ```
3. Drop an image → adjust corners → download.

## 🛠 Tech Stack

| Layer       | Technology               |
|-------------|--------------------------|
| Layout      | HTML5 + hand-written CSS |
| Logic       | Vanilla JavaScript       |
| CV Engine   | OpenCV.js 4.9.0          |
| PDF / ZIP   | pdf.js, pdf-lib, qpdf-wasm, zip.js (lazy-loaded from CDN) |
| Typography  | Manrope + Inter (Google Fonts) |

## 📁 Project Structure

```
CropShift/
├── index.html    # Document Scanner UI
├── app.js        # Scanner logic: canvas rendering, warp, detection, filters
├── resizer.html  # File Resizer UI
├── resizer.js    # Image/PDF compression to target size
├── unlock.html   # Unlock File UI
├── unlock.js     # PDF/ZIP password removal (qpdf WASM + zip.js)
├── shell.js      # Shared sidebar + nav-height sync
├── styles.css    # All styles (responsive)
└── README.md
```

## 📸 How It Works

1. **Upload** – Drag & drop or click to select an image.
2. **Auto-Detect** – OpenCV finds document edges automatically (if loaded).
3. **Fine-Tune** – Drag corners with a live zoom lens for precision.
4. **Preview** – Real-time perspective-corrected preview in the right pane.
5. **Export** – Choose format & quality, hit Download.

## 📄 License

MIT License — free for personal and commercial use.

---

Made with ❤️ by [tensedLad](https://github.com/tensedLad)
