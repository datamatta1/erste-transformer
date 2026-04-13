const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { formatIBAN, parsePNB } = require("./parser");

const COMPANY_NAME = "OPUSLABS j.d.o.o.";
const COMPANY_IBAN = "HR6824020061101318568";

const FOOTER_TEXT =
  "Sud upisa u registar: Trgovački sud u Rijeci MBS: 040001037, Matični broj: 3337367, OIB: 23057039320, IBAN: HR9524020061031262160, SWIFT/BIC: ESBCHR22, Temeljni kapital 237.778.450,00 EUR, uplaćen u cijelosti i podijeljen na 16.884.175 dionica, svaka nominalne vrijednosti 14,00 EUR. Uprava: Christoph Schoefboeck, Krešimir Barić, Hannes Frotzbacher, Martin Hornig, Katarina Kraljević | Predsjednik Nadzornog odbora: Ingo Bleier";

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getLogoDataURI() {
  const logoPath = path.join(__dirname, "..", "EBC_Logo_screen_anthracite.svg");
  if (!fs.existsSync(logoPath)) {
    throw new Error(
      "EBC_Logo_screen_anthracite.svg not found in project root."
    );
  }
  const svg = fs.readFileSync(logoPath, "utf-8");
  const b64 = Buffer.from(svg).toString("base64");
  return "data:image/svg+xml;base64," + b64;
}

function bankInfoBlock() {
  return `<div class="bank-info">
    <div>Erste&amp;Steiermärkische Bank d.d.</div>
    <div>Jadranski trg 3a</div>
    <div>51000 Rijeka</div>
    <div>www.erste.hr</div>
    <div class="spacer"></div>
    <div>0800 7890</div>
    <div>erstebank@erste.hr</div>
  </div>`;
}

function headerBlock(logoDataURI) {
  return `<div class="header">
    <div class="logo"><img src="${logoDataURI}" alt="Erste Bank"></div>
    ${bankInfoBlock()}
  </div>`;
}

function buildTransactionPage(tx, logoDataURI) {
  const type = tx.isIncoming ? "Potvrda uplate" : "Potvrda isplate";

  let platiteljName, platiteljRacun, platiteljPNB;
  let primateljName, primateljRacun, primateljPNB;

  if (tx.isIncoming) {
    platiteljName = tx.counterpartyName;
    platiteljRacun = formatIBAN(tx.counterpartyAccount);
    platiteljPNB = parsePNB(tx.pnbPlatitelja);
    primateljName = COMPANY_NAME;
    primateljRacun = formatIBAN(COMPANY_IBAN);
    primateljPNB = parsePNB(tx.pnbPrimatelja);
  } else {
    platiteljName = COMPANY_NAME;
    platiteljRacun = formatIBAN(COMPANY_IBAN);
    platiteljPNB = parsePNB(tx.pnbPlatitelja);
    primateljName = tx.counterpartyName;
    primateljRacun = formatIBAN(tx.counterpartyAccount);
    primateljPNB = parsePNB(tx.pnbPrimatelja);
  }

  return `
  <div class="page">
    ${headerBlock(logoDataURI)}
    <div class="title">Ispis prometne stavke - ${escapeHTML(type)}</div>
    <div class="section">
      <div class="section-title">Platitelj</div>
      <div class="field-row"><span class="field-label">Naziv platitelja</span><span class="field-value">${escapeHTML(platiteljName)}</span></div>
      <div class="field-row"><span class="field-label">Račun platitelja</span><span class="field-value">${escapeHTML(platiteljRacun)}</span></div>
      <div class="field-row"><span class="field-label">Model - Poziv na broj platitelja</span><span class="field-value">${escapeHTML(platiteljPNB)}</span></div>
    </div>
    <div class="section">
      <div class="section-title">Primatelj</div>
      <div class="field-row"><span class="field-label">Naziv primatelja</span><span class="field-value">${escapeHTML(primateljName)}</span></div>
      <div class="field-row"><span class="field-label">Račun primatelja</span><span class="field-value">${escapeHTML(primateljRacun)}</span></div>
      <div class="field-row"><span class="field-label">Model - Poziv na broj primatelja</span><span class="field-value">${escapeHTML(primateljPNB)}</span></div>
    </div>
    <div class="section">
      <div class="section-title">Detalji transakcije</div>
      <div class="field-row"><span class="field-label">Iznos</span><span class="field-value">${escapeHTML(tx.amount)} EUR</span></div>
      <div class="field-row"><span class="field-label">Datum valute</span><span class="field-value">${escapeHTML(tx.datumValute)}</span></div>
      <div class="field-row"><span class="field-label">Datum izvršenja</span><span class="field-value">${escapeHTML(tx.datumIzvrsenja)}</span></div>
      <div class="field-row"><span class="field-label">Opis</span><span class="field-value">${escapeHTML(tx.description)}</span></div>
    </div>
    <div class="footer">${escapeHTML(FOOTER_TEXT)}</div>
    <div class="bottom-bar"></div>
  </div>`;
}

