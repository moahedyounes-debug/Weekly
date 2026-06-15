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
    valueByHeader(rowValues, "Open Time"),
    valueByHeader(rowValues, "Module"),
    valueByHeader(rowValues, "Question"),
    valueByHeader(rowValues, "PIC"),
    valueByHeader(rowValues, "Management Action"),
    valueByHeader(rowValues, "Completion Time"),
    valueByHeader(rowValues, "Source Week")
  ].map(norm).join("||");

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
  const data = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  if (p.rowKey) {
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
  return ContentService.createTextOutput("ok row=" + targetRow + " col=" + targetCol);
}