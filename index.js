#!/usr/bin/env node

const os = require("os");
const path = require("path");
const { parseHTMLFile, parseCSVFile, parseWRIFile } = require("./lib/parser");
const { parsePDFFile } = require("./lib/pdf-reader");
const { generatePDF, closeBrowser } = require("./lib/pdf");

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: node index.js <file1.html|.csv|.wri|.pdf> [file2 ...] [--out dir]");
    console.log("  Outputs to ~/Downloads by default.");
    process.exit(1);
  }

  const outIdx = args.indexOf("--out");
  let outDir = path.join(os.homedir(), "Downloads");
  if (outIdx !== -1) {
    outDir = args[outIdx + 1] || outDir;
    args.splice(outIdx, 2);
  }

  const inputFiles = args.filter((a) => !a.startsWith("--"));
  if (inputFiles.length === 0) {
    console.error("No input files provided.");
    process.exit(1);
  }

  for (const inputFile of inputFiles) {
    const ext = path.extname(inputFile).toLowerCase();
    let parsed;
    if (ext === ".html" || ext === ".htm") {
      console.log(`Parsing HTML: ${inputFile}`);
      parsed = parseHTMLFile(inputFile);
    } else if (ext === ".csv") {
      console.log(`Parsing CSV: ${inputFile}`);
      parsed = parseCSVFile(inputFile);
    } else if (ext === ".wri") {
      console.log(`Parsing WRI: ${inputFile}`);
      parsed = parseWRIFile(inputFile);
    } else if (ext === ".pdf") {
      console.log(`Parsing PDF: ${inputFile}`);
      parsed = await parsePDFFile(inputFile);
    } else {
      console.error(`Skipping unsupported file: ${inputFile}`);
      continue;
    }

    const { transactions, rekapitulacija, smartName } = parsed;
    const outputFile = path.join(outDir, (smartName || "izvod") + ".pdf");

    const incoming = transactions.filter((t) => t.isIncoming).length;
    const outgoing = transactions.filter((t) => !t.isIncoming).length;
    console.log(
      `  ${transactions.length} transactions (${incoming} in, ${outgoing} out)`
    );

    console.log(`  -> ${outputFile}`);
    await generatePDF(transactions, rekapitulacija, parsed.meta, outputFile);
  }

  await closeBrowser();
  console.log("Done!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
