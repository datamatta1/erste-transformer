const express = require("express");
const multer = require("multer");
const archiver = require("archiver");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { PDFDocument } = require("pdf-lib");
const { parseHTMLFile, parseCSVFile, parseWRIFile, formatIBAN, parsePNB } = require("./lib/parser");
const { generatePDF, generateSinglePagePDF, closeBrowser, renderSinglePageHTML } = require("./lib/pdf");
const { generateWRI } = require("./lib/wri");

const app = express();

const upload = multer({
  dest: path.join(os.tmpdir(), "erste-uploads"),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());


const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function createSession(data) {
  const id = crypto.randomBytes(16).toString("hex");
  sessions.set(id, { data, ts: Date.now() });

  for (const [k, v] of sessions) {
    if (Date.now() - v.ts > SESSION_TTL) sessions.delete(k);
  }
  return id;
}

function getSession(id) {
  const entry = sessions.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > SESSION_TTL) {
    sessions.delete(id);
    return null;
  }
  return entry.data;
}


function parseFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".html" || ext === ".htm") return parseHTMLFile(filePath);
  if (ext === ".csv") return parseCSVFile(filePath);
  if (ext === ".wri") return parseWRIFile(filePath);
  throw new Error("Nepodržani format: " + ext);
}

function cleanupFiles(files) {
  if (!files) return;
  for (const f of files) {
    try {
      if (f && f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch (_) {}
  }
}

function summarise(transactions) {
  return {
    total: transactions.length,
    incoming: transactions.filter((t) => t.isIncoming).length,
    outgoing: transactions.filter((t) => !t.isIncoming).length,
    pages: transactions.length + 1,
    transactions: transactions.map((t, i) => ({
      idx: i + 1,
      date: t.datumValute,
      counterparty: t.counterpartyName,
      description: t.description,
      amount: t.amount,
      type: t.isIncoming ? "uplata" : "isplata",
    })),
  };
}


app.post("/api/preview", upload.array("files", 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Nema učitanih datoteka." });
  }
  try {
    const results = [];
    let allTx = [];
    let lastMeta = {};
    let lastSmartName = "izvod_transakcija";
    let lastRekap = null;

    for (const file of req.files) {
      const parsed = parseFile(file.path, file.originalname);
      allTx = allTx.concat(parsed.transactions);
      lastMeta = parsed.meta || lastMeta;
      lastSmartName = parsed.smartName || lastSmartName;
      lastRekap = parsed.rekapitulacija;
      results.push({
        filename: file.originalname,
        summary: summarise(parsed.transactions),
      });
    }
    cleanupFiles(req.files);

    const sessionId = createSession({
      transactions: allTx,
      rekapitulacija: lastRekap,
      meta: lastMeta,
      smartName: lastSmartName,
    });

    res.json({
      files: results,
      meta: lastMeta,
      smartName: lastSmartName,
      sessionId,
    });
  } catch (err) {
    cleanupFiles(req.files);
    res.status(500).json({ error: err.message });
  }
});


app.post("/api/render-page", (req, res) => {
  const { sessionId, index } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(400).json({ error: "Sesija istekla. Pokreni pregled ponovno." });
  }
  const tx = session.transactions[index];
  if (!tx) {
    return res.status(400).json({ error: "Transakcija nije pronađena." });
  }

  const html = renderSinglePageHTML(tx);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});


app.post("/api/convert", upload.array("files", 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Nema učitanih datoteka." });
  }
  try {
    let allTx = [];
    let lastRekap = null;
    let smartName = "izvod_transakcija";

    for (const file of req.files) {
      const parsed = parseFile(file.path, file.originalname);
      allTx = allTx.concat(parsed.transactions);
      lastRekap = parsed.rekapitulacija;
      if (parsed.smartName) smartName = parsed.smartName;
    }
    cleanupFiles(req.files);

    const pdfBuffer = await generatePDF(allTx, lastRekap);
    const incoming = allTx.filter((t) => t.isIncoming).length;
    const outgoing = allTx.filter((t) => !t.isIncoming).length;
    const safeName = path.basename(smartName + ".pdf");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("X-Transaction-Count", String(allTx.length));
    res.setHeader("X-Incoming-Count", String(incoming));
    res.setHeader("X-Outgoing-Count", String(outgoing));
    res.setHeader("X-Smart-Name", smartName);
    res.send(pdfBuffer);
  } catch (err) {
    cleanupFiles(req.files);
    console.error("Convert error:", err);
    res.status(500).json({ error: err.message });
  }
});


