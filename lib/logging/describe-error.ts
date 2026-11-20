/** Only the error class and code are logged: messages and stacks from drivers can carry SQL, hosts or user data. */
export function describeError(error: unknown) {
  const { name, code } = (error !== null && typeof error === "object" ? error : {}) as { name?: unknown; code?: unknown };
  return {
    name: typeof name === "string" ? name : typeof error,
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
  };
}
