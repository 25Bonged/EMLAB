import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "/Users/chayan/Documents/emission_1/STLA_Emission_Result_Compile.xlsx";
const outputDir = "/Users/chayan/Documents/emission_1/outputs/emission_dashboard_20260620";
const outputPath = `${outputDir}/STLA_Emission_Compilation_Dashboard.xlsx`;
const previewPath = `${outputDir}/Emission_Dashboard_Preview.png`;

const sourceSheetNames = [
  "CC24MB6_FEV - WLTP",
  "CC24AT6_FEV - WLTP",
  "CC24AT6_FEV - DDCI",
  "CC22AT6_FEV - WLTP",
  "WLTP_ARAI",
  "CC24MB6_FEV - MIDC",
  "CC22MB6_FEV - MIDC",
  "CC22AT6_FEV - MIDC",
  "MIDC_ARAI",
];

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function parseDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  const text = String(value ?? "").split("\n")[0].trim();
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

function programFromSheet(name) {
  if (name.startsWith("CC24")) return "CC24";
  if (name.startsWith("CC22")) return "CC22";
  return "Certification";
}

function findHeader(headers, target) {
  const normalizedTarget = normalize(target);
  return headers.findIndex((value) => normalize(value) === normalizedTarget);
}

const records = [];
for (const sheetName of sourceSheetNames) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const values = sheet.getUsedRange().values;
  if (!values || values.length < 9) continue;

  const top = values[5] ?? [];
  const emissionStart = findHeader(top, "Emission Results");
  const fuelCol = findHeader(top, "Fuel");
  const cycleCol = findHeader(top, "Cycle");
  const catalystCol = findHeader(top, "Catalyst");
  const rldCol = findHeader(top, "RLD - Dyno set");
  const inertiaCol = findHeader(top, "Inertia (kg)");
  const odoCol = findHeader(top, "ODO (km)");
  const sttCol = findHeader(top, "STT");
  const socCol = top.findIndex((value) => normalize(value).startsWith("start soc"));
  const remarksCol = findHeader(top, "Remarks");
  const linkCol = findHeader(top, "Loc link");
  const dataChangesCol = findHeader(top, "Data changes");
  const dcmCol = findHeader(top, "DCM used");

  const stat = values[1] ?? [];
  const engineering = values[2] ?? [];

  for (let rowIndex = 8; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] ?? [];
    const date = parseDate(row[0]);
    const co = Number(row[emissionStart + 1]);
    if (!date || !Number.isFinite(co)) continue;

    const cycle = row[cycleCol] || (sheetName.includes("WLTP") ? "WLTP" : sheetName.includes("MIDC") ? "MIDC" : "DDCI");
    const phase = row[5];
    const transmission = row[6];
    const testId = `${String(records.length + 1).padStart(3, "0")}-${programFromSheet(sheetName)}-${transmission}-${cycle}`;
    const changes = [row[dcmCol], dataChangesCol >= 0 ? row[dataChangesCol] : null]
      .filter((value) => value && value !== "-")
      .join(" | ");

    records.push({
      testId,
      sourceSheet: sheetName,
      sourceRow: rowIndex + 1,
      date,
      facility: row[1],
      program: programFromSheet(sheetName),
      cycle,
      phase,
      transmission,
      vehicleNo: row[4],
      condition: row[2],
      startTemp: row[3],
      catalyst: row[catalystCol],
      fuel: row[fuelCol],
      dataset: row[7],
      changes,
      stt: row[sttCol],
      soc: row[socCol],
      inertia: row[inertiaCol],
      odo: row[odoCol],
      co: row[emissionStart + 1],
      thc: row[emissionStart + 2],
      nox: row[emissionStart + 3],
      co2: row[emissionStart + 4],
      ch4: row[emissionStart + 5],
      nmhc: row[emissionStart + 6],
      pm: row[emissionStart + 7],
      pn: row[emissionStart + 8],
      fe: row[emissionStart + 10],
      distance: row[emissionStart + 11],
      rldA: row[rldCol],
      rldB: row[rldCol + 1],
      rldC: row[rldCol + 2],
      engCO: engineering[emissionStart + 1],
      engTHC: engineering[emissionStart + 2],
      engNOx: engineering[emissionStart + 3],
      engNMHC: engineering[emissionStart + 6],
      engPM: engineering[emissionStart + 7],
      engPN: engineering[emissionStart + 8],
      statCO: stat[emissionStart + 1],
      statTHC: stat[emissionStart + 2],
      statNOx: stat[emissionStart + 3],
      statNMHC: stat[emissionStart + 6],
      statPM: stat[emissionStart + 7],
      statPN: stat[emissionStart + 8],
      remarks: row[remarksCol],
      link: row[linkCol],
    });
  }
}

