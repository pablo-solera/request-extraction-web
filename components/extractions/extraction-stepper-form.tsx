"use client";

import dynamic from "next/dynamic";
import { useActionState, useDeferredValue, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { createExtractionAction, type ExtractionFormState } from "@/app/(dashboard)/extractions/actions";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { BmwAvailabilityNotice } from "@/components/extractions/bmw-availability-notice";
import { formatSpanishDate, formatSpanishDateTime } from "@/lib/date-format";
import { extractionFormSchema, type ExtractionVehicle } from "@/lib/extractions/validation";
import { loadCachedJson } from "@/lib/client/cached-json";
import { useBmwAvailability, type AvailabilityTarget } from "@/lib/hooks/use-bmw-availability";

const BmwSwapReview = dynamic(() => import("@/components/extractions/bmw-swap-review").then((module) => module.BmwSwapReview));
const MercedesModelSelector = dynamic(() => import("@/components/extractions/mercedes-model-selector").then((module) => module.MercedesModelSelector));

type Vehicle = ExtractionVehicle & { id: string };
type ManufacturerGroup = ExtractionVehicle["manufacturerGroup"];
type ManufacturerBrand = ExtractionVehicle["brand"];
type FormValues = NonNullable<ExtractionFormState["values"]>;
type Option = { value: string; label: string };

export type ExtractionFormSeed = { group: ManufacturerGroup; values: FormValues; vehicles: ExtractionVehicle[] };

const STEP_TITLES = ["Datos comunes", "Fabricante", "Modelos", "Resumen"] as const;
const BRAND_OPTIONS: Record<ManufacturerGroup, ManufacturerBrand[]> = {
  BMW: ["BMW", "MINI"],
  Renault: ["Renault", "Dacia"],
  Mercedes: ["Mercedes-Benz"],
};
function isBrandInGroup(group: ManufacturerGroup | "", brand: ManufacturerBrand | ""): boolean {
  return group ? brand === "" || BRAND_OPTIONS[group].some((option) => option === brand) : brand === "";
}
function normalizeAxCode(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
}
const initialState: ExtractionFormState = {};
const emptyValues: FormValues = { axCode: "", imcEdition: "", completion: "", laboursDevelopmentStart: "", comments: "" };
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string) {
  const match = datePattern.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

const commonStepSchema = z.object({
  axCode: z.string().regex(/^[A-Za-z0-9]{3,4}$/, "El código AX debe tener entre 3 y 4 caracteres alfanuméricos."),
  imcEdition: z.string().trim().regex(/^\d{2}\/\d$/, "La edición debe tener el formato XX/X, por ejemplo 05/0."),
  completion: z.string().trim().min(1, "La fecha de finalización es obligatoria.").refine(isCalendarDate, "Introduce una fecha de finalización válida."),
  laboursDevelopmentStart: z.string().trim().min(1, "La fecha de inicio del desarrollo es obligatoria.").refine(isCalendarDate, "Introduce una fecha de inicio válida."),
});

const draftSchema = z.object({
  group: z.union([z.literal(""), z.enum(["BMW", "Renault", "Mercedes"])]),
  brand: z.union([z.literal(""), z.enum(["BMW", "MINI", "Renault", "Dacia", "Mercedes-Benz"])]),
  step: z.number().int().min(0).max(3).optional(),
  values: z.object({
    axCode: z.string().max(4),
    imcEdition: z.string().max(4),
    completion: z.string().max(10),
    laboursDevelopmentStart: z.string().max(10),
    comments: z.string().max(4_000),
  }).strict(),
  vehicles: z.array(z.discriminatedUnion("manufacturerGroup", [
    z.object({ id: z.string().min(1).max(100), manufacturerGroup: z.literal("Renault"), brand: z.enum(["Renault", "Dacia"]), modelDescription: z.string().max(200), modelCode: z.string().max(200) }).strict(),
    z.object({ id: z.string().min(1).max(100), manufacturerGroup: z.literal("BMW"), brand: z.enum(["BMW", "MINI"]), series: z.string().max(100), developmentCode: z.string().max(20), typekey: z.string().max(4), modelDescription: z.string().max(200) }).strict(),
    z.object({ id: z.string().min(1).max(100), manufacturerGroup: z.literal("Mercedes"), brand: z.literal("Mercedes-Benz"), series: z.string().max(100), modelCode: z.string().max(50), modelDescription: z.string().max(200) }).strict(),
  ])).max(50),
}).strict();

function emptyVehicle(group: ManufacturerGroup, brand: ManufacturerBrand, id = crypto.randomUUID()): Vehicle {
  return group === "BMW"
    ? { id, manufacturerGroup: "BMW", brand: brand as "BMW" | "MINI", series: "", developmentCode: "", typekey: "", modelDescription: "" }
    : { id, manufacturerGroup: "Renault", brand: brand as "Renault" | "Dacia", modelDescription: "", modelCode: "" };
}

function selectedModelsLabel(count: number) {
  return count === 1 ? "el modelo seleccionado" : `los ${count} modelos seleccionados`;
}

function FieldError({ children, id }: { children?: string; id: string }) {
  return children ? <span className="mt-1 block text-body text-danger-ink" id={id}>{children}</span> : null;
}

function CheckIcon() {
  return <svg aria-hidden="true" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

function hasOptionList(body: unknown) {
  const options = body && typeof body === "object" ? (body as { options?: unknown }).options : null;
  return Array.isArray(options) && options.every((option) => option && typeof option === "object" && "value" in option && typeof option.value === "string" && "label" in option && typeof option.label === "string");
}

function resultsLabel(count: number) {
  return count === 1 ? "1 resultado" : `${count} resultados`;
}

function StepHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return <div className="max-w-2xl"><h2 className="text-title font-semibold text-ink-strong" id={id}>{title}</h2><p className="mt-1 text-body text-ink-muted">{description}</p></div>;
}

function BmwOptionField({
  label, url, value, onChange, error, initialText, loadingText, emptyText, searchable = false, onAddMultiple, className,
}: {
  label: string;
  url: string | null;
  value: string;
  onChange(value: string): void;
  error?: string;
  initialText: string;
  loadingText: string;
  emptyText: string;
  searchable?: boolean;
  onAddMultiple?(values: string[]): number;
  className?: string;
}) {
  const [result, setResult] = useState<{ requestUrl: string; options: Option[]; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [pasteMessage, setPasteMessage] = useState("");
  const id = useId();
  const currentResult = result?.requestUrl === url ? result : null;
  const options = currentResult?.options ?? [];
  const message = currentResult?.message ?? "";
  const loading = Boolean(url && !currentResult);
  const deferredSearch = useDeferredValue(search);
  const filtered = deferredSearch.trim()
    ? options.filter((option) => `${option.value} ${option.label}`.toLocaleLowerCase("es-ES").includes(deferredSearch.trim().toLocaleLowerCase("es-ES")))
    : options;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void loadCachedJson(url, controller.signal, hasOptionList)
      .then(({ ok, body }) => {
        const envelope = body && typeof body === "object" ? body as { options?: unknown; error?: { message?: string } } : null;
        if (!ok) throw new Error(envelope?.error?.message || `No se han podido cargar ${label.toLocaleLowerCase("es-ES")} BMW.`);
        if (!hasOptionList(body)) throw new Error("BMW ha devuelto una lista de opciones no válida.");
        setResult({ requestUrl: url, options: (envelope?.options ?? []) as Option[], message: "" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ requestUrl: url, options: [], message: error instanceof Error ? error.message : "No se han podido cargar las opciones BMW." });
      });
    return () => controller.abort();
  }, [url, retry, label]);

  function addPastedTypekeys() {
    const codes = [...new Set(pasteValue.split(/[\s,;]+/).map((part) => part.trim().toUpperCase()).filter(Boolean))];
    const invalid = codes.filter((code) => !/^[A-Z0-9]{4}$/.test(code));
    const missing = codes.filter((code) => /^[A-Z0-9]{4}$/.test(code) && !options.some((option) => option.value === code));
    if (invalid.length || missing.length) {
      setPasteMessage(`Revisa la lista: ${invalid.length ? `${invalid.length} con formato no válido` : ""}${invalid.length && missing.length ? "; " : ""}${missing.length ? `${missing.length} no disponibles para este código` : ""}.`);
      return;
    }
    if (!codes.length || !onAddMultiple) return;
    const count = onAddMultiple(codes);
    setPasteMessage(count ? `${count} typekey${count === 1 ? " añadido" : "s añadidos"}.` : "Esos typekeys ya están añadidos.");
    setPasteValue("");
  }

  return <div className={className}>
    {searchable ? <div className="mb-3"><label className="field-label" htmlFor={`${id}-search`}>{`Buscar ${label.toLocaleLowerCase("es-ES")}`}</label><input autoComplete="off" className="field-control" disabled={!url || loading || Boolean(message)} id={`${id}-search`} onChange={(event) => setSearch(event.target.value)} placeholder="Por código o descripción" type="search" value={search} /><p aria-live="polite" className="sr-only" role="status">{deferredSearch.trim() && options.length > 0 ? resultsLabel(filtered.length) : ""}</p></div> : null}
    <label className="field-label" htmlFor={`${id}-select`}>{label}</label>
    <select aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)} className="field-control" disabled={!url || loading || Boolean(message) || options.length === 0} id={`${id}-select`} onChange={(event) => onChange(event.target.value)} required value={value}>
      <option value="">{!url ? initialText : loading ? loadingText : message ? "Opciones no disponibles" : options.length === 0 ? emptyText : searchable && deferredSearch && filtered.length === 0 ? "No se encontraron typekeys" : `Selecciona ${label.toLocaleLowerCase("es-ES")}`}</option>
      {filtered.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <FieldError id={`${id}-error`}>{error}</FieldError>
    {onAddMultiple ? <div className="mt-3 rounded-lg border border-line-soft bg-surface p-3">
      <label><span className="field-label">Pegar varios typekeys</span><textarea className="field-control min-h-20 resize-y font-mono" disabled={!url || loading || Boolean(message) || options.length === 0} onChange={(event) => setPasteValue(event.target.value)} placeholder="Ej.: 11EH, 41HZ, 51HY" value={pasteValue} /></label>
      <div className="mt-2 flex flex-wrap items-center gap-3"><Button disabled={!pasteValue.trim() || loading || options.length === 0} onClick={addPastedTypekeys}>Añadir typekeys</Button><span className="text-meta text-ink-muted">Separados por espacios, comas o punto y coma</span></div>
      {pasteMessage ? <p className="mt-2 text-body text-ink-muted" role="status">{pasteMessage}</p> : null}
    </div> : null}
    {message ? <div className="mt-2 flex items-center gap-2 text-body text-danger-ink" role="status"><span>{message}</span><Button onClick={() => setRetry((current) => current + 1)}>Reintentar</Button></div> : null}
  </div>;
}

