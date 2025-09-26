export function safeJsonStringify(obj: Record<string, unknown>) {
  return JSON.stringify(obj, (key, value) => {
    // Check if the value is a BigInt
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  });
}