records.sort((a, b) => a.date - b.date || a.testId.localeCompare(b.testId));
records.forEach((record, index) => {
  record.testId = `${String(index + 1).padStart(3, "0")}-${record.program}-${record.transmission}-${record.cycle}`;
});

const compiled = workbook.worksheets.add("01_Compiled Tests");
compiled.showGridLines = false;
const headers = [
  "Test ID", "Source Sheet", "Source Row", "Test Date", "Facility", "Program", "Cycle", "Phase",
  "Transmission", "Vehicle No.", "Test Condition", "Start Temp °C", "Catalyst", "Fuel", "Dataset",
  "DCM / Data Changes", "STT", "Start SOC %", "Inertia kg", "ODO km", "CO mg/km", "THC mg/km",
  "NOx mg/km", "CO2 mg/km", "CH4 mg/km", "NMHC mg/km", "PM mg/km", "PN #/km", "Fuel Economy km/l",
  "Distance km", "RLD A", "RLD B", "RLD C", "Eng Target CO", "Eng Target THC", "Eng Target NOx",
  "Eng Target NMHC", "Eng Target PM", "Eng Target PN", "Stat Limit CO", "Stat Limit THC", "Stat Limit NOx",
  "Stat Limit NMHC", "Stat Limit PM", "Stat Limit PN", "CO / Target", "THC / Target", "NOx / Target",
  "NMHC / Target", "PM / Target", "PN / Target", "Max Target Util.", "Critical Pollutant", "Eng Status",
  "Stat Status", "Data Quality", "Remarks", "Location Link",
];
compiled.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];

const bodyValues = records.map((r) => [
  r.testId, r.sourceSheet, r.sourceRow, r.date, r.facility, r.program, r.cycle, r.phase, r.transmission,
  r.vehicleNo, r.condition, r.startTemp, r.catalyst, r.fuel, r.dataset, r.changes, r.stt, r.soc, r.inertia,
  r.odo, r.co, r.thc, r.nox, r.co2, r.ch4, r.nmhc, r.pm, r.pn, r.fe, r.distance, r.rldA, r.rldB, r.rldC,
  r.engCO, r.engTHC, r.engNOx, r.engNMHC, r.engPM, r.engPN, r.statCO, r.statTHC, r.statNOx, r.statNMHC,
  r.statPM, r.statPN, null, null, null, null, null, null, null, null, null, null, null, r.remarks, r.link,
]);
compiled.getRangeByIndexes(1, 0, bodyValues.length, headers.length).values = bodyValues;

const lastCompiledRow = records.length + 1;
for (let row = 2; row <= lastCompiledRow; row += 1) {
  compiled.getRange(`AT${row}:AZ${row}`).formulas = [[
    `=IFERROR(U${row}/AH${row},"")`,
    `=IFERROR(V${row}/AI${row},"")`,
    `=IFERROR(W${row}/AJ${row},"")`,
    `=IFERROR(Z${row}/AK${row},"")`,
    `=IFERROR(AA${row}/AL${row},"")`,
    `=IFERROR(AB${row}/AM${row},"")`,
    `=MAX(AT${row}:AY${row})`,
  ]];
  compiled.getRange(`BA${row}:BD${row}`).formulas = [[
    `=IF(AZ${row}="","",IF(AZ${row}=AT${row},"CO",IF(AZ${row}=AU${row},"THC",IF(AZ${row}=AV${row},"NOx",IF(AZ${row}=AW${row},"NMHC",IF(AZ${row}=AX${row},"PM","PN"))))))`,
    `=IF(AZ${row}="","CHECK",IF(AZ${row}<=1,"PASS","FAIL"))`,
    `=IF(OR(U${row}>AN${row},V${row}>AO${row},W${row}>AP${row},Z${row}>AQ${row},AA${row}>AR${row},AB${row}>AS${row}),"FAIL","PASS")`,
    `=IF(COUNTA(D${row},G${row},I${row},U${row},W${row})<5,"CHECK","OK")`,
  ]];
}

