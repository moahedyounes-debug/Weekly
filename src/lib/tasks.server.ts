import bundledTasks from "../data/tasks.json";

const SHEET_ID = "1vcYIUCE4pJpfN1149CNKpa8XXpLIRzapaISBW1GUMNg";
const RANGE = "Sheet1!A1:N";
const SHEET_NAME = "Sheet1";
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const HEADERS = ["Opening Date", "Country", "Module", "Question", "PIC", "Management Action", "Dead Line time", "Completion Time", "Status", "Remarks", "Description", "New Tasks", "Source Week", "Done? (✓)"] as const;

const HEADER_ALIASES: Record<string, string> = {
  "open time": "openTime", "opening date": "openTime", "opening time": "openTime", "date": "openTime",
  "module": "module",
  "question": "question", "issue": "question",
  "pic": "pic", "owner": "pic",
  "management action": "action", "action": "action",
  "completion time": "completionTime", "completion date": "completionTime",
  "dead line time": "deadline", "deadline time": "deadline", "dead line": "deadline", "deadline": "deadline", "due": "deadline",
  "status": "status",
  "remarks": "remarks", "remark": "remarks",
  "description": "description",
  "new tasks": "newTasks", "new task": "newTasks",
  "source week": "sourceWeek", "week": "sourceWeek",
  "done? (✓)": "done", "done": "done", "done?": "done", "done (✓)": "done",
  "country": "country",
};

const FIELD_TO_COLUMN_INDEX: Record<EditableTaskField, number> = {
  Status: 8,
  Remarks: 9,
  "Done? (✓)": 13,
  Question: 3,
  "Management Action": 5,
};

export type EditableTaskField = "Status" | "Remarks" | "Done? (✓)" | "Question" | "Management Action";

export type SheetTask = {
  rowNumber: number;
  openTime: string | null;
  module: string | null;
  question: string | null;
  pic: string | null;
  action: string | null;
  completionTime: string | null;
  deadline: string | null;
  status: string | null;
  remarks: string | null;
  description: string | null;
  newTasks: string | null;
  sourceWeek: string | null;
  done: boolean;
  country: string | null;
};

export type UpdateTaskInput = {
  rowNumber?: number;
  rowKey?: string;
  rowKeyIndex?: number;
  field: EditableTaskField;
  value: string;
};

export type StrikethroughInput = {
  rowNumber?: number;
  rowKey?: string;
  rowKeyIndex?: number;
  strikethrough: boolean;
};

export type AppendTaskInput = {
  openTime?: string;
  country?: string;
  module?: string;
  question?: string;
  pic?: string;
  action?: string;
  deadline?: string;
  completionTime?: string;
  status?: string;
  remarks?: string;
  sourceWeek?: string;
};

let cachedTasks: SheetTask[] | null = null;
let cachedAt = 0;
const SHEET_CACHE_MS = 5 * 60 * 1000;

type BundledTask = Partial<Omit<SheetTask, "rowNumber" | "done">> & { done?: boolean | string | null };

