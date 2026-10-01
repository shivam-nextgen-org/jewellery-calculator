import { getDb, oid } from "@/lib/mongo";

/**
 * Products are no longer saved or listed (pricing is calculate-and-export
 * only). Only the dashboard stats remain here.
 */
export async function getDashboardStats(userId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const db = await getDb();
  const userOid = oid(userId);

  const [todaysImports, defaults] = await Promise.all([
    db.collection("OcrImport").countDocuments({
      userId: userOid,
      createdAt: { $gte: startOfDay },
    }),
    db.collection("AppSetting").findOne({
      userId: userOid,
      key: "pricing_defaults",
    }),
  ]);

  const defaultsValue = (defaults?.value ?? {}) as { gold24kRate?: number };

  return {
    todaysImports,
    current24kGoldRate: defaultsValue.gold24kRate ?? 10000,
  };
}
