import { seedTestAccountUsers } from "@/lib/users/sync-service";

// Run by db:deploy after the migrations. Needs only DATABASE_URL and the TEST_ACCOUNT* settings, not Oracle.
seedTestAccountUsers()
  .then((result) => {
    console.log(result.enabled ? `Usuarios de prueba creados: ${result.created}` : "Cuentas de prueba desactivadas (TEST_ACCOUNTS_ENABLED); no se crea ningún usuario.");
    process.exit(0);
  })
  .catch((error) => { console.error(error); process.exit(1); });
