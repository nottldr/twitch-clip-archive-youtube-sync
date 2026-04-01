import { z } from "zod/v4";

export const SyncModeSchema = z.enum(["auto", "manual"]);
export type SyncMode = z.infer<typeof SyncModeSchema>;
