import { ObjectId } from "mongodb";

const HEX_OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * Strict ObjectId parsing. Unlike ObjectId.isValid, this rejects arbitrary
 * 12-character strings, so request input can't be coerced into an id.
 */
export function parseObjectId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) return value;
  if (typeof value === "string" && HEX_OBJECT_ID.test(value)) {
    return new ObjectId(value);
  }
  return null;
}

export function requireObjectId(value: unknown, field: string): ObjectId {
  const id = parseObjectId(value);
  if (!id) throw new TypeError(`Invalid ${field}`);
  return id;
}