function asCell(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function fallbackTasksFromBundle(): SheetTask[] {
  return (bundledTasks as BundledTask[]).map((task) => {
    const status = asCell(task.status);
    const doneRaw = task.done;
    const done =
      doneRaw === true ||
      String(doneRaw ?? "").toUpperCase() === "TRUE" ||
      String(status ?? "").toLowerCase() === "done";

    return {
      rowNumber: 0,
      openTime: formatOpenTimeMdd(task.openTime),
      module: asCell(task.module),
      question: asCell(task.question),
      pic: asCell(task.pic),
      action: asCell(task.action),
      completionTime: asCell(task.completionTime),
      deadline: asCell(task.deadline),
      status,
      remarks: asCell(task.remarks),
      description: asCell(task.description),
      newTasks: asCell(task.newTasks),
      sourceWeek: asCell(task.sourceWeek),
      done,
      country: asCell(task.country),
    };
  });
}

const DEFECTIVE_INSPECTION_TASK: Omit<SheetTask, "rowNumber"> = {
  openTime: "503",
  country: "KSA",
  module: "Qulity",
  question: "Defective parts",
  pic: "Ahad",
  action: "Complete Onsite Defective Inspection activity -555",
  deadline: "Monthly",
  completionTime: "Monthly",
  status: "Done",
  remarks: "5 Sets Plan / 5 Sets Completed.",
  description: "Waiting for 2 PCB ,parts returned which consumed during month of May.",
  newTasks: "2 parts on the way 24-May",
  sourceWeek: "W23",
  done: true,
};

function isDefectiveInspectionTask(task: SheetTask) {
  return (
    normalizeCell(task.openTime) === "503" &&
    normalizeCell(task.module) === "qulity" &&
    normalizeCell(task.question) === "defective parts" &&
    normalizeCell(task.pic) === "ahad"
  );
}

function ensureDefectiveInspectionTask(tasks: SheetTask[]): SheetTask[] {
  const existingIndex = tasks.findIndex(isDefectiveInspectionTask);
  if (existingIndex >= 0) {
    // Row exists in sheet — return as-is so edits round-trip correctly.
    return tasks;
  }

  return [{ rowNumber: 0, ...DEFECTIVE_INSPECTION_TASK }, ...tasks];
}


function buildColumnMap(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const key = String(h ?? "").trim().toLowerCase();
    const field = HEADER_ALIASES[key];
    if (field && map[field] === undefined) map[field] = i;
  });

  // Keep the dashboard aligned with the live sheet's physical A-N layout.
  const fallback: Record<string, number> = {
    openTime: 0,
    country: 1,
    module: 2,
    question: 3,
    pic: 4,
    action: 5,
    deadline: 6,
    completionTime: 7,
    status: 8,
    remarks: 9,
    description: 10,
    newTasks: 11,
    sourceWeek: 12,
    done: 13,
  };

  for (const [field, index] of Object.entries(fallback)) {
    map[field] = index;
  }

  return map;
}

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

function taskKeyFromRow(row: string[], colMap: Record<string, number>) {
  const get = (field: string) => row[colMap[field] ?? -1] ?? "";
  return [formatOpenTimeMdd(get("openTime")), get("module"), get("question"), get("pic"), get("action"), get("completionTime"), get("sourceWeek")]
    .map(normalizeCell)
    .join("||");
}

function findRowNumberByKey(rows: string[][], colMap: Record<string, number>, rowKey?: string, rowKeyIndex = 0) {
  if (!rowKey) return 0;

  let seen = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (taskKeyFromRow(rows[i], colMap) === rowKey) {
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

function connectorHeaders() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const sheetsKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovableKey || !sheetsKey) throw new Error("Missing connector secrets");

  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": sheetsKey,
  };
}

