function PageHeaderRoot({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function PageHeaderTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="font-serif text-display font-medium text-zinc-950">{children}</h1>;
}

function PageHeaderDescription({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 max-w-2xl text-body text-zinc-600">{children}</p>;
}

export const PageHeader = Object.assign(PageHeaderRoot, {
  Description: PageHeaderDescription,
  Title: PageHeaderTitle,
});
