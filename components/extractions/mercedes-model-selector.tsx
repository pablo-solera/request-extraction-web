"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";

type ModelOption = { value: string; label: string; productGroup: string | null };
type Option = { value: string; label: string };
type Loaded<T> = { url: string; data: T; error: string };

export type MercedesSelectedModel = { series: string; modelCode: string };

async function loadJson<T>(url: string, signal: AbortSignal, parse: (body: Record<string, unknown>) => T, fallback: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json() as Record<string, unknown> & { error?: { message?: string } };
  if (!response.ok) throw new Error(body?.error?.message || fallback);
  return parse(body);
}

const isOptionList = (value: unknown): value is Option[] => Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof (item as Option).value === "string" && typeof (item as Option).label === "string");

export function MercedesModelSelector({ initialSeries, selected, onSeriesChange, onToggle }: {
  initialSeries: string;
  selected: MercedesSelectedModel[];
  onSeriesChange(series: string): void;
  onToggle(option: Option, checked: boolean, series: string): void;
}) {
  const id = useId();
  const [series, setSeries] = useState(initialSeries);
  const [productGroup, setProductGroup] = useState("");
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const [seriesResult, setSeriesResult] = useState<Loaded<Option[]> | null>(null);
  // The product-group filter disappears once applied, so the options of the unfiltered answer are kept per series.
  const [groupsResult, setGroupsResult] = useState<{ series: string; groups: Option[] } | null>(null);
  const [modelsResult, setModelsResult] = useState<Loaded<{ models: ModelOption[]; productGroups: Option[] }> | null>(null);

  const seriesUrl = "/api/readers/mercedes/series";
  const modelsUrl = series ? `/api/readers/mercedes/models?${new URLSearchParams({ series, ...(productGroup ? { productGroup } : {}) })}` : null;
  const currentSeries = seriesResult?.url === seriesUrl ? seriesResult : null;
  const currentModels = modelsUrl && modelsResult?.url === modelsUrl ? modelsResult : null;

  useEffect(() => {
    const controller = new AbortController();
    loadJson(seriesUrl, controller.signal, (body) => {
      if (!isOptionList(body.options)) throw new Error("Mercedes-Benz ha devuelto una lista de series no válida.");
      return body.options;
    }, "No se han podido cargar las series Mercedes-Benz.")
      .then((data) => setSeriesResult({ url: seriesUrl, data, error: "" }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setSeriesResult({ url: seriesUrl, data: [], error: error instanceof Error ? error.message : "No se han podido cargar las series." }); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!modelsUrl) return;
    const controller = new AbortController();
    loadJson(modelsUrl, controller.signal, (body) => {
      if (!Array.isArray(body.options) || !isOptionList(body.options) || !isOptionList(body.productGroups ?? [])) throw new Error("Mercedes-Benz ha devuelto una lista de modelos no válida.");
      return { models: body.options as ModelOption[], productGroups: (body.productGroups ?? []) as Option[] };
    }, "No se han podido cargar los modelos Mercedes-Benz.")
      .then((data) => {
        if (!productGroup && data.productGroups.length > 0) setGroupsResult({ series, groups: data.productGroups });
        setModelsResult({ url: modelsUrl, data, error: "" });
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setModelsResult({ url: modelsUrl, data: { models: [], productGroups: [] }, error: error instanceof Error ? error.message : "No se han podido cargar los modelos." }); });
    return () => controller.abort();
  }, [modelsUrl, productGroup, retry, series]);

  function changeSeries(next: string) {
    setSeries(next);
    setProductGroup("");
    setSearch("");
    onSeriesChange(next);
  }

  const knownGroups = groupsResult?.series === series ? groupsResult.groups : [];
  const models = currentModels?.data.models ?? [];
  const term = search.trim().toLocaleLowerCase("es-ES");
  const filtered = term ? models.filter((model) => `${model.value} ${model.label}`.toLocaleLowerCase("es-ES").includes(term)) : models;
  const failure = currentSeries?.error || currentModels?.error || "";

  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label className="field-label" htmlFor={`${id}-series`}>Serie</label>
        <select className="field-control" disabled={!currentSeries || Boolean(currentSeries.error) || currentSeries.data.length === 0} id={`${id}-series`} onChange={(event) => changeSeries(event.target.value)} value={series}>
          <option value="">{!currentSeries ? "Cargando series…" : currentSeries.error ? "Opciones no disponibles" : currentSeries.data.length === 0 ? "No hay series disponibles" : "Selecciona serie"}</option>
          {currentSeries?.data.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {knownGroups.length > 1 ? <div>
        <label className="field-label" htmlFor={`${id}-group`}>Grupo de producto</label>
        <select className="field-control" id={`${id}-group`} onChange={(event) => setProductGroup(event.target.value)} value={productGroup}>
          <option value="">Todos</option>
          {knownGroups.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div> : null}
    </div>
    {failure ? <div className="flex flex-wrap items-center gap-3 text-body text-danger-ink" role="alert"><span>{failure}</span><Button onClick={() => setRetry((value) => value + 1)}>Reintentar</Button></div> : null}
    {series && !currentModels ? <p className="text-body text-ink-muted" role="status">Cargando modelos…</p> : null}
    {currentModels && !currentModels.error ? <>
      <label className="block"><span className="field-label">Buscar modelos</span><input className="field-control" onChange={(event) => setSearch(event.target.value)} placeholder="Escribe designación o descripción" type="search" value={search} /></label>
      <p aria-live="polite" className="sr-only" role="status">{term && models.length > 0 ? (filtered.length === 1 ? "1 resultado" : `${filtered.length} resultados`) : ""}</p>
      {models.length === 0 ? <p className="rounded-lg border border-dashed border-line p-5 text-body text-ink-muted">El reader no ha devuelto modelos para esta serie.</p>
        : filtered.length === 0 ? <p className="text-body text-ink-muted">No hay coincidencias.</p>
        : <ul className="max-h-96 divide-y divide-line-soft overflow-y-auto rounded-xl border border-line-soft bg-surface">{filtered.map((option) => {
          const checked = selected.some((model) => model.series === series && model.modelCode === option.value);
          return <li key={option.value}><label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-sunken"><input aria-label={`Seleccionar modelo ${option.label}`} checked={checked} className="size-4 accent-focus" onChange={(event) => onToggle(option, event.target.checked, series)} type="checkbox" /><span className="min-w-0 text-body text-ink">{option.label}{option.productGroup ? <span className="ml-2 text-meta text-ink-muted">{option.productGroup}</span> : null}</span></label></li>;
        })}</ul>}
      <p className="text-meta text-ink-muted">Cada modelo seleccionado se enviará como una extracción independiente.</p>
    </> : null}
  </div>;
}
