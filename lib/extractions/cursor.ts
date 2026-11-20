import { z } from "zod";

export const requestCursorSchema = z.object({
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/),
  requestGroupId: z.uuid(),
});
