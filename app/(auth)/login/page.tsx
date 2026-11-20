import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getVerifiedUser } from "@/lib/auth/guards";

export default async function LoginPage() {
  if (await getVerifiedUser()) {
    redirect("/extractions");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5 py-12" id="main-content" tabIndex={-1}>
      <section className="w-full max-w-md rounded-xl border border-line-soft bg-surface p-8">
        <div className="mb-8">
          <div aria-hidden="true" className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 text-sm font-bold text-white" translate="no">
            EX
          </div>
          <p className="text-sm font-medium text-zinc-500">Portal interno</p>
          <h1 className="mt-1 font-serif text-display font-medium text-zinc-950">Extracciones</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            Accede con las credenciales de tu cuenta corporativa.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
