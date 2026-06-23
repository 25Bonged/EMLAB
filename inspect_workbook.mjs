import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "/Users/chayan/Documents/emission_1/STLA_Emission_Result_Compile.xlsx";
const outDir = "/Users/chayan/Documents/emission_1/.workbook_inspection";
await fs.mkdir(outDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheetIndex = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  summary: "Workbook sheet index",
});
await fs.writeFile(`${outDir}/sheet-index.ndjson`, sheetIndex.ndjson);
console.log(sheetIndex.ndjson);

for (let i = 0; i < 13; i += 1) {
  const sheet = workbook.worksheets.getItemAt(i);
  const used = sheet.getUsedRange();
  const address = used?.address ?? "A1";
  console.log(`SHEET ${i + 1}: ${sheet.name} | ${address}`);

  const table = await workbook.inspect({
    kind: "table",
    range: `'${sheet.name.replaceAll("'", "''")}'!${address}`,
    include: "values,formulas",
    tableMaxRows: 80,
    tableMaxCols: 60,
    summary: `${sheet.name} used range`,
  });
  await fs.writeFile(`${outDir}/${String(i + 1).padStart(2, "0")}-${sheet.name.replaceAll("/", "_")}.ndjson`, table.ndjson);
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "Formula error scan",
});
await fs.writeFile(`${outDir}/formula-errors.ndjson`, errors.ndjson);
console.log(errors.ndjson);
