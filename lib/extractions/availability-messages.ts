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
  const base = availability.baseType;
  if (!base) return { kind: "unavailable", message };
  if (availability.suggestedTypekey) {
    return {
      kind: "unavailable",
      message,
      baseTypeMessage: `El tipo base ${availability.suggestedTypekey} está disponible y coincide en todas las características.`,
      suggestedTypekey: availability.suggestedTypekey,
    };
  }
  if (base.status === "unavailable") return { kind: "unavailable", message, baseTypeMessage: `El tipo base ${base.typekey} tampoco está disponible en BMW Flat Rates.` };
  if (base.status === "unknown") return { kind: "unavailable", message, baseTypeMessage: `No se ha podido comprobar el tipo base ${base.typekey}.` };
  const differences = base.differences.map((item) => `${ATTRIBUTE_LABELS[item.attribute] ?? item.attribute} (${displayedValue(item.attribute, item.requested)} → ${displayedValue(item.attribute, item.baseType)})`);
  return {
    kind: "unavailable",
    message,
    baseTypeMessage: `Tipo base ${base.typekey} disponible, pero difiere en: ${differences.join(", ") || "características no verificables"}. No se sugiere.`,
  };
}
