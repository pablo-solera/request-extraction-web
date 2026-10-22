export function pluralizeModels(count: number) {
  return `${count} ${count === 1 ? "modelo" : "modelos"}`;
}