function RenaultFamilySelector({ brand, selected, onToggle }: { brand: "Renault" | "Dacia"; selected: Vehicle[]; onToggle(option: Option, checked: boolean): void }) {
  const [result, setResult] = useState<{ url: string; options: Option[]; error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const url = `/api/readers/renault/families?brand=${encodeURIComponent(brand)}`;
  const current = result?.url === url ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    void loadCachedJson(url, controller.signal, hasOptionList)
      .then(({ ok, body }) => {
        const envelope = body && typeof body === "object" ? body as { options?: unknown; error?: { message?: string } } : null;
        if (!ok) throw new Error(envelope?.error?.message || `No se han podido cargar las familias de ${brand}.`);
        if (!hasOptionList(body)) throw new Error("El reader ha devuelto una lista de familias no válida.");
        setResult({ url, options: (envelope?.options ?? []) as Option[], error: "" });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ url, options: [], error: error instanceof Error ? error.message : "No se han podido cargar las familias." });
      });
    return () => controller.abort();
  }, [url, retry, brand]);

  const options = current?.options ?? [];
  const deferredSearch = useDeferredValue(search);
  const filtered = deferredSearch.trim() ? options.filter((option) => `${option.value} ${option.label}`.toLocaleLowerCase("es-ES").includes(deferredSearch.trim().toLocaleLowerCase("es-ES"))) : options;
  return <div className="space-y-3">
    <label className="block"><span className="field-label">Buscar familias</span><input className="field-control" disabled={!current || Boolean(current.error)} onChange={(event) => setSearch(event.target.value)} placeholder="Escribe nombre o código" type="search" value={search} /></label>
    <p aria-live="polite" className="sr-only" role="status">{deferredSearch.trim() && options.length > 0 ? resultsLabel(filtered.length) : ""}</p>
    {!current ? <p className="text-body text-ink-muted" role="status">Cargando familias de {brand}…</p> : current.error ? <div className="flex flex-wrap items-center gap-3 text-body text-danger-ink" role="alert"><span>{current.error}</span><Button onClick={() => setRetry((value) => value + 1)}>Reintentar</Button></div> : options.length === 0 ? <p className="rounded-lg border border-dashed border-line p-5 text-body text-ink-muted">El reader no ha devuelto familias para {brand}.</p> : filtered.length === 0 ? <p className="text-body text-ink-muted">No hay coincidencias.</p> : <ul className="max-h-96 divide-y divide-line-soft overflow-y-auto rounded-xl border border-line-soft bg-surface">{filtered.map((option) => {
      const checked = selected.some((vehicle) => vehicle.manufacturerGroup === "Renault" && vehicle.modelCode === option.value);
      return <li key={option.value}><label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-sunken"><input aria-label={`Seleccionar familia ${option.label}`} checked={checked} className="size-4 accent-focus" onChange={(event) => onToggle(option, event.target.checked)} type="checkbox" /><span className="min-w-0 text-body text-ink">{option.label}<span className="ml-2 font-mono text-meta text-ink-muted">{option.value}</span></span></label></li>;
    })}</ul>}
    <p className="text-meta text-ink-muted">Cada familia seleccionada se enviará como una extracción independiente.</p>
  </div>;
}

