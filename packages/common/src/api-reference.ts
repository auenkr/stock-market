/** Internal documentation is opt-in, independent of route authorization. */
export function visibleApiReference<T extends { paths: Record<string, unknown> }>(spec: T, environment?: string): T {
  if (environment === "dev") return spec;
  const document = spec as T & {
    tags?: { name: string }[];
    "x-user-journey"?: { id: string }[];
    "x-data-conventions"?: string[];
    components?: { schemas?: Record<string, unknown> };
    "x-coverage-summary"?: Record<string, unknown>;
  };
  const operation = (entry: unknown) => (entry as { get?: { "x-use-case"?: string; "x-api-style"?: string; "x-alias"?: boolean; "x-coverage"?: string } }).get;
  const paths = Object.fromEntries(Object.entries(spec.paths).filter(([, entry]) => operation(entry)?.["x-use-case"] !== "internal"));
  const schemas = document.components?.schemas ?? {};
  const referenced = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const ref = (value as { $ref?: string }).$ref;
    if (ref?.startsWith("#/components/schemas/")) {
      const name = ref.slice("#/components/schemas/".length);
      if (!referenced.has(name)) { referenced.add(name); visit(schemas[name]); }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(paths);
  const canonical = Object.values(paths).map(operation).filter((op) => op?.["x-api-style"] === "personal" && !op["x-alias"]);
  return {
    ...spec, paths,
    tags: document.tags?.filter((tag) => tag.name !== "Internal"),
    "x-user-journey": document["x-user-journey"]?.filter((group) => group.id !== "internal"),
    "x-data-conventions": document["x-data-conventions"]?.filter((note) => !note.startsWith("Internal ")),
    "x-coverage-summary": { ...document["x-coverage-summary"], total: canonical.length, partial: canonical.filter((op) => op?.["x-coverage"] === "partial").length, unavailable: canonical.filter((op) => op?.["x-coverage"] === "unavailable").length, excluded: 0 },
    components: { ...document.components, schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => referenced.has(name))) },
  } as T;
}
