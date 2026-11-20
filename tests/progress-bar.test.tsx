import { renderToString } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressBar } from "@/components/ui/progress-bar";

afterEach(cleanup);

describe("ProgressBar", () => {
  it("renders no inline style attribute in the server HTML so the production CSP cannot block it", () => {
    const html = renderToString(<ProgressBar label="Progreso" value={45} />);
    expect(html).not.toContain("style=");
    expect(html).toContain('aria-valuenow="45"');
  });

  it("sets the fill through the CSSOM after mounting", () => {
    render(<ProgressBar label="Progreso" value={45} />);
    expect(screen.getByRole("progressbar", { name: "Progreso" }).firstElementChild).toHaveStyle({ transform: "scaleX(0.45)" });
  });

  it("clamps values outside 0 to 100", () => {
    const { rerender } = render(<ProgressBar label="Progreso" value={140} />);
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ transform: "scaleX(1)" });
    rerender(<ProgressBar label="Progreso" value={-5} />);
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ transform: "scaleX(0)" });
  });
});

describe("ProgressBar fill classes", () => {
  it("starts collapsed with the transform property, never the independent scale property", async () => {
    const { compile } = await import("tailwindcss");
    const html = renderToString(<ProgressBar label="Progreso" value={45} />);
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/)).filter(Boolean);
    const css = (await compile("@tailwind utilities;")).build(classes);
    expect(css).toContain("transform: scaleX(0)");
    expect(css).not.toMatch(/\sscale:\s/);
  });
});
