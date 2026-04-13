const fs = require("fs");
const cheerio = require("cheerio");
const iconv = require("iconv-lite");


function formatIBAN(raw) {
  const clean = raw.replace(/\s+/g, "");
  if (/^[A-Z]{2}/i.test(clean)) {
    return clean.replace(/(.{4})/g, "$1 ").trim();
  }
  return clean;
}

function parsePNB(pnbStr) {
  const s = pnbStr.trim();
  if (!s) return "";
  const withoutCountry = s.startsWith("HR") ? s.slice(2) : s;
  return withoutCountry.trim();
}

function stripDescription(desc) {
  const match = desc.match(/^\d+\s*-\s*(.+)/s);
  return match ? match[1].trim() : desc.trim();
}

function formatDate(dateStr) {
  const parts = dateStr.replace(/\.$/, "").split(".");
  if (parts.length < 3) return dateStr;
  return (
    parts[0].padStart(2, "0") +
    "." +
    parts[1].padStart(2, "0") +
    "." +
    parts[2] +
    "."
  );
}

function parseAmount(text) {
  if (!text) return 0;
  const clean = text.replace(/"/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(clean) || 0;
}

function formatAmount(num) {
  const parts = num.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return intPart + "," + parts[1];
}


function parseHTMLTransactions(html) {
  const $ = cheerio.load(html);
  const transactions = [];

  $("tr.trItems").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;

    const dateLines = $(cells[0]).html().split(/<br\s*\/?>/i);
    const datumValute = dateLines[0]?.trim() || "";
    const datumIzvrsenja = dateLines[1]?.trim() || datumValute;

    const partyHtml = $(cells[1]).html();
    const partyLines = partyHtml.split(/<br\s*\/?>/i);
    const counterpartyName = cheerio.load(partyLines[0] || "").text().trim();
    const counterpartyAccount = cheerio.load(partyLines[1] || "").text().trim();

    const descHtml = $(cells[2]).html();
    const descLines = descHtml.split(/<br\s*\/?>/i);
    const fullDesc = cheerio.load(descLines[0] || "").text().trim();
    const description = stripDescription(fullDesc);

    const pnbHtml = $(cells[3]).html();
    const pnbLines = pnbHtml.split(/<br\s*\/?>/i);
    const pnbPlatitelja = cheerio.load(pnbLines[0] || "").text().trim();
    const pnbPrimatelja = cheerio.load(pnbLines[1] || "").text().trim();

    const isplataText = $(cells[4]).text().trim();
    const uplataText = $(cells[5]).text().trim();
    const isplata =
      isplataText && isplataText !== "\u00a0" && isplataText !== ""
        ? isplataText
        : null;
    const uplata =
      uplataText && uplataText !== "\u00a0" && uplataText !== ""
        ? uplataText
        : null;

    if (!isplata && !uplata) return;
    const isIncoming = !!uplata;

    transactions.push({
      datumValute: formatDate(datumValute),
      datumIzvrsenja: formatDate(datumIzvrsenja),
      counterpartyName,
      counterpartyAccount,
      description,
      amount: isIncoming ? uplata : isplata,
      isIncoming,
      pnbPlatitelja,
      pnbPrimatelja,
    });
  });

  return transactions;
}