function fieldError(state: ExtractionFormState, local: Record<string, string>, key: string) {
  return local[key] ?? state.fieldErrors?.[key];
}

export function ExtractionStepperForm({
  draftKey = "extraction-draft-v1",
  initialValues,
  requiresApproval = false,
}: {
  draftKey?: string;
  initialValues?: ExtractionFormSeed;
  requiresApproval?: boolean;
}) {
  const [state, action] = useActionState(createExtractionAction, initialState);
  const [confirm, confirmDialog] = useConfirm();
  const formId = useId();
  const [group, setGroup] = useState<ManufacturerGroup | "">(initialValues?.group ?? "");
  const [brand, setBrand] = useState<ManufacturerBrand | "">(initialValues?.vehicles[0]?.brand ?? "");
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => initialValues
    ? initialValues.vehicles.map((vehicle, index) => ({ ...vehicle, id: `${formId}-seed-${index}` } as Vehicle))
    : []);
  const [values, setValues] = useState<FormValues>(() => initialValues
    ? { ...initialValues.values, axCode: normalizeAxCode(initialValues.values.axCode) }
    : emptyValues);
  const [step, setStep] = useState(initialValues ? 3 : 0);
  const [draftReady, setDraftReady] = useState(Boolean(initialValues));
  const [draftSaved, setDraftSaved] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [stepError, setStepError] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const availabilityTargets = new Map<string, AvailabilityTarget>();
  for (const vehicle of vehicles) {
    if (vehicle.manufacturerGroup === "BMW" && vehicle.series && vehicle.developmentCode && /^[A-Z0-9]{4}$/.test(vehicle.typekey)) {
      availabilityTargets.set(vehicle.id, { brand: vehicle.brand, series: vehicle.series, developmentCode: vehicle.developmentCode, typekey: vehicle.typekey });
    }
  }
  const availability = useBmwAvailability([...availabilityTargets.values()], step === 3 && group === "BMW");
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [tableConflict, setTableConflict] = useState<{ key: string; loadedAt: string | null } | "none" | null>(null);
  const bmwBrand = group === "BMW" && (brand === "BMW" || brand === "MINI") ? brand : null;
  const conflictKey = bmwBrand ? `${bmwBrand}|${values.axCode}|${values.imcEdition}` : null;
  useEffect(() => {
    if (step !== 3 || !bmwBrand || !conflictKey) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ axCode: values.axCode, imcEdition: values.imcEdition, brand: bmwBrand });
    void fetch(`/api/extractions/table-conflict?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as { conflict: boolean; loadedAt: string | null } : null)
      .then((result) => { if (result) setTableConflict(result.conflict ? { key: conflictKey, loadedAt: result.loadedAt } : "none"); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [bmwBrand, conflictKey, step, values.axCode, values.imcEdition]);
  const conflict = tableConflict !== null && tableConflict !== "none" ? tableConflict : null;
  const replacesTable = step === 3 && conflict !== null && conflict.key === conflictKey;
  const reviewItems = step === 2 && reviewing ? vehicles.flatMap((vehicle) => {
    const target = availabilityTargets.get(vehicle.id);
    const entry = target ? availability.entryFor(target) : null;
    return target && entry?.state === "ready" && entry.availability.status === "unavailable"
      ? [{ id: vehicle.id, typekey: target.typekey, series: target.series, developmentCode: target.developmentCode, availability: entry.availability }]
      : [];
  }) : [];
  const unavailableTypekeys = step === 3 ? [...availabilityTargets.values()].filter((target) => {
    const entry = availability.entryFor(target);
    return entry.state === "ready" && entry.availability.status === "unavailable";
  }).map((target) => target.typekey) : [];

  useEffect(() => {
    if (initialValues) return;
    const timeout = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const parsed = draftSchema.safeParse(JSON.parse(raw));
          if (parsed.success && isBrandInGroup(parsed.data.group, parsed.data.brand) && parsed.data.vehicles.every((vehicle) => (parsed.data.group === "" || vehicle.manufacturerGroup === parsed.data.group) && (parsed.data.brand === "" || vehicle.brand === parsed.data.brand))) {
            setGroup(parsed.data.group);
            setBrand(parsed.data.brand);
            setValues({ ...parsed.data.values, axCode: normalizeAxCode(parsed.data.values.axCode) });
            setVehicles(parsed.data.vehicles.map((vehicle) => ({ ...vehicle })) as Vehicle[]);
            setStep(parsed.data.step ?? 0);
          } else localStorage.removeItem(draftKey);
        }
      } catch {
        try { localStorage.removeItem(draftKey); } catch { /* Storage can be unavailable in private browsing. */ }
      } finally {
        setDraftReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [draftKey, initialValues]);

  useEffect(() => {
    if (focusRequest > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (!draftReady) return;
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ group, brand, step, values, vehicles }));
        setDraftSaved(true);
      } catch {
        setDraftSaved(false);
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [brand, draftKey, draftReady, group, step, values, vehicles]);

  function clearValidation() {
    setLocalErrors({});
    setStepError("");
  }

  async function selectGroup(nextGroup: ManufacturerGroup) {
    if (group === nextGroup) return;
    const hasModels = vehicles.some((vehicle) => vehicle.manufacturerGroup === "BMW"
      ? Boolean(vehicle.series || vehicle.developmentCode || vehicle.typekey)
      : Boolean(vehicle.modelCode));
    if (hasModels && !await confirm({ title: "¿Cambiar de grupo?", description: `Se borrará ${selectedModelsLabel(vehicles.length)} y tendrás que volver a elegir modelos.`, confirmLabel: "Cambiar de grupo", cancelLabel: "Mantener grupo" })) return;
    setGroup(nextGroup);
    setBrand(nextGroup === "Mercedes" ? "Mercedes-Benz" : "");
    setVehicles([]);
    clearValidation();
  }

  async function selectBrand(nextBrand: ManufacturerBrand) {
    if (brand === nextBrand) return;
    const hasModels = vehicles.some((vehicle) => vehicle.manufacturerGroup === "BMW"
      ? Boolean(vehicle.series || vehicle.developmentCode || vehicle.typekey)
      : Boolean(vehicle.modelCode));
    if (hasModels && !await confirm({ title: "¿Cambiar de fabricante?", description: `Se borrará ${selectedModelsLabel(vehicles.length)} y tendrás que volver a elegir modelos.`, confirmLabel: "Cambiar de fabricante", cancelLabel: "Mantener fabricante" })) return;
    setBrand(nextBrand);
    setVehicles(group ? (group === "BMW" ? [emptyVehicle("BMW", nextBrand, `${formId}-model-0`)] : []) : []);
    clearValidation();
  }

  function updateBmwVehicle(id: string, patch: Partial<Extract<Vehicle, { manufacturerGroup: "BMW" }>>) {
    setVehicles((current) => current.map((vehicle) => vehicle.id === id && vehicle.manufacturerGroup === "BMW" ? { ...vehicle, ...patch, brand: brand as "BMW" | "MINI" } : vehicle));
    clearValidation();
  }

  function addBmwTypekeys(id: string, codes: string[]) {
    const source = vehicles.find((vehicle): vehicle is Extract<Vehicle, { manufacturerGroup: "BMW" }> => vehicle.id === id && vehicle.manufacturerGroup === "BMW");
    if (!source || vehicles.length >= 50 || (brand !== "BMW" && brand !== "MINI")) return 0;
    const existing = new Set(vehicles.flatMap((vehicle) => vehicle.manufacturerGroup === "BMW" && vehicle.typekey ? [vehicle.typekey] : []));
    const fresh = codes.filter((code) => !existing.has(code)).slice(0, 50 - vehicles.length + (source.typekey ? 0 : 1));
    if (!fresh.length) return 0;
    if (!source.typekey) {
      const [first, ...remaining] = fresh;
      const additions = remaining.map((typekey, index) => ({ ...source, id: `${formId}-model-${vehicles.length + index}`, typekey, brand: brand as "BMW" | "MINI" }));
      setVehicles(vehicles.map((vehicle) => vehicle.id === id && vehicle.manufacturerGroup === "BMW" ? { ...vehicle, typekey: first! } : vehicle).concat(additions));
    } else {
      setVehicles(vehicles.concat(fresh.map((typekey, index) => ({ ...source, id: `${formId}-model-${vehicles.length + index}`, typekey, brand }))));
    }
    clearValidation();
    return fresh.length;
  }

  function replaceWithBaseType(id: string, baseTypekey: string) {
    const duplicate = vehicles.some((vehicle) => vehicle.id !== id && vehicle.manufacturerGroup === "BMW" && vehicle.typekey === baseTypekey);
    if (duplicate && vehicles.length > 1) setVehicles((current) => current.filter((vehicle) => vehicle.id !== id));
    else updateBmwVehicle(id, { typekey: baseTypekey });
    clearValidation();
  }

  function removeUnavailableVehicle(id: string) {
    if (vehicles.length <= 1) setVehicles((current) => current.map((vehicle) => vehicle.id === id && vehicle.manufacturerGroup === "BMW" ? { ...vehicle, typekey: "" } : vehicle));
    else setVehicles((current) => current.filter((vehicle) => vehicle.id !== id));
    clearValidation();
  }

  async function checkAvailabilityThenContinue() {
    const targets = [...availabilityTargets.values()];
    setChecking({ done: 0, total: new Set(targets.map((target) => target.typekey)).size });
    const results = await availability.ensure(targets, (done, total) => setChecking({ done, total }));
    setChecking(null);
    if (Object.values(results).some((entry) => entry.state === "ready" && entry.availability.status === "unavailable")) {
      setReviewing(true);
      setStepError("Hay typekeys sin datos en BMW. Revisa cada uno para poder continuar.");
      return;
    }
    setReviewing(false);
    setStep(3);
  }

  function addBlankBmwVehicle() {
    if (group !== "BMW" || (brand !== "BMW" && brand !== "MINI") || vehicles.length >= 50) return;
    setVehicles((current) => [...current, emptyVehicle("BMW", brand, `${formId}-model-${current.length}`)]);
    clearValidation();
  }

  function toggleMercedesModel(option: Option, selected: boolean, series: string) {
    if (group !== "Mercedes") return;
    setVehicles((current) => {
      const without = current.filter((vehicle) => vehicle.manufacturerGroup !== "Mercedes" || vehicle.modelCode !== option.value);
      if (!selected || without.length >= 50) return without;
      return [...without, { id: `${formId}-mercedes-${option.value}`, manufacturerGroup: "Mercedes", brand: "Mercedes-Benz", series, modelCode: option.value, modelDescription: option.label }];
    });
    clearValidation();
  }

  function changeMercedesSeries(series: string) {
    setVehicles((current) => current.filter((vehicle) => vehicle.manufacturerGroup === "Mercedes" && vehicle.series === series));
    clearValidation();
  }

  function toggleRenaultFamily(option: Option, selected: boolean) {
    if (group !== "Renault" || (brand !== "Renault" && brand !== "Dacia")) return;
    setVehicles((current) => {
      const without = current.filter((vehicle) => vehicle.manufacturerGroup !== "Renault" || vehicle.modelCode !== option.value);
      if (!selected || without.length >= 50) return without;
      return [...without, { id: `${formId}-family-${option.value}`, manufacturerGroup: "Renault", brand, modelDescription: option.label, modelCode: option.value }];
    });
    clearValidation();
  }

  function duplicateBmwVehicle(id: string) {
    if (vehicles.length >= 50) return;
    const source = vehicles.find((vehicle): vehicle is Extract<Vehicle, { manufacturerGroup: "BMW" }> => vehicle.id === id && vehicle.manufacturerGroup === "BMW");
    if (!source) return;
    const index = vehicles.findIndex((vehicle) => vehicle.id === id);
    const duplicate = { ...source, id: `${formId}-model-${vehicles.length}`, typekey: "" };
    setVehicles([...vehicles.slice(0, index + 1), duplicate, ...vehicles.slice(index + 1)]);
    clearValidation();
  }

  function removeBmwVehicle(id: string) {
    if (vehicles.length <= 1) return;
    setVehicles((current) => current.filter((vehicle) => vehicle.id !== id));
    clearValidation();
  }

  function goToStep(nextStep: number) {
    if (nextStep >= step) return;
    setStep(nextStep);
    clearValidation();
  }

  function nextStep() {
    clearValidation();
    if (step === 0) {
      const parsed = commonStepSchema.safeParse(values);
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
        setLocalErrors(errors);
        setStepError("Completa correctamente los datos comunes para continuar.");
        setFocusRequest((current) => current + 1);
        return;
      }
    }
    if (step === 1 && (!group || !isBrandInGroup(group, brand))) {
      setStepError("Selecciona un grupo y un fabricante para continuar.");
      return;
    }
    if (step === 2) {
      const parsed = extractionFormSchema.safeParse({ ...values, vehicles });
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const [field, index, vehicleField] = issue.path;
          if (field === "vehicles" && typeof index === "number") errors[`vehicle.${index}.${String(vehicleField ?? "")}`] ??= issue.message;
        }
        setLocalErrors(errors);
        setStepError(parsed.error.issues[0]?.message ?? "Selecciona al menos un modelo válido.");
        setFocusRequest((current) => current + 1);
        return;
      }
      if (group === "BMW" && availabilityTargets.size > 0) {
        void checkAvailabilityThenContinue();
        return;
      }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  function vehicleError(index: number, field: string) {
    return fieldError(state, localErrors, `vehicle.${index}.${field}`);
  }

  const summaryTitle = group === "BMW" ? "Serie y typekeys" : group === "Mercedes" ? "Serie y modelos" : "Familias";

  return <form action={action} className="overflow-hidden rounded-xl border border-line-soft bg-surface" ref={formRef}>
    {confirmDialog}

    <div className="border-b border-line-soft px-7 py-4">
      <nav aria-label="Progreso de la solicitud">
        <ol className="flex items-center">
          {STEP_TITLES.map((title, index) => <li className={`flex min-w-0 items-center ${index < STEP_TITLES.length - 1 ? "flex-1" : ""}`} key={title}>
            <button aria-current={step === index ? "step" : undefined} className={`flex min-h-11 shrink-0 items-center gap-3 rounded-lg text-body transition-colors ${step === index ? "font-semibold text-ink-strong" : index < step ? "text-ink hover:text-ink-strong" : "cursor-not-allowed text-ink-muted"}`} disabled={index > step} onClick={() => goToStep(index)} type="button">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-body font-medium tabular-nums ${step === index ? "border-2 border-ink-strong bg-surface text-ink-strong" : index < step ? "border-ink-strong bg-ink-strong text-surface" : "border-line bg-surface text-ink-muted"}`}>{index < step ? <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : index + 1}</span>
              <span>{title}</span>{index < step ? <span className="sr-only"> (completado)</span> : null}
            </button>
            {index < STEP_TITLES.length - 1 ? <span aria-hidden="true" className={`mx-3 h-px min-w-3 flex-1 ${index < step ? "bg-ink-strong" : "bg-line"}`} /> : null}
          </li>)}
        </ol>
      </nav>
      <p aria-live="polite" className="sr-only">Paso {step + 1} de 4 · {STEP_TITLES[step]}</p>
    </div>

    <div className="space-y-6 p-7">
      {step === 0 ? <section aria-labelledby="step-common" className="space-y-5">
        <StepHeading id="step-common" title="Datos comunes" description="Estos datos se aplicarán a todas las extracciones de esta solicitud." />
        <div className="grid grid-cols-2 gap-5">
          <div><label><span className="field-label">Código AX</span><input aria-describedby={localErrors.axCode || state.fieldErrors?.axCode ? `${formId}-axCode-error` : undefined} aria-invalid={Boolean(localErrors.axCode || state.fieldErrors?.axCode)} autoComplete="off" className="field-control font-mono uppercase placeholder:normal-case" maxLength={4} minLength={3} onChange={(event) => setValues((current) => ({ ...current, axCode: normalizeAxCode(event.target.value) }))} pattern="[A-Za-z0-9]{3,4}" placeholder="Ej.: 1XF" required spellCheck={false} value={values.axCode} /></label><FieldError id={`${formId}-axCode-error`}>{localErrors.axCode ?? state.fieldErrors?.axCode}</FieldError></div>
          <div><label><span className="field-label">Edición IMC</span><input aria-describedby={localErrors.imcEdition || state.fieldErrors?.imcEdition ? `${formId}-imcEdition-error` : undefined} aria-invalid={Boolean(localErrors.imcEdition || state.fieldErrors?.imcEdition)} autoComplete="off" className="field-control font-mono" inputMode="numeric" maxLength={4} onChange={(event) => setValues((current) => ({ ...current, imcEdition: event.target.value }))} pattern="\d{2}/\d" placeholder="Ej.: 05/0" required spellCheck={false} value={values.imcEdition} /></label><FieldError id={`${formId}-imcEdition-error`}>{localErrors.imcEdition ?? state.fieldErrors?.imcEdition}</FieldError></div>
          <div><label><span className="field-label">Inicio del desarrollo</span><input aria-describedby={localErrors.laboursDevelopmentStart || state.fieldErrors?.laboursDevelopmentStart ? `${formId}-laboursDevelopmentStart-error` : undefined} aria-invalid={Boolean(localErrors.laboursDevelopmentStart || state.fieldErrors?.laboursDevelopmentStart)} autoComplete="off" className="field-control" lang="es-ES" onChange={(event) => setValues((current) => ({ ...current, laboursDevelopmentStart: event.target.value }))} required type="date" value={values.laboursDevelopmentStart} /></label><FieldError id={`${formId}-laboursDevelopmentStart-error`}>{localErrors.laboursDevelopmentStart ?? state.fieldErrors?.laboursDevelopmentStart}</FieldError></div>
          <div><label><span className="field-label">Fecha de finalización</span><input aria-describedby={localErrors.completion || state.fieldErrors?.completion ? `${formId}-completion-error` : undefined} aria-invalid={Boolean(localErrors.completion || state.fieldErrors?.completion)} autoComplete="off" className="field-control" lang="es-ES" onChange={(event) => setValues((current) => ({ ...current, completion: event.target.value }))} required type="date" value={values.completion} /></label><FieldError id={`${formId}-completion-error`}>{localErrors.completion ?? state.fieldErrors?.completion}</FieldError></div>
        </div>
      </section> : null}

      {step === 1 ? <section aria-labelledby="step-manufacturer" className="space-y-6">
        <StepHeading id="step-manufacturer" title="Grupo y fabricante" description="Una solicitud corresponde a una sola marca. Después podrás añadir varios modelos o familias de esa marca." />
        <fieldset className="space-y-3"><legend className="field-label">Grupo de fabricantes</legend>
          <div className="grid grid-cols-4 gap-3">
            {(["BMW", "Renault", "Mercedes"] as const).map((option) => <button aria-pressed={group === option} className={`flex min-h-16 items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-body font-semibold transition-colors ${group === option ? "border-2 border-ink-strong bg-surface-sunken text-ink-strong" : "border-line bg-surface text-ink hover:bg-surface-sunken"}`} key={option} onClick={() => void selectGroup(option)} type="button">{option === "BMW" ? "BMW Group" : option === "Renault" ? "Renault Group" : "Mercedes-Benz Group"}{group === option ? <CheckIcon /> : null}</button>)}
            <button aria-describedby="vag-disabled-description" aria-disabled="true" className="min-h-16 cursor-not-allowed rounded-xl border border-line-soft bg-canvas px-4 py-3 text-left text-body font-semibold text-ink-muted" disabled type="button">VAG <span className="mt-1 block text-meta font-normal">Deshabilitado</span></button>
          </div>
          <p className="text-body text-ink-muted" id="vag-disabled-description">El reader VAG está disponible, pero las solicitudes siguen deshabilitadas en este formulario. Incluye Volkswagen, Audi, Škoda y SEAT.</p>
        </fieldset>
        {group ? <fieldset className="space-y-3"><legend className="field-label">Fabricante</legend><div className="flex flex-wrap gap-2">{BRAND_OPTIONS[group].map((option) => <button aria-pressed={brand === option} className={buttonStyles(brand === option ? "primary" : "secondary")} key={option} onClick={() => void selectBrand(option)} type="button">{brand === option ? <CheckIcon /> : null}{option}</button>)}</div></fieldset> : <p className="text-body text-ink-muted">Selecciona un grupo para ver sus fabricantes.</p>}
        {stepError ? <p className="text-body text-danger-ink" role="alert">{stepError}</p> : null}
      </section> : null}

      {step === 2 ? <section aria-labelledby="step-models" className="space-y-5">
        <StepHeading id="step-models" title={summaryTitle} description={group === "BMW" ? "Elige la serie, el código de desarrollo y los typekeys. Cada typekey genera una extracción." : group === "Mercedes" ? "Elige la serie y uno o varios modelos. Se creará una extracción independiente por cada modelo." : "Selecciona una o varias familias. Se creará una extracción independiente por cada familia."} />
        {group === "Renault" && (brand === "Renault" || brand === "Dacia") ? <RenaultFamilySelector brand={brand} onToggle={toggleRenaultFamily} selected={vehicles} /> : null}
        {group === "Mercedes" ? <MercedesModelSelector initialSeries={vehicles[0]?.manufacturerGroup === "Mercedes" ? vehicles[0].series : ""} onSeriesChange={changeMercedesSeries} onToggle={toggleMercedesModel} selected={vehicles.flatMap((vehicle) => vehicle.manufacturerGroup === "Mercedes" ? [{ series: vehicle.series, modelCode: vehicle.modelCode }] : [])} /> : null}
        {group === "BMW" ? <>
          {vehicles.length === 0 ? <p className="text-body text-ink-muted">Añade el primer typekey para continuar.</p> : <div className="space-y-4">{vehicles.map((vehicle, index) => vehicle.manufacturerGroup === "BMW" ? <fieldset className="grid min-w-0 gap-3 rounded-xl border border-line-soft bg-surface-sunken p-4 grid-cols-[0.65fr_0.8fr_1fr_1fr_1.7fr_auto]" key={vehicle.id}>
            <legend className="sr-only">Typekey {index + 1}</legend>
            <label><span className="field-label">Fabricante</span><span className="field-control flex items-center">{brand}</span></label>
            <BmwOptionField emptyText="No hay series disponibles" error={fieldError(state, localErrors, `vehicle.${index}.series`)} initialText="Carga series" label="Serie" loadingText="Cargando series…" onChange={(value) => updateBmwVehicle(vehicle.id, { series: value, developmentCode: "", typekey: "" })} url={`/api/readers/bmw/series?brand=${encodeURIComponent(brand)}`} value={vehicle.series} />
            <BmwOptionField emptyText="No hay códigos para esta serie" error={vehicleError(index, "developmentCode")} initialText="Selecciona primero una serie" label="Código de desarrollo" loadingText="Cargando códigos…" onChange={(value) => updateBmwVehicle(vehicle.id, { developmentCode: value, typekey: "" })} url={vehicle.series ? `/api/readers/bmw/development-codes?${new URLSearchParams({ brand, series: vehicle.series })}` : null} value={vehicle.developmentCode} />
            <BmwOptionField className="col-span-2" emptyText="No hay typekeys para esta selección" error={vehicleError(index, "typekey")} initialText="Selecciona primero un código" label="Typekey" loadingText="Cargando typekeys…" onAddMultiple={(codes) => addBmwTypekeys(vehicle.id, codes)} onChange={(value) => updateBmwVehicle(vehicle.id, { typekey: value })} searchable url={vehicle.series && vehicle.developmentCode ? `/api/readers/bmw/typekeys?${new URLSearchParams({ brand, series: vehicle.series, developmentCode: vehicle.developmentCode })}` : null} value={vehicle.typekey} />
            <div className="flex flex-col items-stretch gap-2"><Button aria-label={`Duplicar typekey ${index + 1}`} disabled={vehicles.length >= 50} onClick={() => duplicateBmwVehicle(vehicle.id)}>Duplicar</Button><Button aria-label={`Quitar typekey ${index + 1}`} disabled={vehicles.length === 1} onClick={() => removeBmwVehicle(vehicle.id)} variant="danger">Quitar</Button></div>
          </fieldset> : null)}</div>}
          <Button disabled={vehicles.length >= 50} onClick={addBlankBmwVehicle}>Añadir otro typekey</Button>
        </> : null}
        <BmwSwapReview items={reviewItems} onRemove={removeUnavailableVehicle} onSwap={replaceWithBaseType} />
        {stepError ? <p className="text-body text-danger-ink" role="alert">{stepError}</p> : null}
      </section> : null}

      {step === 3 ? <section aria-labelledby="step-summary" className="space-y-5">
        <StepHeading id="step-summary" title="Revisa e inicia" description="Confirma los datos comunes y los modelos antes de crear las extracciones." />
        <div className="overflow-hidden rounded-xl border border-line-soft bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-surface-sunken px-5 py-4">
            <div><p className="text-meta font-medium text-ink-muted">Código AX</p><p className="mt-0.5 font-mono text-headline font-semibold text-ink-strong">{values.axCode}</p></div>
            <Badge icon={false} tone="info">{brand}</Badge>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-line-soft text-body">
            <div className="px-5 py-4"><dt className="text-meta font-medium text-ink-muted">Edición IMC</dt><dd className="mt-1 font-medium text-ink">{values.imcEdition}</dd></div>
            <div className="px-5 py-4"><dt className="text-meta font-medium text-ink-muted">Inicio del desarrollo</dt><dd className="mt-1 font-medium text-ink">{formatSpanishDate(values.laboursDevelopmentStart)}</dd></div>
            <div className="px-5 py-4"><dt className="text-meta font-medium text-ink-muted">Fecha de finalización</dt><dd className="mt-1 font-medium text-ink">{formatSpanishDate(values.completion)}</dd></div>
          </dl>
        </div>
        <div className="overflow-hidden rounded-xl border border-line-soft bg-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft px-5 py-4"><h3 className="text-body font-semibold text-ink-strong">Modelos seleccionados</h3><span className="rounded-full bg-canvas px-2.5 py-0.5 text-meta font-medium tabular-nums text-ink-secondary">{vehicles.length} {vehicles.length === 1 ? "extracción" : "extracciones"}</span></div>
          <ul className="divide-y divide-line-soft">{vehicles.map((vehicle, index) => {
            const target = availabilityTargets.get(vehicle.id);
            return <li className="px-5 py-3 text-body" key={vehicle.id}>
              <div className="flex items-center gap-3"><span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas text-meta font-medium tabular-nums text-ink-muted">{index + 1}</span><span className="min-w-0 flex-1 font-medium text-ink">{vehicle.modelDescription || "Modelo seleccionado"}</span><span className="shrink-0 rounded-md border border-line-soft bg-surface-sunken px-2 py-1 font-mono text-meta text-ink-secondary">{vehicle.manufacturerGroup === "BMW" ? `${vehicle.series} · ${vehicle.developmentCode} · ${vehicle.typekey}` : vehicle.manufacturerGroup === "Mercedes" ? `${vehicle.series} · ${vehicle.modelCode}` : vehicle.modelCode}</span></div>
              {target ? <div className="mt-2 pl-9"><BmwAvailabilityNotice entry={availability.entryFor(target)} onRetry={() => availability.retry(target)} onUseBaseType={(baseTypekey) => replaceWithBaseType(vehicle.id, baseTypekey)} typekey={target.typekey} /></div> : null}
            </li>;
          })}</ul>
        </div>
        {replacesTable ? <Alert tone="pending"><label className="flex items-start gap-3">
          <input checked={replaceConfirmed} className="mt-1 size-4" onChange={(event) => setReplaceConfirmed(event.target.checked)} type="checkbox" />
          <span>Ya hay datos cargados en BMW_Labour para el código AX <strong className="font-mono">{values.axCode}</strong> y la edición <strong className="font-mono">{values.imcEdition}</strong>{conflict?.loadedAt ? ` (${formatSpanishDateTime(conflict.loadedAt)})` : ""}. Al terminar esta extracción se reemplazará la tabla completa por los typekeys de esta solicitud. Entiendo que se perderán los datos anteriores.</span>
        </label></Alert> : null}
        {unavailableTypekeys.length ? <Alert role="alert" tone="danger">BMW no tiene tiempos para {unavailableTypekeys.join(", ")}. Quita esos typekeys o sustitúyelos por un tipo base sugerido para poder iniciar la extracción.</Alert> : null}
        {requiresApproval ? <Alert tone="pending">La solicitud quedará pendiente de aprobación de tu coordinador.</Alert> : null}
        <label className="block"><span className="field-label">Comentarios (opcional)</span><textarea autoComplete="off" className="field-control min-h-24 resize-y" maxLength={4_000} onChange={(event) => setValues((current) => ({ ...current, comments: event.target.value }))} placeholder="Añade información útil para la extracción…" value={values.comments} /></label>
        {state.error ? <Alert aria-live="polite" role="alert" tone="danger"><p>{state.error}</p>{state.fieldErrors ? <ul className="mt-2 list-inside list-disc">{Object.entries(state.fieldErrors).map(([field, message]) => <li key={field}>{message}</li>)}</ul> : null}</Alert> : null}
      </section> : null}

      <input name="axCode" type="hidden" value={values.axCode} />
      <input name="imcEdition" type="hidden" value={values.imcEdition} />
      <input name="completion" type="hidden" value={values.completion} />
      <input name="laboursDevelopmentStart" type="hidden" value={values.laboursDevelopmentStart} />
      <input name="comments" type="hidden" value={values.comments} />
      <input name="confirmReplace" type="hidden" value={replacesTable && replaceConfirmed ? "true" : "false"} />
      <input name="vehicles" type="hidden" value={JSON.stringify(vehicles)} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Button hidden={step === 0} onClick={() => { setStep((current) => Math.max(0, current - 1)); clearValidation(); }} variant="ghost">Atrás</Button><span aria-live="polite" className="text-meta text-ink-muted" role="status">{draftReady ? draftSaved ? "Borrador guardado" : "Guardando borrador…" : "Cargando borrador…"}</span></div>
        {step < 3 ? <Button aria-busy={checking !== null} disabled={checking !== null} onClick={nextStep} variant="primary">{checking ? `Comprobando disponibilidad (${checking.done}/${checking.total})…` : "Continuar"}</Button> : <SubmitButton className="min-w-52" disabled={unavailableTypekeys.length > 0 || (replacesTable && !replaceConfirmed)} pendingLabel="Iniciando…">Iniciar extracción</SubmitButton>}
      </div>
    </div>
  </form>;
}