async function fetchRange(range: string): Promise<string[][]> {
  const res = await fetch(`${GATEWAY}/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: connectorHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets gateway ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

async function getSheetData() {
  const all = await fetchRange(RANGE);
  const headerRow = all[0] ?? [];
  const dataRows = all.slice(1);
  const colMap = buildColumnMap(headerRow);
  return { dataRows, colMap };
}

async function resolveRowNumber(rowNumber?: number, rowKey?: string, rowKeyIndex = 0) {
  if (rowNumber) return rowNumber;

  const { dataRows, colMap } = await getSheetData();
  const resolved = findRowNumberByKey(dataRows, colMap, rowKey, rowKeyIndex);
  if (!resolved) throw new Error("Task row not found in sheet");
  return resolved;
}

function rowsToTasks(dataRows: string[][], colMap: Record<string, number>): SheetTask[] {
  const get = (row: string[], field: string) => {
    const idx = colMap[field];
    if (idx === undefined) return null;
    const value = row[idx];
    return value && String(value).trim() !== "" ? value : null;
  };

  return dataRows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => (cell ?? "").trim() !== ""))
    .map(({ row, rowNumber }) => {
      const status = get(row, "status");
      let sourceWeek = get(row, "sourceWeek");
      let doneRaw = get(row, "done") ?? "";
      const looksBoolean = (value: string | null) => /^(true|false)$/i.test(String(value ?? "").trim());

      // If headers are edited/shifted in the sheet, recover the known Wxx/TRUE/FALSE layout.
      if (looksBoolean(sourceWeek) && !looksBoolean(doneRaw)) {
        sourceWeek = row[11] || null;
        doneRaw = row[12] || doneRaw;
      }

      return {
        rowNumber,
        openTime: formatOpenTimeMdd(get(row, "openTime")),
        module: get(row, "module"),
        question: get(row, "question"),
        pic: get(row, "pic"),
        action: get(row, "action"),
        completionTime: get(row, "completionTime"),
        deadline: get(row, "deadline"),
        status,
        remarks: get(row, "remarks"),
        description: get(row, "description"),
        newTasks: get(row, "newTasks"),
        sourceWeek,
        done: String(doneRaw).toUpperCase() === "TRUE" || String(status ?? "").toLowerCase() === "done",
        country: get(row, "country"),
      };
    });
}

export async function fetchTasksFromSheetServer(options: { forceRefresh?: boolean } = {}): Promise<SheetTask[]> {
  const now = Date.now();
  if (!options.forceRefresh && cachedTasks && now - cachedAt < SHEET_CACHE_MS) return cachedTasks;

  try {
    const { dataRows, colMap } = await getSheetData();
    const tasks = ensureDefectiveInspectionTask(rowsToTasks(dataRows, colMap));
    if (tasks.length) {
      cachedTasks = tasks;
      cachedAt = now;
    }
    return tasks;
  } catch (error) {
    console.error("Unable to refresh Google Sheet rows; using cached or bundled tasks:", error);
    return cachedTasks?.length ? cachedTasks : fallbackTasksFromBundle();
  }
}

export async function updateTaskInSheetServer(data: UpdateTaskInput) {
  const rowNumber = await resolveRowNumber(data.rowNumber, data.rowKey, data.rowKeyIndex);
  let colIdx = FIELD_TO_COLUMN_INDEX[data.field];

  if (colIdx === undefined) {
    const { colMap } = await getSheetData();
    const fieldToKey: Record<EditableTaskField, string> = {
      Status: "status",
      Remarks: "remarks",
      "Done? (✓)": "done",
      Question: "question",
      "Management Action": "action",
    };
    colIdx = colMap[fieldToKey[data.field]];
  }

  if (colIdx === undefined) throw new Error(`Unknown field: ${data.field}`);

  const cellRange = `${SHEET_NAME}!${columnLetter(colIdx + 1)}${rowNumber}`;
  const res = await fetch(`${GATEWAY}/spreadsheets/${SHEET_ID}/values/${cellRange}?valueInputOption=USER_ENTERED&includeValuesInResponse=true`, {
    method: "PUT",
    headers: {
      ...connectorHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ range: cellRange, majorDimension: "ROWS", values: [[data.value]] }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets update ${res.status}: ${body}`);
  }

  const json = (await res.json()) as {
    updatedRange?: string;
    updatedData?: { values?: string[][] };
  };

  cachedTasks = null;
  cachedAt = 0;

  return {
    ok: true,
    rowNumber,
    field: data.field,
    updatedRange: json.updatedRange ?? cellRange,
    updatedValue: json.updatedData?.values?.[0]?.[0] ?? data.value,
  };
}

export async function setRowStrikethroughInSheetServer(data: StrikethroughInput) {
  const rowNumber = await resolveRowNumber(data.rowNumber, data.rowKey, data.rowKeyIndex);
  const res = await fetch(`${GATEWAY}/spreadsheets/${SHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: {
      ...connectorHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: 0,
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

  cachedTasks = null;
  cachedAt = 0;

  return { ok: true, rowNumber, strikethrough: data.strikethrough };
}