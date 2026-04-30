# CropShift – Browser-Based Document Scanner & Perspective Crop Tool

A premium, browser-based document scanner that lets you crop, straighten, and export documents with precise perspective correction — all without uploading to any server. Your files stay 100% private in your browser tab.

## ✨ Features

- **Smart Corner Detection** – Powered by OpenCV.js, automatically detects document edges on upload.
- **Manual Precision** – Drag the 4 corner handles with a live magnifying lens for pixel-perfect alignment.
- **Perspective Warp** – Full homography-based perspective correction renders a perfectly flat document.
- **Resizable Split View** – Draggable divider between Source and Preview panes.
- **Export Controls** – Choose JPG or PNG format with adjustable quality (65–100%).
- **Zero Server Upload** – Everything runs client-side: your images never leave your browser.
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
| Layout      | HTML5 + Tailwind CSS CDN |
| Logic       | Vanilla JavaScript       |
| CV Engine   | OpenCV.js 4.9.0          |
| Typography  | Manrope + Inter (Google Fonts) |

## 📁 Project Structure

```
CropShift/
├── index.html    # Full UI layout
├── app.js        # Core logic: canvas rendering, warp, detection
├── styles.css    # Additional styles
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
