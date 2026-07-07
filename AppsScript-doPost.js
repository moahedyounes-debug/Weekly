function doPost(e) {
  const p = e.parameter || {};
  const ss = SpreadsheetApp.openById("1vcYIUCE4pJpfN1149CNKpa8XXpLIRzapaISBW1GUMNg");
  const sh = ss.getSheetByName(p.sheet) || ss.getSheets()[0];
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

  const norm = value => String(value == null ? "" : value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^—$|^-$/g, "");

  const formatOpenTimeMdd = value => {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    let m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return String(Number(m[2])) + String(m[3]).padStart(2, "0");
    m = raw.match(/^(\d{1,2})[-\/](\d{1,2})(?:[-\/]\d{2,4})?$/);
    if (m) return String(Number(m[1])) + String(m[2]).padStart(2, "0");
    const compact = raw.replace(/\D/g, "");
    if (/^\d{8}$/.test(compact)) return String(Number(compact.slice(4, 6))) + compact.slice(6, 8);
    if (/^\d{4}$/.test(compact)) return String(Number(compact.slice(0, 2))) + compact.slice(2, 4);
    if (/^\d{3}$/.test(compact)) return compact;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return String(d.getMonth() + 1) + String(d.getDate()).padStart(2, "0");
    return raw;
  };

  const findCol = name => {
    const target = norm(name).replace(/[^a-z0-9 ]/g, "");
    for (let i = 0; i < headers.length; i++) {
      const header = norm(headers[i]).replace(/[^a-z0-9 ]/g, "");
      if (header === target) return i + 1;
    }
    return 0;
  };

  const valueByHeader = (rowValues, name) => {
    const col = findCol(name);
    return col ? rowValues[col - 1] : "";
  };

  const makeKey = rowValues => [
    norm(formatOpenTimeMdd(valueByHeader(rowValues, "Open Time"))),
    norm(valueByHeader(rowValues, "Module")),
    norm(valueByHeader(rowValues, "Question")),
    norm(valueByHeader(rowValues, "PIC")),
    norm(valueByHeader(rowValues, "Management Action")),
    norm(valueByHeader(rowValues, "Completion Time")),
    norm(valueByHeader(rowValues, "Source Week"))
  ].join("||");

  if (p.action === "append") {
    const newRow = headers.map(header => {
      if (p[header] != null) return p[header];
      const normalizedHeader = norm(header).replace(/[^a-z0-9 ]/g, "");
      for (const key in p) {
        if (norm(key).replace(/[^a-z0-9 ]/g, "") === normalizedHeader) return p[key];
      }
      return "";
    });
    sh.appendRow(newRow);
    return ContentService.createTextOutput("ok append");
  }

  const targetCol = findCol(p.field);
  if (!targetCol) {
    return ContentService.createTextOutput("bad field: " + p.field + " | headers: " + headers.join("|") );
  }

  let targetRow = 0;
  // Use display values so dates/numbers match the CSV-formatted values the dashboard sends.
  const data = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues() : [];

  const requestedRow = Number(p.rowNumber || 0);
  if (requestedRow >= 2 && requestedRow <= lastRow) {
    targetRow = requestedRow;
  }

  if (!targetRow && p.rowKey) {
    const wantedIndex = Number(p.rowKeyIndex || 0);
    let seen = 0;
    for (let i = 0; i < data.length; i++) {
      if (makeKey(data[i]) === p.rowKey) {
        if (seen === wantedIndex) {
          targetRow = i + 2;
          break;
        }
        seen++;
      }
    }
  }

  if (!targetRow) {
    const expected = {
      "Open Time": p.matchOpenTime,
      "Module": p.matchModule,
      "Question": p.matchQuestion,
      "PIC": p.matchPIC,
      "Management Action": p.matchAction,
      "Completion Time": p.matchCompletionTime,
      "Source Week": p.matchSourceWeek
    };
    for (let i = 0; i < data.length; i++) {
      const ok = Object.keys(expected).every(header => {
        const expectedValue = expected[header];
        return expectedValue == null || expectedValue === "" || norm(valueByHeader(data[i], header)) === norm(expectedValue);
      });
      if (ok) {
        targetRow = i + 2;
        break;
      }
    }
  }

  if (!targetRow) {
    return ContentService.createTextOutput("row not found for key: " + (p.rowKey || "no key"));
  }

  sh.getRange(targetRow, targetCol).setValue(p.value);

  // Auto strikethrough whenever Status becomes Done OR Done? checkbox is TRUE.
  const fieldNorm = norm(p.field).replace(/[^a-z0-9 ]/g, "");
  const valNorm = norm(p.value);
  let shouldStrike = null;
  if (fieldNorm === "status") shouldStrike = (valNorm === "done");
  if (fieldNorm.indexOf("done") === 0) shouldStrike = (valNorm === "true" || valNorm === "yes" || valNorm === "1");
  if (shouldStrike !== null) {
    const rowRange = sh.getRange(targetRow, 1, 1, lastCol);
    rowRange.setFontLine(shouldStrike ? "line-through" : "none");
    // Keep Status & Done? in sync as well
    const statusCol = findCol("Status");
    const doneCol = findCol("Done? (\u2713)") || findCol("Done?") || findCol("Done");
    if (shouldStrike) {
      if (statusCol) sh.getRange(targetRow, statusCol).setValue("Done");
      if (doneCol) sh.getRange(targetRow, doneCol).setValue(true);
    } else if (fieldNorm.indexOf("done") === 0) {
      // unchecking Done resets status to In process if it was Done
      if (statusCol && norm(sh.getRange(targetRow, statusCol).getValue()) === "done") {
        sh.getRange(targetRow, statusCol).setValue("In process");
      }
    }
  }

  return ContentService.createTextOutput("ok row=" + targetRow + " col=" + targetCol);
}