compiled.freezePanes.freezeRows(1);
compiled.freezePanes.freezeColumns(4);
compiled.getRange(`D2:D${lastCompiledRow}`).format.numberFormat = "dd-mmm-yyyy";
compiled.getRange(`L2:L${lastCompiledRow}`).format.numberFormat = "0.0";
compiled.getRange(`R2:T${lastCompiledRow}`).format.numberFormat = "0.0";
compiled.getRange(`U2:Z${lastCompiledRow}`).format.numberFormat = "0.00";
compiled.getRange(`AA2:AA${lastCompiledRow}`).format.numberFormat = "0.000";
compiled.getRange(`AB2:AB${lastCompiledRow}`).format.numberFormat = "0.00E+00";
compiled.getRange(`AC2:AG${lastCompiledRow}`).format.numberFormat = "0.00";
compiled.getRange(`AT2:AZ${lastCompiledRow}`).format.numberFormat = "0%";
compiled.getRange("A1:BF1").format = {
  fill: "#17365D",
  font: { bold: true, color: "#FFFFFF", size: 10 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "all", style: "thin", color: "#8EA9C1" },
};
compiled.getRange(`A2:BF${lastCompiledRow}`).format = {
  font: { color: "#263238", size: 9 },
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#D9E2F3" },
};
compiled.getRange(`A2:A${lastCompiledRow}`).format.font = { bold: true, color: "#17365D" };
compiled.getRange(`AT2:AZ${lastCompiledRow}`).conditionalFormats.add("colorScale", {
  thresholds: ["min", 1, "max"],
  colors: ["#63BE7B", "#FFEB84", "#F8696B"],
});
compiled.getRange(`BB2:BC${lastCompiledRow}`).conditionalFormats.add("containsText", {
  text: "FAIL",
  format: { fill: "#F8696B", font: { bold: true, color: "#7F0000" } },
});
compiled.getRange(`BB2:BC${lastCompiledRow}`).conditionalFormats.add("containsText", {
  text: "PASS",
  format: { fill: "#C6EFCE", font: { bold: true, color: "#006100" } },
});
compiled.getRange(`BD2:BD${lastCompiledRow}`).conditionalFormats.add("containsText", {
  text: "CHECK",
  format: { fill: "#FFEB9C", font: { bold: true, color: "#9C6500" } },
});
compiled.getRange("A:A").format.columnWidth = 20;
compiled.getRange("B:B").format.columnWidth = 25;
compiled.getRange("C:D").format.columnWidth = 12;
compiled.getRange("E:K").format.columnWidth = 14;
compiled.getRange("L:L").format.columnWidth = 12;
compiled.getRange("M:P").format.columnWidth = 22;
compiled.getRange("Q:T").format.columnWidth = 12;
compiled.getRange("U:AB").format.columnWidth = 13;
compiled.getRange("AC:AS").format.columnWidth = 12;
compiled.getRange("AT:BD").format.columnWidth = 13;
compiled.getRange("BE:BF").format.columnWidth = 34;
compiled.getRange("1:1").format.rowHeight = 42;
const compiledTable = compiled.tables.add(`A1:BF${lastCompiledRow}`, true, "CompiledEmissionTests");
compiledTable.style = "TableStyleMedium2";
compiledTable.showBandedRows = true;
compiledTable.showFilterButton = true;