function parseHTMLRekapitulacija(html) {
  const $ = cheerio.load(html);

  let konacnoStanje = "";
  $("table.tbHeadDown").each((_, table) => {
    const text = $(table).text();
    if (text.includes("Konačno stanje")) {
      const tds = $(table).find("td");
      konacnoStanje = $(tds[tds.length - 1]).text().trim();
    }
  });

  const rekap = {
    konacnoStanje,
    nalogaNaTeret: "",
    nalogaUKorist: "",
    nalogaUkupno: "",
    prethodnoStanje: "",
    dugovniPromet: "",
    potrazniPromet: "",
    ukupniPromet: "",
    privremnoStanje: "",
    rezerviranoZaNaplatu: "",
    dopustenoPrekoracenje: "",
    rezerviranoPoNaloguFINAe: "",
    raspolozivoStanje: "",
    datumStanja: "",
    obracunataNaknada: "",
  };

  $("table.tbRekap tr").each((_, row) => {
    const tds = $(row).find("td");
    const rowText = $(row).text();

    tds.each((j, td) => {
      const cellText = $(td).text().trim();
      const nextTd = tds[j + 1];
      const nextVal = nextTd ? $(nextTd).text().trim() : "";

      if (cellText.includes("Naloga na teret")) rekap.nalogaNaTeret = nextVal;
      if (cellText.includes("Naloga u korist")) rekap.nalogaUKorist = nextVal;
      if (cellText.includes("Naloga ukupno")) rekap.nalogaUkupno = nextVal;
      if (cellText.includes("Prethodno stanje")) rekap.prethodnoStanje = nextVal;
      if (cellText.includes("Dugovni promet")) rekap.dugovniPromet = nextVal;
      if (cellText.includes("Potražni promet")) rekap.potrazniPromet = nextVal;
      if (cellText.includes("Ukupni promet")) rekap.ukupniPromet = nextVal;
      if (cellText.includes("Privremeno stanje")) rekap.privremnoStanje = nextVal;
      if (cellText.includes("Rezervirano za naplatu")) rekap.rezerviranoZaNaplatu = nextVal;
      if (cellText.includes("Dopušteno prekoračenje")) rekap.dopustenoPrekoracenje = nextVal;
      if (cellText.includes("Rezervirano po nalogu FINA")) rekap.rezerviranoPoNaloguFINAe = nextVal;
      if (cellText.includes("Raspoloživo stanje")) rekap.raspolozivoStanje = nextVal;
    });
  });

  const rekapDiv = $("div#TRekap");
  rekapDiv.each((_, div) => {
    const text = $(div).text();
    if (text.includes("STANJE OSTALIH")) {
      const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{4}\.)/);
      if (dateMatch) rekap.datumStanja = dateMatch[1];
    }
    if (text.includes("Obračunata naknada")) {
      const spans = $(div).find("span");
      if (spans.length >= 2) {
        rekap.obracunataNaknada = $(spans[1]).text().trim();
      }
    }
  });

  return rekap;
}

const MONTHS_SHORT = [
  "jan","feb","mar","apr","maj","jun",
  "jul","aug","sep","okt","nov","dec",
];

function parseHTMLMeta(html) {
  const $ = cheerio.load(html);
  let companyName = "";
  let periodFrom = "";
  let periodTo = "";
  let iban = "";
  let oib = "";

  $("div#Generalno").each((_, el) => {
    const spans = $(el).find("span");
    const label = spans.first().text().trim();
    const value = spans.last().text().trim();
    if (label.includes("Naziv klijenta")) companyName = value;
    if (label.includes("IBAN")) iban = value;
    if (label.includes("OIB")) oib = value;
  });

  $("div").each((_, el) => {
    const text = $(el).text();
    if (text.includes("Za razdoblje")) {
      const m = text.match(
        /(\d{1,2}\.\d{1,2}\.\d{4}\.)\s*do\s*(\d{1,2}\.\d{1,2}\.\d{4}\.)/
      );
      if (m) {
        periodFrom = m[1].trim();
        periodTo = m[2].trim();
      }
    }
  });

  return { companyName, iban, oib, periodFrom, periodTo };
}

function buildSmartFilename(meta) {
  const nameSource = meta.companyName || (meta.oib ? "OIB_" + meta.oib : "izvod");
  const slug = nameSource
    .replace(/\s*(d\.o\.o\.|j\.d\.o\.o\.|d\.d\.)\.?\s*/gi, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+$/, "");

  function fmtPeriod(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.replace(/\.$/, "").split(".");
    if (parts.length < 3) return "";
    const m = parseInt(parts[1], 10);
    const y = parts[2];
    return MONTHS_SHORT[m - 1] + y;
  }

  const from = fmtPeriod(meta.periodFrom);
  const to = fmtPeriod(meta.periodTo);
  const period = from && to && from !== to ? from + "-" + to : from || to || "";

  return (slug + (period ? "_" + period : "") + "_izvod_transakcija").replace(
    /_+/g,
    "_"
  );
}

function parseHTMLFile(filePath) {
  const html = fs.readFileSync(filePath, "utf-8");
  const meta = parseHTMLMeta(html);
  return {
    transactions: parseHTMLTransactions(html),
    rekapitulacija: parseHTMLRekapitulacija(html),
    meta,
    smartName: buildSmartFilename(meta),
  };
}