function txFilename(idx, tx) {
  const num = String(idx + 1).padStart(3, "0");
  const type = tx.isIncoming ? "uplata" : "isplata";
  const name = tx.counterpartyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+$/, "")
    .slice(0, 40);
  return `${num}_${name}_${type}.pdf`;
}

async function splitPdfPages(mergedBuffer) {
  const src = await PDFDocument.load(mergedBuffer);
  const count = src.getPageCount();
  const pages = [];
  for (let i = 0; i < count; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    pages.push(Buffer.from(await doc.save()));
  }
  return pages;
}

app.post("/api/convert-zip", upload.array("files", 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Nema učitanih datoteka." });
  }
  try {
    let allTx = [];
    let lastRekap = null;
    let smartName = "izvod_transakcija";

    for (const file of req.files) {
      const parsed = parseFile(file.path, file.originalname);
      allTx = allTx.concat(parsed.transactions);
      lastRekap = parsed.rekapitulacija;
      if (parsed.smartName) smartName = parsed.smartName;
    }
    cleanupFiles(req.files);

    const mergedBuffer = await generatePDF(allTx, lastRekap);
    const individualPages = await splitPdfPages(mergedBuffer);

    const folderName = smartName;
    const zipName = path.basename(smartName + ".zip");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    for (let i = 0; i < allTx.length; i++) {
      archive.append(individualPages[i], { name: folderName + "/" + txFilename(i, allTx[i]) });
    }
    if (individualPages.length > allTx.length) {
      archive.append(individualPages[individualPages.length - 1], {
        name: folderName + "/rekapitulacija.pdf",
      });
    }

    await archive.finalize();
  } catch (err) {
    cleanupFiles(req.files);
    console.error("ZIP error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});


app.post("/api/download-page", async (req, res) => {
  const { sessionId, index } = req.body;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(400).json({ error: "Sesija istekla." });
  }
  const tx = session.transactions[index];
  if (!tx) {
    return res.status(400).json({ error: "Transakcija nije pronađena." });
  }
  try {
    const pdfBuffer = await generateSinglePagePDF(tx);
    const type = tx.isIncoming ? "uplata" : "isplata";
    const name = tx.counterpartyName
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "").slice(0, 40);
    const filename = `${String(index + 1).padStart(3, "0")}_${name}_${type}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Download page error:", err);
    res.status(500).json({ error: err.message });
  }
});


app.post("/api/convert-wri", upload.array("files", 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Nema učitanih datoteka." });
  }
  try {
    let allTx = [];
    let lastRekap = null;
    let smartName = "izvod_transakcija";
    let lastMeta = {};

    for (const file of req.files) {
      const parsed = parseFile(file.path, file.originalname);
      allTx = allTx.concat(parsed.transactions);
      lastRekap = parsed.rekapitulacija;
      lastMeta = parsed.meta || lastMeta;
      if (parsed.smartName) smartName = parsed.smartName;
    }
    cleanupFiles(req.files);

    const wriContent = generateWRI(allTx, lastRekap, lastMeta);
    const filename = path.basename(smartName + ".wri");

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Transaction-Count", String(allTx.length));
    res.setHeader("X-Smart-Name", smartName);
    res.send(wriContent);
  } catch (err) {
    cleanupFiles(req.files);
    console.error("WRI export error:", err);
    res.status(500).json({ error: err.message });
  }
});


process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closeBrowser();
  process.exit(0);
});


app.use(function (err, req, res, next) {
  if (err && err.name === "MulterError") {
    return res.status(400).json({ error: "Datoteka prevelika. Maksimalno 50 MB." });
  }
  next(err);
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Erste Transformer running at http://localhost:${PORT}`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
