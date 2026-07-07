import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchTasksFromSheetServer,
  setRowStrikethroughInSheetServer,
  updateTaskInSheetServer,
  type SheetTask,
} from "./tasks.server";

export type { SheetTask } from "./tasks.server";

const updateTaskInput = z.object({
  rowNumber: z.number().int().min(2).optional(),
  rowKey: z.string().min(1).optional(),
  rowKeyIndex: z.number().int().nonnegative().default(0),
  field: z.enum(["Status", "Remarks", "Done? (✓)", "Question", "Management Action"]),
  value: z.string(),
});

const fetchTasksInput = z
  .object({
    forceRefresh: z.boolean().optional(),
  })
  .optional();

export const fetchTasksFromSheet = createServerFn({ method: "POST" })
  .inputValidator((data) => fetchTasksInput.parse(data))
  .handler(async ({ data }): Promise<SheetTask[]> => {
    try {
      return await fetchTasksFromSheetServer({ forceRefresh: Boolean(data?.forceRefresh) });
    } catch (error) {
      console.error("Unable to load Google Sheet rows; rendering empty dashboard fallback:", error);
      return [];
    }
  });


export const updateTaskInSheet = createServerFn({ method: "POST" })
  .inputValidator((data) => updateTaskInput.parse(data))
  .handler(async ({ data }) => {
    return updateTaskInSheetServer(data);
  });

const strikethroughInput = z.object({
  rowNumber: z.number().int().min(2).optional(),
  rowKey: z.string().min(1).optional(),
  rowKeyIndex: z.number().int().nonnegative().default(0),
  strikethrough: z.boolean(),
});

export const setRowStrikethroughInSheet = createServerFn({ method: "POST" })
  .inputValidator((data) => strikethroughInput.parse(data))
  .handler(async ({ data }) => {
    return setRowStrikethroughInSheetServer(data);
  });