const support = workbook.worksheets.add("02_Dashboard Data");
support.showGridLines = false;
support.getRange("A1:G1").values = [["Pollutant", "Engineering Target", "Average Result", "Average Util.", "Worst Util.", "Pass Tests", "Pass Rate"]];
const pollutants = [
  ["CO", "U", "AH", "AT"],
  ["THC", "V", "AI", "AU"],
  ["NOx", "W", "AJ", "AV"],
  ["NMHC", "Z", "AK", "AW"],
  ["PM", "AA", "AL", "AX"],
  ["PN", "AB", "AM", "AY"],
];
for (let i = 0; i < pollutants.length; i += 1) {
  const row = i + 2;
  const [name, resultCol, targetCol, ratioCol] = pollutants[i];
  support.getRange(`A${row}`).values = [[name]];
  support.getRange(`B${row}:G${row}`).formulas = [[
    `=AVERAGE('01_Compiled Tests'!$${targetCol}$2:$${targetCol}$${lastCompiledRow})`,
    `=AVERAGE('01_Compiled Tests'!$${resultCol}$2:$${resultCol}$${lastCompiledRow})`,
    `=AVERAGE('01_Compiled Tests'!$${ratioCol}$2:$${ratioCol}$${lastCompiledRow})`,
    `=MAX('01_Compiled Tests'!$${ratioCol}$2:$${ratioCol}$${lastCompiledRow})`,
    `=COUNTIF('01_Compiled Tests'!$${ratioCol}$2:$${ratioCol}$${lastCompiledRow},"<=1")`,
    `=F${row}/COUNTA('01_Compiled Tests'!$A$2:$A$${lastCompiledRow})`,
  ]];
}

support.getRange("A10:B12").values = [["Engineering Outcome", "Tests"], ["PASS", null], ["FAIL", null]];
support.getRange("B11").formulas = [[`=COUNTIF('01_Compiled Tests'!$BB$2:$BB$${lastCompiledRow},"PASS")`]];
support.getRange("B12").formulas = [[`=COUNTIF('01_Compiled Tests'!$BB$2:$BB$${lastCompiledRow},"FAIL")`]];
support.getRange("D10:E13").values = [["Cycle", "Tests"], ["WLTP", null], ["MIDC", null], ["DDCI", null]];
for (let row = 11; row <= 13; row += 1) {
  support.getRange(`E${row}`).formulas = [[`=COUNTIF('01_Compiled Tests'!$G$2:$G$${lastCompiledRow},D${row})`]];
}

const configs = [...new Set(records.map((r) => `${r.program} ${r.transmission} ${r.cycle}`))].sort();
support.getRange("A16:G16").values = [["Configuration", "Program", "Transmission", "Cycle", "Tests", "Latest Test", "Worst Eng. Util."]];
configs.forEach((config, index) => {
  const [program, transmission, cycle] = config.split(" ");
  const row = 17 + index;
  support.getRange(`A${row}:D${row}`).values = [[config, program, transmission, cycle]];
  support.getRange(`E${row}:G${row}`).formulas = [[
    `=COUNTIFS('01_Compiled Tests'!$F$2:$F$${lastCompiledRow},B${row},'01_Compiled Tests'!$I$2:$I$${lastCompiledRow},C${row},'01_Compiled Tests'!$G$2:$G$${lastCompiledRow},D${row})`,
    `=MAXIFS('01_Compiled Tests'!$D$2:$D$${lastCompiledRow},'01_Compiled Tests'!$F$2:$F$${lastCompiledRow},B${row},'01_Compiled Tests'!$I$2:$I$${lastCompiledRow},C${row},'01_Compiled Tests'!$G$2:$G$${lastCompiledRow},D${row})`,
    `=MAXIFS('01_Compiled Tests'!$AZ$2:$AZ$${lastCompiledRow},'01_Compiled Tests'!$F$2:$F$${lastCompiledRow},B${row},'01_Compiled Tests'!$I$2:$I$${lastCompiledRow},C${row},'01_Compiled Tests'!$G$2:$G$${lastCompiledRow},D${row})`,
  ]];
});
const configEndRow = 16 + configs.length;