function buildRekapitulacijaPage(rekap, logoDataURI) {
  return `
  <div class="page">
    ${headerBlock(logoDataURI)}
    <div class="title">Rekapitulacija</div>
    <table class="rekap-konacno">
      <tr>
        <td class="label-bold">Konačno stanje :</td>
        <td class="value-right">${escapeHTML(rekap.konacnoStanje)}</td>
      </tr>
    </table>
    <div class="rekap-header">R E K A P I T U L A C I J A</div>
    <table class="rekap-table">
      <tr>
        <td class="col-left"></td><td class="col-left-val"></td>
        <td class="col-mid-label">Prethodno stanje</td><td class="col-mid-val">${escapeHTML(rekap.prethodnoStanje)}</td>
        <td class="col-right-label bold">Privremeno stanje</td><td class="col-right-val bold">${escapeHTML(rekap.privremnoStanje)}</td>
      </tr>
      <tr>
        <td class="col-left">Naloga na teret</td><td class="col-left-val">${escapeHTML(rekap.nalogaNaTeret)}</td>
        <td class="col-mid-label">Dugovni promet</td><td class="col-mid-val">${escapeHTML(rekap.dugovniPromet)}</td>
        <td class="col-right-label">Rezervirano za naplatu</td><td class="col-right-val">${escapeHTML(rekap.rezerviranoZaNaplatu)}</td>
      </tr>
      <tr>
        <td class="col-left">Naloga u korist</td><td class="col-left-val">${escapeHTML(rekap.nalogaUKorist)}</td>
        <td class="col-mid-label">Potražni promet</td><td class="col-mid-val">${escapeHTML(rekap.potrazniPromet)}</td>
        <td class="col-right-label">Dopušteno prekoračenje</td><td class="col-right-val">${escapeHTML(rekap.dopustenoPrekoracenje)}</td>
      </tr>
      <tr>
        <td class="col-left"></td><td class="col-left-val"></td>
        <td class="col-mid-label"></td><td class="col-mid-val"></td>
        <td class="col-right-label">Rezervirano po nalogu FINA-e</td><td class="col-right-val">${escapeHTML(rekap.rezerviranoPoNaloguFINAe)}</td>
      </tr>
      <tr>
        <td class="col-left">Naloga ukupno</td><td class="col-left-val">${escapeHTML(rekap.nalogaUkupno)}</td>
        <td class="col-mid-label">Ukupni promet</td><td class="col-mid-val">${escapeHTML(rekap.ukupniPromet)}</td>
        <td class="col-right-label"></td><td class="col-right-val"></td>
      </tr>
      <tr class="rekap-border-top">
        <td class="col-left"></td><td class="col-left-val"></td>
        <td class="col-mid-label"></td><td class="col-mid-val"></td>
        <td class="col-right-label">Raspoloživo stanje</td><td class="col-right-val">${escapeHTML(rekap.raspolozivoStanje)}</td>
      </tr>
    </table>
    ${rekap.datumStanja ? `<div class="rekap-footer-line">STANJE OSTALIH RAČUNA PO POSLOVNOM RAČUNU NA DAN ${escapeHTML(rekap.datumStanja)}</div>` : ""}
    ${rekap.obracunataNaknada ? `<div class="rekap-naknada"><span>Obračunata naknada</span><span class="naknada-val">${escapeHTML(rekap.obracunataNaknada)}</span></div>` : ""}
    <div class="footer">${escapeHTML(FOOTER_TEXT)}</div>
    <div class="bottom-bar"></div>
  </div>`;
}

