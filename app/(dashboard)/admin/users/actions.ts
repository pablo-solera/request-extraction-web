"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { runUserSync } from "@/lib/users/sync-service";

export async function syncUsersAction() {
  await requireAdmin();
  const result = await runUserSync();
  revalidatePath("/admin/users");
  return result;
}
