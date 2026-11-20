const spanishDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Madrid",
});

const spanishDateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Madrid",
});

const spanishTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Madrid",
});

function asDate(value: Date | string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00.000Z`);
  return value instanceof Date ? value : new Date(value);
}

export function formatSpanishDate(value: Date | string) {
  return spanishDateFormatter.format(asDate(value));
}

export function formatSpanishTime(value: Date | string) {
  return spanishTimeFormatter.format(asDate(value));
}

export function formatSpanishDateTime(value: Date | string) {
  return spanishDateTimeFormatter.format(asDate(value));
}
