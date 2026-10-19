import { getDb, oid } from "@/lib/mongo";
import {
  DEFAULT_ETSY_COMMISSION,
  parseEtsyCommission,
  type EtsyCommissionSettings,
} from "@/types/etsy";

export const ETSY_SETTINGS_KEY = "etsy_commission";

export async function getUserEtsyEnabled(userId: string): Promise<boolean> {
  const db = await getDb();
  const user = await db.collection("User").findOne(
    { _id: oid(userId) },
    { projection: { etsyEnabled: 1 } },
  );
  return Boolean(user?.etsyEnabled);
}

export async function getEtsyCommission(
  userId: string,
): Promise<EtsyCommissionSettings> {
  const db = await getDb();
  const row = await db.collection("AppSetting").findOne({
    userId: oid(userId),
    key: ETSY_SETTINGS_KEY,
  });
  if (!row) return structuredClone(DEFAULT_ETSY_COMMISSION);
  return parseEtsyCommission(row.value);
}

export async function setEtsyCommission(
  userId: string,
  settings: EtsyCommissionSettings,
): Promise<EtsyCommissionSettings> {
  const db = await getDb();
  const enabled = await getUserEtsyEnabled(userId);
  if (!enabled) {
    throw new Error("Etsy marketplace is not enabled for this account.");
  }
  const parsed = parseEtsyCommission(settings);
  const now = new Date();
  await db.collection("AppSetting").updateOne(
    { userId: oid(userId), key: ETSY_SETTINGS_KEY },
    {
      $set: { value: parsed, updatedAt: now },
      $setOnInsert: {
        userId: oid(userId),
        key: ETSY_SETTINGS_KEY,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  return parsed;
}
