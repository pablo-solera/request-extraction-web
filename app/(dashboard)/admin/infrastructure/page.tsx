import type { Metadata } from "next";
import { InfrastructureRefresh } from "@/components/admin/infrastructure-refresh";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/page-header";
import { formatSpanishTime } from "@/lib/date-format";
import { requireAdmin } from "@/lib/auth/guards";
import { getInfrastructureStatus, type InfrastructureProbe, type InfrastructureStatus, type ManufacturerInfrastructure } from "@/lib/infrastructure/probe";

export const metadata: Metadata = { title: "Infraestructura" };

const labels: Record<InfrastructureStatus, string> = {
  ready: "Listo",
  "not-ready": "No listo",
  running: "En marcha · readiness desconocido",
  down: "Caído",
  unexpected: "Respuesta inesperada",
  unconfigured: "Sin configurar",
};

const statusTones: Record<InfrastructureStatus, BadgeTone> = {
  ready: "success",
  "not-ready": "pending",
  running: "info",
  down: "danger",
  unexpected: "issue",
  unconfigured: "neutral",
};

function ServicePanel({ service }: { service: InfrastructureProbe }) {
  const checkedAt = formatSpanishTime(service.checkedAt);

  return <div className="rounded-xl border border-line-soft bg-surface-sunken p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-meta font-semibold uppercase tracking-wide text-ink-muted">{service.kind === "reader" ? "Reader" : "Transformer"}</p><h3 className="mt-1 text-body font-semibold text-ink-strong">{service.name}</h3></div><Badge tone={statusTones[service.status]}>{labels[service.status]}</Badge></div><dl className="mt-4 grid grid-cols-3 gap-4 text-body"><div className="min-w-0"><dt className="text-meta font-medium uppercase tracking-wide text-ink-muted">Endpoint</dt><dd className="mt-1 break-all font-mono text-ink-secondary">{service.origin ?? "—"}</dd></div><div><dt className="text-meta font-medium uppercase tracking-wide text-ink-muted">Latencia</dt><dd className="mt-1 text-ink-secondary">{service.latencyMs === null ? "—" : `${service.latencyMs} ms`}</dd></div><div><dt className="text-meta font-medium uppercase tracking-wide text-ink-muted">Comprobado</dt><dd className="mt-1 text-ink-secondary">{service.status === "unconfigured" ? "—" : checkedAt}</dd></div></dl>{service.checks && Object.keys(service.checks).length > 0 ? <div className="mt-4 border-t border-line-soft pt-4"><p className="text-meta font-medium uppercase tracking-wide text-ink-muted">Dependencias</p><ul className="mt-2 flex flex-wrap gap-2">{Object.entries(service.checks).map(([name, status]) => <li key={name}><Badge tone={status === "ok" ? "success" : "danger"}>{name}: {status === "ok" ? "OK" : "Error"}</Badge></li>)}</ul></div> : null}{service.httpStatus !== null && service.status !== "ready" && service.status !== "not-ready" ? <p className="mt-4 text-meta text-ink-muted">HTTP {service.httpStatus}</p> : null}</div>;
}

function summarize(manufacturer: ManufacturerInfrastructure) {
  const configured = [manufacturer.reader, manufacturer.transformer].filter((service) => service.status !== "unconfigured");
  if (configured.length === 0) return { label: "Sin configurar", tone: "neutral" as const };
  if (configured.every((service) => service.status === "ready" || service.status === "running")) return { label: "Operativo", tone: "success" as const };
  return { label: "Con incidencias", tone: "danger" as const };
}

function ManufacturerCard({ manufacturer }: { manufacturer: ManufacturerInfrastructure }) {
  const summary = summarize(manufacturer);

  return <article aria-labelledby={`infrastructure-${manufacturer.key}`} className="rounded-xl border border-line-soft bg-surface p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-title font-semibold text-ink-strong" id={`infrastructure-${manufacturer.key}`}>{manufacturer.name}</h2><Badge tone={summary.tone}>{summary.label}</Badge></div><div className="mt-5 grid grid-cols-2 gap-4"><ServicePanel service={manufacturer.reader} /><ServicePanel service={manufacturer.transformer} /></div></article>;
}

export default async function InfrastructurePage() {
  await requireAdmin();
  const manufacturers = await getInfrastructureStatus();

  return <section className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><PageHeader><PageHeader.Title>Infraestructura</PageHeader.Title><PageHeader.Description>Estado de los readers y transformers de cada fabricante.</PageHeader.Description></PageHeader><InfrastructureRefresh /></div><div className="grid gap-4">{manufacturers.map((manufacturer) => <ManufacturerCard key={manufacturer.key} manufacturer={manufacturer} />)}</div><p className="text-meta text-ink-muted">La página actualiza los estados automáticamente cada 30 segundos mientras está visible.</p></section>;
}
