import type { BmwTypekeyAvailability } from "@/lib/readers/bmw/types";

const ATTRIBUTE_LABELS: Record<string, string> = {
  model: "modelo",
  engine: "motor",
  body: "carrocería",
  transmission: "cambio",
  eDrive: "eDrive",
  electricMotor: "motor eléctrico",
  doors: "puertas",
  market: "mercado",
  steering: "volante",
  capacity: "cilindrada",
  power: "potencia",
  validity: "periodo de fabricación",
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  transmission: { AUT: "automático", MECH: "manual" },
  steering: { LL: "izquierda", RL: "derecha" },
};

function displayedValue(attribute: string, value: string | null) {
  if (value === null) return "sin dato";
  return VALUE_LABELS[attribute]?.[value] ?? value;
}

export type SwapOffer =
  | { kind: "swap"; baseTypekey: string; identical: boolean; differences: string[] }
  | { kind: "none"; reason: string };

function formatDifferences(base: NonNullable<BmwTypekeyAvailability["baseType"]>) {
  return base.differences.map((item) => `${ATTRIBUTE_LABELS[item.attribute] ?? item.attribute} (${displayedValue(item.attribute, item.requested)} → ${displayedValue(item.attribute, item.baseType)})`);
}

/** Whether an unavailable typekey can be swapped for its base type, and what would change. The technician decides. */
export function describeSwapOffer(availability: BmwTypekeyAvailability): SwapOffer {
  const base = availability.baseType;
  if (!base) return { kind: "none", reason: "no tiene un tipo base con datos que pueda sustituirlo" };
  if (base.status === "unavailable") return { kind: "none", reason: `su tipo base ${base.typekey} tampoco tiene datos en BMW` };
  if (base.status === "unknown") return { kind: "none", reason: `no se ha podido comprobar su tipo base ${base.typekey}` };
  const differences = formatDifferences(base);
  return { kind: "swap", baseTypekey: base.typekey, identical: differences.length === 0 && base.reliable, differences: differences.length ? differences : base.reliable ? [] : ["características no verificables"] };
}

export type AvailabilityNotice =
  | { kind: "available" }
  | { kind: "unknown"; message: string }
  | { kind: "unavailable"; message: string; baseTypeMessage?: string; suggestedTypekey?: string };

export function describeAvailability(availability: BmwTypekeyAvailability): AvailabilityNotice {
  if (availability.status === "available") return { kind: "available" };
  if (availability.status === "unknown") {
    return { kind: "unknown", message: "BMW no ha respondido a tiempo; se volverá a comprobar al enviar la solicitud." };
  }

  const message = `No disponible en BMW Flat Rates${availability.code ? ` (${availability.code})` : ""}.`;
  const offer = describeSwapOffer(availability);
  if (offer.kind === "none") return { kind: "unavailable", message, baseTypeMessage: `${offer.reason.charAt(0).toUpperCase()}${offer.reason.slice(1)}.` };
  if (offer.identical) {
    return { kind: "unavailable", message, baseTypeMessage: `El tipo base ${offer.baseTypekey} está disponible y coincide en todas las características.`, suggestedTypekey: offer.baseTypekey };
  }
  return { kind: "unavailable", message, baseTypeMessage: `El tipo base ${offer.baseTypekey} está disponible pero difiere en: ${offer.differences.join(", ")}.`, suggestedTypekey: offer.baseTypekey };
}
