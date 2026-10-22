import { buildSyncPlan, runUserSync } from "@/lib/users/sync-service";
async function main() { const plan = await buildSyncPlan(); console.log(`Usuarios a crear: ${plan.toCreate.length}`); if (!process.argv.includes("--apply")) { console.log("[dry-run] No se ha modificado nada."); return; } console.log(await runUserSync()); }
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
