import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getVerifiedUser } from "@/lib/auth/guards";

export default async function LoginPage() {
  if (await getVerifiedUser()) {
    redirect("/extractions");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-100 px-5 py-12" id="main-content" tabIndex={-1}>
      <div className="absolute inset-x-0 top-0 h-56 bg-zinc-950" />
      <section className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-950/10">
        <div className="mb-8">
          <div aria-hidden="true" className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 text-sm font-bold text-white" translate="no">
            EX
          </div>
          <p className="text-sm font-medium text-zinc-500">Portal interno</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">Extracciones</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            Accede con las credenciales de tu cuenta corporativa.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
