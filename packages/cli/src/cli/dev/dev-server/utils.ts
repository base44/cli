export function stripInternalFields<T extends Record<string, unknown>>(
  doc: T[],
): Omit<T, "_id">[];
export function stripInternalFields<T extends Record<string, unknown>>(
  doc: T,
): Omit<T, "_id">;
export function stripInternalFields<T extends Record<string, unknown>>(
  doc: T | T[],
): Omit<T, "_id"> | Omit<T, "_id">[] {
  if (Array.isArray(doc)) {
    return doc.map((d) => stripInternalFields(d));
  }
  const { _id, ...rest } = doc;
  return rest;
}

export const getNowISOTimestamp = () => {
  return new Date().toISOString().replace("Z", "000");
};
