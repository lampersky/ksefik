# KSeF Invoice Preview

Small browser app that reads a KSeF-style XML invoice, shows a structured preview, and exports a PDF.

## Built with AI

This app was coded with the help of an AI agent.

## Live demo

- https://lampersky.github.io/ksefik/

## Features

- Drag and drop or browse for an XML file
- Parse invoice fields (seller, buyer, totals, payment, line items)
- Show verification hash/URL details when available
- Export invoice preview to PDF (with Unicode font support)
- Switch UI language between English and Polish

## Project structure

- `invoice-preview.html` - app entry page
- `invoice-preview.js` - parsing, rendering, export, and i18n loading logic
- `invoice-preview.css` - styles
- `i18n/en.json` - English translations
- `i18n/pl.json` - Polish translations

## Run locally

Because the app loads translation files with `fetch()`, run it through a local web server (do not open the HTML file directly with `file://`).

Example with Python:

```bash
python -m http.server 8000
```

Then open:

- `http://localhost:8000/invoice-preview.html`

## Notes

- The app depends on CDN scripts for `jsPDF` and `qrcodejs`.
- Supported UI languages are defined in `i18n/*.json`.
