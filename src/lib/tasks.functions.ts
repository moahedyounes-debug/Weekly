import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SHEET_ID = "1vcYIUCE4pJpfN1149CNKpa8XXpLIRzapaISBW1GUMNg";
const RANGE = "Sheet1!A2:L";
const SHEET_NAME = "Sheet1";
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const HEADERS = ["Open Time", "Module", "Question", "PIC", "Management Action", "Completion Time", "Status", "Remarks", "Description", "New Tasks", "Source Week", "Done? (✓)"] as const;

export type SheetTask = {
  rowNumber: number;
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
  rowNumber: z.number().int().min(2).optional(),
  rowKey: z.string().min(1).optional(),
  rowKeyIndex: z.number().int().nonnegative().default(0),
  field: z.enum(["Status", "Remarks", "Done? (✓)"]),
  value: z.string(),
});

function formatOpenTimeMdd(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${Number(iso[2])}${iso[3].padStart(2, "0")}`;

  const slash = raw.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/]\d{2,4})?$/);
  if (slash) return `${Number(slash[1])}${slash[2].padStart(2, "0")}`;

  const compact = raw.replace(/\D/g, "");
  if (/^\d{8}$/.test(compact)) return `${Number(compact.slice(4, 6))}${compact.slice(6, 8)}`;
  if (/^\d{4}$/.test(compact)) return `${Number(compact.slice(0, 2))}${compact.slice(2, 4)}`;
  if (/^\d{3}$/.test(compact)) return compact;

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return `${date.getMonth() + 1}${String(date.getDate()).padStart(2, "0")}`;

  return raw;
}

function normalizeCell(value: unknown) {
  const normalized = String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return normalized === "—" || normalized === "-" ? "" : normalized;
}

function taskKeyFromRow(row: string[]) {
  return [formatOpenTimeMdd(row[0]), row[1], row[2], row[3], row[4], row[5], row[10]].map(normalizeCell).join("||");
}

function findRowNumberByKey(rows: string[][], rowKey?: string, rowKeyIndex = 0) {
  if (!rowKey) return 0;

  let seen = 0;
  for (let i = 0; i < rows.length; i++) {
    if (taskKeyFromRow(rows[i]) === rowKey) {
      if (seen === rowKeyIndex) return i + 2;
      seen += 1;
    }
  }

  return 0;
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
    try {
      const rows = await getSheetRows();
      return rows
        .map((r, index) => ({ row: r, rowNumber: index + 2 }))
        .filter(({ row }) => row.some((c) => (c ?? "").trim() !== ""))
        .map(({ row: r, rowNumber }) => ({
          rowNumber,
          openTime: formatOpenTimeMdd(r[0]),
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
    } catch (error) {
      console.error("Unable to load Google Sheet rows; rendering empty dashboard fallback:", error);
      return [];
    }
  }
);

export const updateTaskInSheet = createServerFn({ method: "POST" })
  .inputValidator((data) => updateTaskInput.parse(data))
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const sheetsKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!lovableKey || !sheetsKey) throw new Error("Missing connector secrets");

    const rowNumber = data.rowNumber ?? findRowNumberByKey(await getSheetRows(), data.rowKey, data.rowKeyIndex);

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
  rowNumber: z.number().int().min(2).optional(),
  rowKey: z.string().min(1).optional(),
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

    const rowNumber = data.rowNumber ?? findRowNumberByKey(await getSheetRows(), data.rowKey, data.rowKeyIndex);
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
