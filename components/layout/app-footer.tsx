import packageJson from "@/package.json";

export function AppFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white px-6 py-4 text-center text-meta text-zinc-500">
      Extracciones · v{packageJson.version}
    </footer>
  );
}
