import packageJson from "@/package.json";

export function AppFooter() {
  return (
    <footer className="border-t border-line-soft bg-surface px-6 py-4 text-center text-meta text-ink-muted">
      Extracciones · v{packageJson.version}
    </footer>
  );
}