function parseCSVLine(line) {
  const cols = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "\t" && !inQuotes) {
      cols.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

function parseCSVFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const text = buf.toString("utf16le").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const transactions = [];

  let inDataSection = false;
  let headerCols = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      inDataSection = false;
      headerCols = null;
      continue;
    }
    if (trimmed.startsWith("Redni broj")) {
      headerCols = parseCSVLine(trimmed);
      inDataSection = true;
      continue;
    }
    if (trimmed.startsWith("Izvod prometa")) {
      inDataSection = false;
      continue;
    }
    if (!inDataSection || !headerCols) continue;

    const cols = parseCSVLine(trimmed);
    if (cols.length < 11) continue;

    const datumValute = formatDate(cols[1]?.trim() || "");
    const datumIzvrsenja = formatDate(cols[2]?.trim() || "");
    const description = cols[3]?.trim() || "";
    const counterpartyAccount = cols[4]?.trim() || "";
    const isplataRaw = cols[5]?.trim();
    const uplataRaw = cols[6]?.trim();
    const stanje = cols[7]?.trim() || "";
    const pnbPlatitelja = cols[8]?.trim() || "";
    const pnbPrimatelja = cols[9]?.trim() || "";
    const counterpartyName = cols[10]?.trim() || "";

    const isplata = isplataRaw && isplataRaw !== "" ? isplataRaw.replace(/"/g, "") : null;
    const uplata = uplataRaw && uplataRaw !== "" ? uplataRaw.replace(/"/g, "") : null;

    if (!isplata && !uplata) continue;
    const isIncoming = !!uplata;

    transactions.push({
      datumValute,
      datumIzvrsenja,
      counterpartyName,
      counterpartyAccount,
      description,
      amount: isIncoming ? uplata : isplata,
      isIncoming,
      pnbPlatitelja,
      pnbPrimatelja,
      stanje: stanje.replace(/"/g, ""),
    });
  }

  const nalogaNaTeret = transactions.filter((t) => !t.isIncoming).length;
  const nalogaUKorist = transactions.filter((t) => t.isIncoming).length;
  const dugovniPromet = transactions
    .filter((t) => !t.isIncoming)
    .reduce((sum, t) => sum + parseAmount(t.amount), 0);
  const potrazniPromet = transactions
    .filter((t) => t.isIncoming)
    .reduce((sum, t) => sum + parseAmount(t.amount), 0);

  let prethodnoStanje = 0;
  if (transactions.length > 0) {
    const first = transactions[0];
    const firstStanje = parseAmount(first.stanje);
    const firstAmount = parseAmount(first.amount);
    prethodnoStanje = first.isIncoming
      ? firstStanje - firstAmount
      : firstStanje + firstAmount;
  }

  const konacnoStanje = transactions.length > 0
    ? transactions[transactions.length - 1].stanje
    : "0,00";
  const konacnoNum = parseAmount(konacnoStanje);
  const lastDate = transactions.length > 0
    ? transactions[transactions.length - 1].datumValute
    : "";

  const rekapitulacija = {
    konacnoStanje,
    nalogaNaTeret: String(nalogaNaTeret),
    nalogaUKorist: String(nalogaUKorist),
    nalogaUkupno: String(nalogaNaTeret + nalogaUKorist),
    prethodnoStanje: formatAmount(prethodnoStanje),
    dugovniPromet: formatAmount(dugovniPromet),
    potrazniPromet: formatAmount(potrazniPromet),
    ukupniPromet: formatAmount(potrazniPromet - dugovniPromet),
    privremnoStanje: konacnoStanje,
    rezerviranoZaNaplatu: "0,00",
    dopustenoPrekoracenje: "0,00",
    rezerviranoPoNaloguFINAe: "0,00",
    raspolozivoStanje: konacnoStanje,
    datumStanja: lastDate,
    obracunataNaknada: "",
  };

  let companyName = "";
  let periodFrom = "";
  let periodTo = "";
  let iban = "";
  let oib = "";
  for (const line of lines) {
    if (line.startsWith("Izvod prometa") || line.includes("Izvod prometa")) {
      const ibanMatch = line.match(/(HR\d{19,21})/);
      if (ibanMatch) iban = ibanMatch[1];
      const oibMatch = line.match(/OIB:\s*(\d{11})/);
      if (oibMatch) oib = oibMatch[1];
      const periodMatch = line.match(
        /(\d{1,2}\.\d{1,2}\.\d{4}\.)\s*do\s*(\d{1,2}\.\d{1,2}\.\d{4}\.)/
      );
      if (periodMatch) {
        if (!periodFrom) periodFrom = periodMatch[1];
        periodTo = periodMatch[2];
      }
    }
  }
  const meta = { companyName, iban, oib, periodFrom, periodTo };

  return {
    transactions,
    rekapitulacija,
    meta,
    smartName: buildSmartFilename(meta),
  };
}


function parseWRIFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const text = iconv.decode(buf, "win1250");
  const lines = text.split(/\r?\n/).filter((l) => l.length >= 3);

  const transactions = [];
  let companyName = "";
  let iban = "";
  let oib = "";
  let periodFrom = "";
  let periodTo = "";
  let konacnoStanje = "0,00";
  let prethodnoStanje = "0,00";
  let dugovniPromet = "0,00";
  let potrazniPromet = "0,00";

  for (const line of lines) {
    const recType = line.slice(-3).trim();

    if (recType === "903") {
      iban = line.slice(18, 39).trim();
      companyName = line.slice(42, 112).trim();
      oib = line.slice(155, 166).trim();
    }

    if (recType === "905") {
      const counterpartyAccount = line.slice(2, 36).trim();
      const counterpartyName = line.slice(36, 176).trim();
      const datumValuteRaw = line.slice(176, 184).trim();
      const datumIzvrsenjaRaw = line.slice(184, 192).trim();
      const amountCents1 = parseInt(line.slice(210, 226)) || 0;
      const amountCents2 = parseInt(line.slice(226, 242)) || 0;
      const pnbPlatitelja = line.slice(242, 268).trim();
      const pnbPrimatelja = line.slice(268, 294).trim();
      const description = line.slice(298, 438).trim();

      const amountCents = amountCents1;
      const isIncoming = amountCents < 0;
      const absAmount = Math.abs(amountCents);

      function wriDate(raw) {
        if (raw.length !== 8) return raw;
        return raw.slice(6, 8) + "." + raw.slice(4, 6) + "." + raw.slice(0, 4) + ".";
      }

      transactions.push({
        datumValute: wriDate(datumValuteRaw),
        datumIzvrsenja: wriDate(datumIzvrsenjaRaw),
        counterpartyName,
        counterpartyAccount,
        description,
        amount: formatAmount(absAmount / 100),
        isIncoming,
        pnbPlatitelja,
        pnbPrimatelja,
      });
    }

    if (recType === "907") {
      const d1 = line.slice(100, 108).trim();
      const d2 = line.slice(108, 116).trim();
      function wriToDate(raw) {
        if (raw.length !== 8) return "";
        return raw.slice(6, 8) + "." + raw.slice(4, 6) + "." + raw.slice(0, 4) + ".";
      }
      periodTo = wriToDate(d1);
      periodFrom = wriToDate(d2);

      const parseBal = (s) => formatAmount(Math.abs(parseInt(s) || 0) / 100);
      prethodnoStanje = parseBal(line.slice(116, 132));
      konacnoStanje = parseBal(line.slice(186, 202));
      dugovniPromet = parseBal(line.slice(202, 218));
      potrazniPromet = parseBal(line.slice(218, 234));
    }
  }

  const nalogaNaTeret = transactions.filter((t) => !t.isIncoming).length;
  const nalogaUKorist = transactions.filter((t) => t.isIncoming).length;

  const rekapitulacija = {
    konacnoStanje,
    nalogaNaTeret: String(nalogaNaTeret),
    nalogaUKorist: String(nalogaUKorist),
    nalogaUkupno: String(nalogaNaTeret + nalogaUKorist),
    prethodnoStanje,
    dugovniPromet,
    potrazniPromet,
    ukupniPromet: konacnoStanje,
    privremnoStanje: konacnoStanje,
    rezerviranoZaNaplatu: "0,00",
    dopustenoPrekoracenje: "0,00",
    rezerviranoPoNaloguFINAe: "0,00",
    raspolozivoStanje: konacnoStanje,
    datumStanja: periodTo,
    obracunataNaknada: "",
  };

  const meta = { companyName, iban, oib, periodFrom, periodTo };

  return {
    transactions,
    rekapitulacija,
    meta,
    smartName: buildSmartFilename(meta),
  };
}


module.exports = {
  parseHTMLFile,
  parseCSVFile,
  parseWRIFile,
  formatIBAN,
  parsePNB,
  formatAmount,
  parseAmount,
  buildSmartFilename,
};
