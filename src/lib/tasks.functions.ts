import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SHEET_ID = "1vcYIUCE4pJpfN1149CNKpa8XXpLIRzapaISBW1GUMNg";
const RANGE = "Sheet1!A2:L";
const SHEET_NAME = "Sheet1";
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const HEADERS = ["Open Time", "Module", "Question", "PIC", "Management Action", "Completion Time", "Status", "Remarks", "Description", "New Tasks", "Source Week", "Done? (✓)"] as const;

export type SheetTask = {
  openTime: string | null;
  module: string | null;
  question: string | null;
  pic: string | null;
  action: string | null;
  completionTime: string | null;
  status: string | null;
  remarks: string | null;
  description: string | null;
  newTasks: string | null;
  sourceWeek: string | null;
  done: boolean;
};

const updateTaskInput = z.object({
  rowKey: z.string().min(1),
  rowKeyIndex: z.number().int().nonnegative().default(0),
  field: z.enum(["Status", "Remarks", "Done? (✓)"]),
  value: z.string(),
});

function normalizeCell(value: unknown) {
  const normalized = String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "—" || normalized === "-" ? "" : normalized;
}

function taskKeyFromRow(row: string[]) {
  return [row[0], row[1], row[2], row[3], row[4], row[5], row[10]].map(normalizeCell).join("||");
}

function columnLetter(index: number) {
  let letter = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

async function getSheetRows() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const sheetsKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovableKey || !sheetsKey) throw new Error("Missing connector secrets");

  const url = `${GATEWAY}/spreadsheets/${SHEET_ID}/values/${RANGE}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": sheetsKey,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets gateway ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

export const fetchTasksFromSheet = createServerFn({ method: "GET" }).handler(
  async (): Promise<SheetTask[]> => {
    const rows = await getSheetRows();
    return rows
      .filter((r) => r.some((c) => (c ?? "").trim() !== ""))
      .map((r) => ({
        openTime: r[0] || null,
        module: r[1] || null,
        question: r[2] || null,
        pic: r[3] || null,
        action: r[4] || null,
        completionTime: r[5] || null,
        status: r[6] || null,
        remarks: r[7] || null,
        description: r[8] || null,
        newTasks: r[9] || null,
        sourceWeek: r[10] || null,
        done: (r[11] || "").toUpperCase() === "TRUE" || (r[6] || "").toLowerCase() === "done",
      }));
  }
);

export const updateTaskInSheet = createServerFn({ method: "POST" })
  .inputValidator((data) => updateTaskInput.parse(data))
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const sheetsKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!lovableKey || !sheetsKey) throw new Error("Missing connector secrets");

    const rows = await getSheetRows();
    let seen = 0;
    let rowNumber = 0;
    for (let i = 0; i < rows.length; i++) {
      if (taskKeyFromRow(rows[i]) === data.rowKey) {
        if (seen === data.rowKeyIndex) {
          rowNumber = i + 2;
          break;
        }
        seen += 1;
      }
    }

    if (!rowNumber) throw new Error("Task row not found in sheet");

    const colIndex = HEADERS.indexOf(data.field) + 1;
    if (!colIndex) throw new Error(`Unknown field: ${data.field}`);

    const cellRange = `${SHEET_NAME}!${columnLetter(colIndex)}${rowNumber}`;
    const url = `${GATEWAY}/spreadsheets/${SHEET_ID}/values/${cellRange}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": sheetsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ range: cellRange, majorDimension: "ROWS", values: [[data.value]] }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sheets update ${res.status}: ${body}`);
    }

    return { ok: true, rowNumber, field: data.field };
  });

const strikethroughInput = z.object({
  rowKey: z.string().min(1),
  rowKeyIndex: z.number().int().nonnegative().default(0),
  strikethrough: z.boolean(),
});

// "Sheet1" is the first/default sheet (gid=0). Hardcoding avoids hitting the
// Sheets metadata read quota on every strikethrough call (which caused 429s).
let cachedSheetId: number = 0;
async function getSheetIdByName(_lovableKey: string, _sheetsKey: string, _name: string) {
  return cachedSheetId;
}

export const setRowStrikethroughInSheet = createServerFn({ method: "POST" })
  .inputValidator((data) => strikethroughInput.parse(data))
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const sheetsKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!lovableKey || !sheetsKey) throw new Error("Missing connector secrets");

    const rows = await getSheetRows();
    let seen = 0;
    let rowNumber = 0;
    for (let i = 0; i < rows.length; i++) {
      if (taskKeyFromRow(rows[i]) === data.rowKey) {
        if (seen === data.rowKeyIndex) {
          rowNumber = i + 2;
          break;
        }
        seen += 1;
      }
    }
    if (!rowNumber) throw new Error("Task row not found in sheet");

    const sheetId = await getSheetIdByName(lovableKey, sheetsKey, SHEET_NAME);

    const url = `${GATEWAY}/spreadsheets/${SHEET_ID}:batchUpdate`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": sheetsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: rowNumber - 1,
                endRowIndex: rowNumber,
                startColumnIndex: 0,
                endColumnIndex: HEADERS.length,
              },
              cell: { userEnteredFormat: { textFormat: { strikethrough: data.strikethrough } } },
              fields: "userEnteredFormat.textFormat.strikethrough",
            },
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Sheets format ${res.status}: ${await res.text()}`);

    return { ok: true, rowNumber, strikethrough: data.strikethrough };
  });