support.getRange("A30:D30").values = [["Test", "Date", "Max Eng. Util.", "Target Line"]];
records.forEach((record, index) => {
  const supportRow = 31 + index;
  const compiledRow = 2 + index;
  support.getRange(`A${supportRow}:D${supportRow}`).formulas = [[
    `='01_Compiled Tests'!A${compiledRow}`,
    `='01_Compiled Tests'!D${compiledRow}`,
    `='01_Compiled Tests'!AZ${compiledRow}`,
    "=1",
  ]];
});
support.getRange("A1:G1").format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF" } };
support.getRange("A16:G16").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
support.getRange("A30:C30").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
support.getRange("D2:E7").format.numberFormat = "0%";
support.getRange("G2:G7").format.numberFormat = "0%";
support.getRange(`F17:F${configEndRow}`).format.numberFormat = "dd-mmm-yyyy";
support.getRange(`G17:G${configEndRow}`).format.numberFormat = "0%";
support.getRange(`B31:B${30 + records.length}`).format.numberFormat = "dd-mmm";
support.getRange(`C31:C${30 + records.length}`).format.numberFormat = "0%";
support.getRange("A:G").format.columnWidth = 18;

const dash = workbook.worksheets.add("00_Emission Dashboard");
dash.showGridLines = false;
dash.getRange("A1:P3").merge();
dash.getRange("A1").values = [["EMISSION COMPILATION — PROGRAM READINESS DASHBOARD"]];
dash.getRange("A1:P3").format = {
  fill: "#0B1F33",
  font: { bold: true, color: "#FFFFFF", size: 22 },
  horizontalAlignment: "left",
  verticalAlignment: "center",
};
dash.getRange("A4:P4").merge();
dash.getRange("A4").values = [[`BS6.2 | Engineering-target and statutory-limit surveillance | Refreshed 20-Jun-2026 | ${records.length} compiled tests`]];
dash.getRange("A4:P4").format = {
  fill: "#D9EAF7",
  font: { color: "#17365D", size: 10 },
  verticalAlignment: "center",
};

