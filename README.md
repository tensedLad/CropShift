# CropShift

**Free, private PDF and image tools that run entirely in your browser.**

**Live site: [crop-shift.vercel.app](https://crop-shift.vercel.app/)**

Scan documents with perspective correction, convert between images and PDF, edit and sign PDFs, merge, split, number pages, compress files and copy text out of photos. Your files are processed on your own device and are never uploaded to a server.

## Tools

### Scan & Images

| Tool | What it does |
|------|--------------|
| **Document Scanner** | Auto-detects page edges (OpenCV.js), 4 or 8 draggable corners with a zoom lens, perspective warp, rotate, filters (Gray, B&W, Boost). Export JPG / PNG / WEBP / **PDF**, copy to clipboard, or **collect several scans into one multi-page PDF**. |
| **Image to PDF** | Turn any number of photos into one PDF. Reorder by drag and drop, rotate pages, choose A4 / Letter / Legal / A5 or image size, margins and file-size preset. |
| **File Resizer** | Compress an image or PDF to a target size (KB / MB), lowering quality only as much as needed. |
| **Extract Text (OCR)** | Copy text from photos of notes, screenshots, scans and PDFs. Supports English, Hindi and other Indian languages, plus many more. Uses the PDF's own text layer when it has one. |

### PDF Tools

| Tool | What it does |
|------|--------------|
| **Edit PDF** | Type text anywhere, draw, highlight, add rectangles, white-out, insert images and sign (draw or type). Rotate or remove pages. Download as PDF (text stays real, selectable text) or as images. |
| **PDF to Image** | Convert pages to JPG, PNG or WEBP at 72-300 DPI. Pick pages; several pages download as a ZIP. |
| **Merge & Organize** | Combine PDFs (and images) into one file. Reorder, rotate, select and delete pages. Pages are copied without re-rendering, so quality is kept. |
| **Split PDF** | Extract chosen pages, split by custom ranges (`1-3, 4-8`), or every N pages. |
| **Page Numbers & Watermark** | Add page numbers (several formats and positions), a footer line, and/or a text watermark, with live preview. |
| **Unlock File** | Remove the password from a PDF or ZIP you can already open, or strip print / copy restrictions from a PDF. |

## Privacy

- All processing happens in the browser tab. Files and passwords are never sent anywhere.
- Libraries (pdf.js, pdf-lib, OpenCV.js, tesseract.js, qpdf-wasm, zip.js) are loaded from public CDNs the first time a tool needs them. OCR language data is downloaded the same way and cached by the browser.
- The hosted site at crop-shift.vercel.app uses Vercel Web Analytics for anonymous page-view counts. It never receives file contents.
- **White-out note:** the Edit PDF white-out tool covers content visually. The original text underneath stays in the PDF. To truly remove sensitive content, save the edited file with **Images**, which flattens every page.

## Run it locally

No build step, no dependencies to install. Serve the folder with any static file server:

```bash
git clone https://github.com/tensedLad/CropShift.git
cd CropShift
npx serve .
```

Then open the printed URL (usually http://localhost:3000). Opening `index.html` straight from disk works for most tools, but a local server is recommended.

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI | HTML5 + hand-written CSS (responsive, dark theme) |
| Logic | Vanilla JavaScript, no framework, no build |
| Computer vision | OpenCV.js 4.9.0 |
| PDF rendering | pdf.js 3.11 |
| PDF writing | pdf-lib 1.17 |
| OCR | tesseract.js 5 |
| Unlock | qpdf (WebAssembly), zip.js |

## Project structure

```
CropShift/
├── index.html / app.js                  Document Scanner
├── image-to-pdf.html / image-to-pdf.js  Image to PDF
├── resizer.html / resizer.js            File Resizer
├── extract-text.html / extract-text.js  Extract Text (OCR)
├── edit-pdf.html / edit-pdf.js          Edit PDF
├── pdf-to-image.html / pdf-to-image.js  PDF to Image
├── merge-pdf.html / merge-pdf.js        Merge & Organize
├── split-pdf.html / split-pdf.js        Split PDF
├── page-numbers.html / page-numbers.js  Page Numbers & Watermark
├── unlock.html / unlock.js              Unlock File
├── common.js                            Shared helpers (library loading, file intake, ZIP writer, sorting)
├── shell.js                             Sidebar tool list (single source of truth)
├── styles.css                           All styles
└── logo.svg
```

### Adding a tool

1. Create `my-tool.html` (copy an existing tool page) with `<body data-tool="my-tool">`.
2. Add an entry to `GROUPS` in `shell.js` so it shows up in the sidebar.
3. Put the logic in `my-tool.js`; use the helpers on `window.CS` from `common.js`.

## Contributing

Issues and pull requests are welcome. Please keep everything client-side: a change should never upload user files to a server.

## License

[MIT](LICENSE) © tensedLad
