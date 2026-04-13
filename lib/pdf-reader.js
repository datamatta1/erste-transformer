const fs = require("fs");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.mjs");

async function extractPageLines(doc, pageNum) {
  const page = await doc.getPage(pageNum);
  const content = await page.getTextContent();
  const lines = [];
  let lastY = null;
  let currentLine = "";

  content.items.forEach((item) => {
    if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
      lines.push(currentLine.trim());
      currentLine = "";
    }
    currentLine += item.str;
    lastY = item.transform[5];
  });
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines.filter((l) => l);
}

function parseField(lines, label) {
  for (const line of lines) {
    if (line.startsWith(label)) {
      return line.slice(label.length).trim();
    }
  }
  return "";
}

function extractAmount(text) {
  const m = text.match(/[\d.]+,\d{2}/);
  return m ? m[0] : "";
}

function parseTransactionPage(lines) {
  const titleLine = lines.find((l) => l.startsWith("Ispis prometne stavke"));
  if (!titleLine) return null;

  const isIncoming = titleLine.includes("Potvrda uplate");

  const platiteljName = parseField(lines, "Naziv platitelja");
  const platiteljRacun = parseField(lines, "Račun platitelja");
  const platiteljPNB = parseField(lines, "Model - Poziv na broj platitelja");
  const primateljName = parseField(lines, "Naziv primatelja");
  const primateljRacun = parseField(lines, "Račun primatelja");
  const primateljPNB = parseField(lines, "Model - Poziv na broj primatelja");

  const iznos = parseField(lines, "Iznos").replace(/\s*EUR\s*$/, "");
  const datumValute = parseField(lines, "Datum valute");
  const datumIzvrsenja = parseField(lines, "Datum izvršenja");
  const opis = parseField(lines, "Opis");

  const counterpartyName = isIncoming ? platiteljName : primateljName;
  const counterpartyAccount = (isIncoming ? platiteljRacun : primateljRacun).replace(/\s/g, "");

  const pnbPlat = platiteljPNB ? "HR" + platiteljPNB : "";
  const pnbPrim = primateljPNB ? "HR" + primateljPNB : "";

  return {
    datumValute,
    datumIzvrsenja,
    counterpartyName,
    counterpartyAccount,
    description: opis,
    amount: iznos,
    isIncoming,
    pnbPlatitelja: pnbPlat,
    pnbPrimatelja: pnbPrim,
  };
}

function parseRekapitulacijaPage(lines) {
  const isRekap = lines.some((l) => l.includes("R E K A P I T U L A C I J A"));
  if (!isRekap) return null;

  const fullText = lines.join(" ");

  function extractAfter(label) {
    const idx = fullText.indexOf(label);
    if (idx < 0) return "";
    const after = fullText.slice(idx + label.length);
    return extractAmount(after);
  }

  function extractCount(label) {
    const idx = fullText.indexOf(label);
    if (idx < 0) return "";
    const after = fullText.slice(idx + label.length).trim();
    const m = after.match(/^\d+/);
    return m ? m[0] : "";
  }

  return {
    konacnoStanje: extractAfter("Konačno stanje :"),
    nalogaNaTeret: extractCount("Naloga na teret") || extractCount("teret"),
    nalogaUKorist: extractCount("Naloga u korist"),
    nalogaUkupno: extractCount("Naloga ukupno"),
    prethodnoStanje: extractAfter("Prethodno stanje") || extractAfter("stanje"),
    dugovniPromet: extractAfter("Dugovni promet"),
    potrazniPromet: extractAfter("Potražni promet"),
    ukupniPromet: extractAfter("Ukupni promet"),
    privremnoStanje: extractAfter("Privremeno stanje"),
    rezerviranoZaNaplatu: extractAfter("Rezervirano za naplatu"),
    dopustenoPrekoracenje: extractAfter("Dopušteno prekoračenje"),
    rezerviranoPoNaloguFINAe: extractAfter("FINA-e"),
    raspolozivoStanje: extractAfter("Raspoloživo stanje"),
    datumStanja: (() => {
      const m = fullText.match(/NA DAN\s+(\d{2}\.\d{2}\.\d{4}\.)/);
      return m ? m[1] : "";
    })(),
    obracunataNaknada: extractAfter("Obračunata naknada"),
  };
}

async function parsePDFFile(filePath) {
  const buf = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;

  const transactions = [];
  let companyName = "";
  let companyIBAN = "";
  let firstDate = "";
  let lastDate = "";
  let rekapitulacija = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const lines = await extractPageLines(doc, p);

    const rekapResult = parseRekapitulacijaPage(lines);
    if (rekapResult) {
      rekapitulacija = rekapResult;
      continue;
    }

    const tx = parseTransactionPage(lines);
    if (!tx) continue;
    transactions.push(tx);

    if (!companyName) {
      companyName = tx.isIncoming
        ? parseField(lines, "Naziv primatelja")
        : parseField(lines, "Naziv platitelja");
      companyIBAN = (tx.isIncoming
        ? parseField(lines, "Račun primatelja")
        : parseField(lines, "Račun platitelja")
      ).replace(/\s/g, "");
    }
    if (!firstDate && tx.datumValute) firstDate = tx.datumValute;
    if (tx.datumValute) lastDate = tx.datumValute;
  }

  if (!rekapitulacija) {
    rekapitulacija = {
      konacnoStanje: "", nalogaNaTeret: String(transactions.filter(t => !t.isIncoming).length),
      nalogaUKorist: String(transactions.filter(t => t.isIncoming).length),
      nalogaUkupno: String(transactions.length),
      prethodnoStanje: "", dugovniPromet: "", potrazniPromet: "",
      ukupniPromet: "", privremnoStanje: "",
      rezerviranoZaNaplatu: "", dopustenoPrekoracenje: "",
      rezerviranoPoNaloguFINAe: "", raspolozivoStanje: "",
      datumStanja: lastDate, obracunataNaknada: "",
    };
  }

  const { buildSmartFilename } = require("./parser");
  const meta = {
    companyName,
    iban: companyIBAN,
    oib: "",
    periodFrom: firstDate,
    periodTo: lastDate,
  };

  return {
    transactions,
    rekapitulacija,
    meta,
    smartName: buildSmartFilename(meta),
  };
}

module.exports = { parsePDFFile };
