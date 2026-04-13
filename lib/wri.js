// WRI: Erste Bank fixed-width format. 1000 chars/line, record type in last 3.
// 900=bank, 903=account, 905=transaction, 907=summary, 909=footer, 999=EOF

const iconv = require("iconv-lite");
const { parseAmount } = require("./parser");

const LINE_LEN = 1000;

function pad(str, len) {
  return (str || "").slice(0, len).padEnd(len, " ");
}

function padNum(str, len) {
  return (str || "").slice(0, len).padStart(len, "0");
}

function amountField(value) {
  const cents = Math.round(Math.abs(value) * 100);
  const sign = value < 0 ? "-" : "+";
  return sign + String(cents).padStart(15, "0");
}

function dateToWRI(dateStr) {
  if (!dateStr) return "00000000";
  const parts = dateStr.replace(/\.$/, "").split(".");
  if (parts.length < 3) return "00000000";
  return parts[2] + parts[1].padStart(2, "0") + parts[0].padStart(2, "0");
}

function makeLine(content, recType) {
  const body = pad(content, LINE_LEN - 3);
  return body + recType;
}

function generateWRI(transactions, rekapitulacija, meta) {
  const lines = [];
  const now = new Date();
  const todayWRI =
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");

  const iban = meta.iban || "HR6824020061101318568";
  const companyName = meta.companyName || "";
  const oib = meta.oib || "";
  const currency = "EUR";
  const bankCode = "2402006";
  const swift = "ESBCHR22";
  const bankName = "ERSTE&STEIERM\u00c4RKISCHE BANK";

  let r900 = "";
  r900 += pad(bankCode, 7);
  r900 += pad(bankName, 43);
  r900 += pad(oib, 11);
  r900 += "10002";
  r900 += todayWRI;
  lines.push(makeLine(r900, "900"));

  let r903 = "";
  r903 += pad(bankCode, 7);                  // 0-6
  r903 += pad(swift, 11);                    // 7-17
  r903 += pad(iban, 21);                     // 18-38
  r903 += pad(currency, 3);                  // 39-41
  r903 += pad(companyName, 70);              // 42-111
  r903 += pad("", 35);                       // 112-146 city
  r903 += pad("", 8);                        // 147-154 unknown
  r903 += pad(oib, 11);                      // 155-165
  r903 += pad("03000", 5);                   // 166-170 izvod
  r903 += padNum(String(transactions.length), 2); // 171-172 tx count
  r903 += dateToWRI(meta.periodTo);          // 173-180 date
  r903 += pad("0031", 4);                    // 181-184
  r903 += pad("000", 5);                     // 185-189
  lines.push(makeLine(r903, "903"));

  transactions.forEach((tx, i) => {
    let r = "";
    r += padNum(String(i + 1), 2);                   // 0-1 seq
    r += pad(tx.counterpartyAccount, 34);             // 2-35
    r += pad(tx.counterpartyName, 140);               // 36-175
    r += dateToWRI(tx.datumValute);                   // 176-183
    r += dateToWRI(tx.datumIzvrsenja);                // 184-191
    r += pad(currency, 3);                            // 192-194
    r += pad("", 15);                                 // 195-209 filler

    const amtCents = parseAmount(tx.amount) * (tx.isIncoming ? -1 : 1);
    r += amountField(amtCents);                       // 210-225
    r += amountField(amtCents);                       // 226-241 (same for same-currency)
    r += pad(tx.pnbPlatitelja, 26);                   // 242-267
    r += pad(tx.pnbPrimatelja, 26);                   // 268-293
    r += pad("", 4);                                  // 294-297 šifra namjene
    r += pad(tx.description, 140);                    // 298-437
    r += pad("", 34);                                 // 438-471 filler
    r += pad("", 36);                                 // 472-507 referenca
    lines.push(makeLine(r, "905"));
  });

  const rek = rekapitulacija || {};
  const openBal = parseAmount(rek.prethodnoStanje || "0");
  const closeBal = parseAmount(rek.konacnoStanje || "0");
  const debitTotal = parseAmount(rek.dugovniPromet || "0");
  const creditTotal = parseAmount(rek.potrazniPromet || "0");
  const raspolozivo = parseAmount(rek.raspolozivoStanje || rek.konacnoStanje || "0");

  let r907 = "";
  r907 += pad(iban, 21);                              // 0-20
  r907 += pad(currency, 3);                           // 21-23
  r907 += pad(companyName, 70);                       // 24-93
  r907 += pad("03002", 5);                            // 94-98
  r907 += padNum(String(transactions.length), 1);     // 99
  r907 += dateToWRI(meta.periodTo);                   // 100-107
  r907 += dateToWRI(meta.periodFrom);                 // 108-115
  r907 += amountField(openBal);                       // 116-131
  r907 += amountField(0);                             // 132-147
  r907 += pad("", 8);                                 // 148-155
  r907 += padNum("", 30);                             // 156-185
  r907 += amountField(closeBal);                      // 186-201
  r907 += amountField(debitTotal);                    // 202-217
  r907 += amountField(creditTotal);                   // 218-233
  r907 += amountField(raspolozivo);                   // 234-249
  r907 += padNum(String(transactions.length), 10);    // 250-259
  lines.push(makeLine(r907, "907"));

  let r909 = "";
  r909 += todayWRI;
  r909 += padNum(String(transactions.length), 5);
  lines.push(makeLine(r909, "909"));

  lines.push(makeLine("", "999"));

  const content = lines.join("\r\n") + "\r\n";
  return iconv.encode(content, "win1250");
}

module.exports = { generateWRI };