const cardRanges = ["A6:D9", "E6:H9", "I6:L9", "M6:P9"];
const cardTitles = ["TOTAL TESTS", "ENGINEERING PASS RATE", "STATUTORY PASS RATE", "LATEST TEST"];
const cardFormulas = [
  `=COUNTA('01_Compiled Tests'!$A$2:$A$${lastCompiledRow})`,
  `=COUNTIF('01_Compiled Tests'!$BB$2:$BB$${lastCompiledRow},"PASS")/COUNTA('01_Compiled Tests'!$A$2:$A$${lastCompiledRow})`,
  `=COUNTIF('01_Compiled Tests'!$BC$2:$BC$${lastCompiledRow},"PASS")/COUNTA('01_Compiled Tests'!$A$2:$A$${lastCompiledRow})`,
  `=MAX('01_Compiled Tests'!$D$2:$D$${lastCompiledRow})`,
];
for (let i = 0; i < cardRanges.length; i += 1) {
  const [start, end] = cardRanges[i].split(":");
  dash.getRange(cardRanges[i]).format = {
    fill: i === 1 ? "#E2F0D9" : i === 2 ? "#EAF2F8" : "#F3F6F9",
    borders: { preset: "all", style: "thin", color: "#9FBAD0" },
  };
  const titleCell = start;
  const startRow = Number(start.match(/\d+/)[0]);
  const startCol = start.match(/[A-Z]+/)[0];
  const endCol = end.match(/[A-Z]+/)[0];
  dash.getRange(`${startCol}${startRow}:${endCol}${startRow}`).merge();
  dash.getRange(titleCell).values = [[cardTitles[i]]];
  dash.getRange(titleCell).format = {
    font: { bold: true, color: "#52738F", size: 9 },
    horizontalAlignment: "center",
  };
  dash.getRange(`${startCol}${startRow + 1}:${endCol}${startRow + 3}`).merge();
  dash.getRange(`${startCol}${startRow + 1}`).formulas = [[cardFormulas[i]]];
  dash.getRange(`${startCol}${startRow + 1}`).format = {
    font: { bold: true, color: "#17365D", size: 22 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
}
dash.getRange("E7").format.numberFormat = "0%";
dash.getRange("I7").format.numberFormat = "0%";
dash.getRange("M7").format.numberFormat = "dd-mmm-yyyy";

dash.getRange("A11:H11").merge();
dash.getRange("A11").values = [["POLLUTANT TARGET UTILIZATION"]];
dash.getRange("I11:P11").merge();
dash.getRange("I11").values = [["ENGINEERING TARGET OUTCOME"]];
dash.getRange("A28:H28").merge();
dash.getRange("A28").values = [["TEST-BY-TEST READINESS TREND"]];
dash.getRange("I28:P28").merge();
dash.getRange("I28").values = [["CONFIGURATION RISK — WORST TARGET UTILIZATION"]];
for (const range of ["A11:H11", "I11:P11", "A28:H28", "I28:P28"]) {
  dash.getRange(range).format = {
    fill: "#17365D",
    font: { bold: true, color: "#FFFFFF", size: 11 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
}

const pollutantChart = dash.charts.add("bar", {
  chartType: "bar",
  title: "Average vs Worst Engineering Target Utilization",
  hasLegend: true,
});
pollutantChart.title = "Average vs Worst Engineering Target Utilization";
pollutantChart.hasLegend = true;
const averageSeries = pollutantChart.series.add("Average Util.");
averageSeries.categoryFormula = "'02_Dashboard Data'!$A$2:$A$7";
averageSeries.formula = "'02_Dashboard Data'!$D$2:$D$7";
averageSeries.fill = "#5B9BD5";
const worstSeries = pollutantChart.series.add("Worst Util.");
worstSeries.categoryFormula = "'02_Dashboard Data'!$A$2:$A$7";
worstSeries.formula = "'02_Dashboard Data'!$E$2:$E$7";
worstSeries.fill = "#ED7D31";
pollutantChart.yAxis = { numberFormatCode: "0%", min: 0 };
pollutantChart.setPosition("A12", "H26");

const outcomeChart = dash.charts.add("doughnut", support.getRange("A10:B12"));
outcomeChart.title = "Pass / Fail by Engineering Target";
outcomeChart.hasLegend = true;
outcomeChart.setPosition("I12", "P26");

const trendChart = dash.charts.add("line", {
  chartType: "line",
  title: "Maximum Engineering Target Utilization",
  hasLegend: true,
});
trendChart.title = "Maximum Engineering Target Utilization";
trendChart.hasLegend = true;
const utilizationSeries = trendChart.series.add("Max Target Util.");
utilizationSeries.categoryFormula = `'02_Dashboard Data'!$A$31:$A$${30 + records.length}`;
utilizationSeries.formula = `'02_Dashboard Data'!$C$31:$C$${30 + records.length}`;
utilizationSeries.fill = "#4472C4";
const targetSeries = trendChart.series.add("Engineering Target");
targetSeries.categoryFormula = `'02_Dashboard Data'!$A$31:$A$${30 + records.length}`;
targetSeries.formula = `'02_Dashboard Data'!$D$31:$D$${30 + records.length}`;
targetSeries.fill = "#C00000";
trendChart.yAxis = { numberFormatCode: "0%", min: 0 };
trendChart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 8 } };
trendChart.setPosition("A29", "H43");

const configChart = dash.charts.add("bar", {
  chartType: "bar",
  title: "Worst Result / Engineering Target",
  hasLegend: false,
});
configChart.title = "Worst Result / Engineering Target";
configChart.hasLegend = false;
const configSeries = configChart.series.add("Worst Util.");
configSeries.categoryFormula = `'02_Dashboard Data'!$A$17:$A$${configEndRow}`;
configSeries.formula = `'02_Dashboard Data'!$G$17:$G$${configEndRow}`;
configSeries.fill = "#4472C4";
configChart.yAxis = { numberFormatCode: "0%", min: 0 };
configChart.setPosition("I29", "P43");

dash.getRange("A45:P45").merge();
dash.getRange("A45").values = [["CONFIGURATION READINESS MATRIX"]];
dash.getRange("A45:P45").format = {
  fill: "#17365D",
  font: { bold: true, color: "#FFFFFF", size: 11 },
};
dash.getRange("A46:F46").values = [["Configuration", "Tests", "Latest Test", "Worst Util.", "Readiness", "Action"]];
dash.getRange("A46:F46").format = {
  fill: "#5B9BD5",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};
configs.forEach((config, index) => {
  const dashRow = 47 + index;
  const supportRow = 17 + index;
  dash.getRange(`A${dashRow}:D${dashRow}`).formulas = [[
    `='02_Dashboard Data'!A${supportRow}`,
    `='02_Dashboard Data'!E${supportRow}`,
    `='02_Dashboard Data'!F${supportRow}`,
    `='02_Dashboard Data'!G${supportRow}`,
  ]];
  dash.getRange(`E${dashRow}:F${dashRow}`).formulas = [[
    `=IF(D${dashRow}<=0.8,"ROBUST",IF(D${dashRow}<=1,"WATCH","TARGET MISS"))`,
    `=IF(D${dashRow}<=0.8,"Maintain calibration",IF(D${dashRow}<=1,"Increase confirmation coverage","Root-cause critical pollutant"))`,
  ]];
});
const matrixEndRow = 46 + configs.length;
dash.getRange(`A47:F${matrixEndRow}`).format = {
  fill: "#F8FAFC",
  font: { color: "#263238", size: 9 },
  borders: { preset: "all", style: "thin", color: "#D9E2F3" },
};
dash.getRange(`C47:C${matrixEndRow}`).format.numberFormat = "dd-mmm-yyyy";
dash.getRange(`D47:D${matrixEndRow}`).format.numberFormat = "0%";
dash.getRange(`D47:E${matrixEndRow}`).conditionalFormats.add("colorScale", {
  thresholds: ["min", 1, "max"],
  colors: ["#63BE7B", "#FFEB84", "#F8696B"],
});

dash.getRange(`H45:P${matrixEndRow}`).format = {
  fill: "#F3F6F9",
  borders: { preset: "all", style: "thin", color: "#D9E2F3" },
};
dash.getRange("H46:P46").merge();
dash.getRange("H46").values = [["ENGINEERING INTERPRETATION"]];
dash.getRange("H46:P46").format = {
  fill: "#5B9BD5",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
};
dash.getRange("H47:P47").merge();
dash.getRange("H47").values = [["≤80% target utilization: robust margin | 80–100%: watch zone | >100%: target miss"]];
dash.getRange("H48:P48").merge();
dash.getRange("H48").formulas = [[`="Critical pollutant now: "&INDEX('01_Compiled Tests'!$BA$2:$BA$${lastCompiledRow},MATCH(MAX('01_Compiled Tests'!$AZ$2:$AZ$${lastCompiledRow}),'01_Compiled Tests'!$AZ$2:$AZ$${lastCompiledRow},0))`]];
dash.getRange("H49:P49").merge();
dash.getRange("H49").formulas = [[`="Data-quality checks open: "&COUNTIF('01_Compiled Tests'!$BD$2:$BD$${lastCompiledRow},"CHECK")`]];
dash.getRange("H50:P50").merge();
dash.getRange("H50").values = [["Use the compiled table for traceability to source tab, catalyst state, dataset, DCM change, RLD, ODO and location link."]];
dash.getRange("H47:P50").format = {
  font: { color: "#263238", size: 9 },
  wrapText: true,
  verticalAlignment: "center",
};

dash.getRange("A:P").format.columnWidth = 11;
dash.getRange("A:A").format.columnWidth = 24;
dash.getRange("B:F").format.columnWidth = 15;
dash.getRange("H:P").format.columnWidth = 12;
dash.getRange("1:1").format.rowHeight = 28;
dash.getRange("2:3").format.rowHeight = 18;
dash.getRange("4:4").format.rowHeight = 22;
dash.getRange("6:9").format.rowHeight = 22;
dash.getRange("11:11").format.rowHeight = 24;
dash.getRange("28:28").format.rowHeight = 24;
dash.getRange("45:45").format.rowHeight = 24;
dash.freezePanes.freezeRows(4);

await fs.mkdir(outputDir, { recursive: true });

const keyInspect = await workbook.inspect({
  kind: "table",
  range: "'00_Emission Dashboard'!A1:P52",
  include: "values,formulas",
  tableMaxRows: 52,
  tableMaxCols: 16,
  summary: "Emission dashboard verification",
});
await fs.writeFile(`${outputDir}/dashboard-check.ndjson`, keyInspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "Final formula error scan",
});
await fs.writeFile(`${outputDir}/formula-errors.ndjson`, errors.ndjson);

const preview = await workbook.render({
  sheetName: "00_Emission Dashboard",
  range: `A1:P${Math.max(matrixEndRow, 52)}`,
  scale: 1.2,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, previewPath, records: records.length, configs: configs.length }));
