import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const base = "/Users/chayan/Documents/emission_1/outputs/emission_dashboard_20260620";
const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load(`${base}/STLA_Emission_Compilation_Dashboard.xlsx`),
);

const compiledCheck = await workbook.inspect({
  kind: "table",
  range: "'01_Compiled Tests'!A1:BF12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 58,
  summary: "Compiled emissions verification",
});
await fs.writeFile(`${base}/compiled-check.ndjson`, compiledCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "Post-export error scan",
});
await fs.writeFile(`${base}/post-export-errors.ndjson`, errors.ndjson);

for (const [sheetName, range, fileName] of [
  ["01_Compiled Tests", "A1:BF12", "Compiled_Tests_Preview.png"],
  ["02_Dashboard Data", "A1:G56", "Dashboard_Data_Preview.png"],
]) {
  const image = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(`${base}/${fileName}`, new Uint8Array(await image.arrayBuffer()));
}

console.log(errors.ndjson);