const PAGE_CSS = `
  @page { size: A4; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: Arial, Helvetica, sans-serif;
    color: #1a1a1a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm; height: 297mm; position: relative;
    padding: 22mm 25mm 0 25mm;
    page-break-after: always; overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  .header {
    display: flex; justify-content: space-between;
    align-items: flex-start; margin-bottom: 28mm;
  }
  .logo img { width: 36mm; display: block; }
  .bank-info {
    text-align: left; font-size: 8.5pt;
    line-height: 1.5; color: #1a1a1a; padding-top: 0;
  }
  .bank-info .spacer { height: 3mm; }
  .title {
    font-size: 18pt; font-weight: bold; margin-bottom: 14mm;
    color: #1a1a1a;
  }
  .section { margin-bottom: 8mm; }
  .section-title {
    font-size: 13pt; font-weight: bold;
    margin-bottom: 1mm; color: #1a1a1a;
  }
  .field-row { display: flex; font-size: 9.5pt; line-height: 1.8; }
  .field-label { width: 86mm; flex-shrink: 0; color: #1a1a1a; }
  .field-value { color: #1a1a1a; }
  .footer {
    position: absolute; bottom: 22mm; left: 25mm; right: 25mm;
    font-size: 6.5pt; color: #1a1a1a; line-height: 1.45;
  }
  .bottom-bar {
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 8mm; background-color: #333;
  }
  .rekap-konacno {
    width: 100%; font-size: 9pt; font-weight: bold;
    border-top: 2px solid #5B9BD5; border-bottom: 2px solid #5B9BD5;
    background: #CCE5F7; padding: 1.5mm 0; margin-bottom: 4mm;
  }
  .rekap-konacno td { padding: 1mm 2mm; }
  .rekap-konacno .label-bold { text-align: left; width: 70%; }
  .rekap-konacno .value-right { text-align: right; width: 30%; }
  .rekap-header {
    font-size: 9pt; font-weight: bold;
    border-bottom: 1px solid #5B9BD5; background: #CCE5F7;
    padding: 2mm 2mm; margin-bottom: 3mm; letter-spacing: 2pt;
  }
  .rekap-table {
    width: 100%; font-size: 8.5pt;
    border-collapse: collapse; margin-bottom: 4mm;
  }
  .rekap-table td { padding: 0.8mm 2mm; vertical-align: top; }
  .rekap-table .col-left { width: 14%; text-align: left; }
  .rekap-table .col-left-val { width: 6%; text-align: right; }
  .rekap-table .col-mid-label { width: 18%; text-align: left; padding-left: 8mm; }
  .rekap-table .col-mid-val { width: 14%; text-align: right; }
  .rekap-table .col-right-label { width: 26%; text-align: left; padding-left: 10mm; }
  .rekap-table .col-right-val { width: 14%; text-align: right; }
  .rekap-table .bold { font-weight: bold; }
  .rekap-border-top td { border-top: 1px solid #333; padding-top: 2mm; }
  .rekap-footer-line {
    font-size: 8.5pt; font-weight: bold;
    border-top: 1px solid #333; padding-top: 2mm;
    margin-top: 2mm; margin-bottom: 2mm;
  }
  .rekap-naknada { font-size: 8.5pt; display: flex; gap: 8mm; }
  .naknada-val { text-align: right; }
`;

function buildFullHTML(transactions, rekapitulacija, logoDataURI) {
  const txPages = transactions
    .map((tx) => buildTransactionPage(tx, logoDataURI))
    .join("\n");
  const rekapPage = buildRekapitulacijaPage(rekapitulacija, logoDataURI);

  return `<!DOCTYPE html>
<html lang="hr"><head><meta charset="UTF-8">
<style>${PAGE_CSS}</style>
</head><body>
${txPages}
${rekapPage}
</body></html>`;
}

function findChromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const candidates = process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ]
    : [
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
      ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "Chrome/Chromium not found. Set CHROMIUM_PATH environment variable."
  );
}

let _browser = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    executablePath: findChromePath(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

async function generatePDF(transactions, rekapitulacija, outputPath) {
  const logoDataURI = getLogoDataURI();
  const html = buildFullHTML(transactions, rekapitulacija, logoDataURI);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 60000 });
    const raw = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 120000,
      ...(outputPath ? { path: outputPath } : {}),
    });
    return Buffer.from(raw);
  } finally {
    await page.close().catch(() => {});
  }
}

async function generateSinglePagePDF(tx) {
  const logoDataURI = getLogoDataURI();
  const pageHTML = buildTransactionPage(tx, logoDataURI);
  const html = `<!DOCTYPE html>
<html lang="hr"><head><meta charset="UTF-8">
<style>${PAGE_CSS}</style>
</head><body>${pageHTML}</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
    const raw = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 30000,
    });
    return Buffer.from(raw);
  } finally {
    await page.close().catch(() => {});
  }
}

function renderSinglePageHTML(tx) {
  const logoDataURI = getLogoDataURI();
  const pageContent = buildTransactionPage(tx, logoDataURI);
  return `<!DOCTYPE html>
<html lang="hr"><head><meta charset="UTF-8">
<style>${PAGE_CSS}</style>
</head><body>${pageContent}</body></html>`;
}

module.exports = { generatePDF, generateSinglePagePDF, closeBrowser, renderSinglePageHTML };
