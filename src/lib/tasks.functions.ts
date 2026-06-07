import { createServerFn } from "@tanstack/react-start";

const SHEET_ID = "1vcYIUCE4pJpfN1149CNKpa8XXpLIRzapaISBW1GUMNg";
const RANGE = "Sheet1!A2:L";
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

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

export const fetchTasksFromSheet = createServerFn({ method: "GET" }).handler(
  async (): Promise<SheetTask[]> => {
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
    const rows = json.values ?? [];
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
