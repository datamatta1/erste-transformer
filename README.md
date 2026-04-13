# Erste Transformer

Convert Erste Bank account statements into individual PDF transaction slips — the same format the bank prints at the counter.

Takes an HTML, CSV, or WRI statement export from Erste mBanking and produces:

- **PDF** with each transaction on its own A4 page (Potvrda uplate / Potvrda isplate) plus a Rekapitulacija summary
- **ZIP** with every transaction as a separate PDF file inside a named folder
- **WRI** output for import into accounting software

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000
```

Requires Google Chrome or Chromium installed on the host machine.

## Web UI

Three-step workflow:

1. **Upload** — drag and drop your `.html`, `.csv`, or `.wri` bank statement
2. **Preview** — browse all transactions in a table, click any row to see the exact PDF output
3. **Export** — download as a single merged PDF, a ZIP of individual PDFs, or a WRI file

Files are automatically named using the company name and statement period, e.g. `opuslabs_dec2025-apr2026_izvod_transakcija.pdf`.

## CLI

```bash
node index.js statement.html
node index.js statement.csv statement2.html
node index.js statement.wri --out /path/to/dir
```

Output goes to `~/Downloads` by default.

## Docker

```bash
docker build -t erste-transformer .
docker run -p 3000:3000 erste-transformer
```

The Docker image includes Chromium and Croatian font support.

## Supported Formats

| Input | Output |
|-------|--------|
| HTML (Erste mBanking export) | PDF, ZIP, WRI |
| CSV (Erste mBanking export, UTF-16LE) | PDF, ZIP, WRI |
| WRI (Erste Bank fixed-width, Windows-1250) | PDF, ZIP, WRI |

## PDF Layout

Each transaction page matches the official Erste Bank "Ispis prometne stavke" format:

- Erste Bank logo and contact details in the header
- Platitelj / Primatelj sections with name, IBAN, and model/poziv na broj
- Detalji transakcije with amount, dates, and description
- Legal footer and branded bottom bar

Incoming transactions generate "Potvrda uplate", outgoing generate "Potvrda isplate".

## Project Structure

```
index.js          CLI entry point
server.js         Express web server
lib/
  parser.js       HTML, CSV, and WRI parsers
  pdf.js          PDF generation via Puppeteer
  wri.js          WRI file generation (Windows-1250)
public/
  index.html      Web UI
  favicon.svg     Browser tab icon
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `CHROMIUM_PATH` | Auto-detected | Path to Chrome/Chromium binary |

## Disclaimer

This is an independent, open-source tool developed by OpusLabs. It is **not affiliated with, endorsed by, or officially connected to Erste&Steiermärkische Bank d.d.** in any way.

Generated documents are reproductions of the bank's standard transaction slip format based on data exported by the user from their own bank account. Every generated PDF is marked with:

> *Generirano pomoću Erste Transformer (OpusLabs) — nije službeni dokument banke*

This tool is intended for internal bookkeeping, accounting, and archival purposes. It does not access bank systems, authenticate on behalf of users, or transmit any financial data externally. All processing happens locally on the user's machine or server.

The Erste Bank name, logo, and legal registration text appear on generated documents solely to reproduce the format familiar to accountants working with Erste Bank statements. If Erste&Steiermärkische Bank d.d. objects to the use of their branding, we will promptly comply with any request to modify or remove it.

**Do not use this tool to fabricate, falsify, or misrepresent financial documents.**

## Support

- Issues: [github.com/datamatta1/erste-transformer/issues](https://github.com/datamatta1/erste-transformer/issues)
- Author: OpusLabs — mkomljenovic11@gmail.com

## License

MIT — OpusLabs
