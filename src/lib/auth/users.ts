import { getDb, idOf, ObjectId, oid } from "@/lib/mongo";
import { hashPassword, validatePassword } from "@/lib/auth/password";
import { deleteSecurityRecordsForUser } from "@/lib/security/device-registry";

function mapUser(row: {
  _id: ObjectId;
  email: string;
  name: string;
  isActive: boolean;
  etsyEnabled?: boolean;
  createdAt: Date;
}) {
  return {
    id: idOf(row._id),
    email: row.email,
    name: row.name,
    isActive: row.isActive,
    etsyEnabled: Boolean(row.etsyEnabled),
    createdAt: row.createdAt,
  };
}

export async function listAppUsers() {
  const db = await getDb();
  const rows = await db
    .collection("User")
    .find({ role: "USER" })
    .sort({ createdAt: -1 })
    .project({ email: 1, name: 1, isActive: 1, etsyEnabled: 1, createdAt: 1 })
    .toArray();
  return rows.map((row) =>
    mapUser(
      row as {
        _id: ObjectId;
        email: string;
        name: string;
        isActive: boolean;
        etsyEnabled?: boolean;
        createdAt: Date;
      },
    ),
  );
}

export async function createAppUser(input: {
  name: string;
  email: string;
  password: string;
  etsyEnabled?: boolean;
}) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const passwordError = validatePassword(input.password);
  if (!name) throw new Error("Name is required.");
  if (!email.includes("@")) throw new Error("A valid email is required.");
  if (passwordError) throw new Error(passwordError);

  const db = await getDb();
  const existing = await db.collection("User").findOne({ email });
  if (existing) throw new Error("A user with this email already exists.");

  const now = new Date();
  const doc = {
    _id: new ObjectId(),
    name,
    email,
    passwordHash: await hashPassword(input.password),
    role: "USER",
    isActive: true,
    etsyEnabled: Boolean(input.etsyEnabled),
    createdAt: now,
    updatedAt: now,
  };
  await db.collection("User").insertOne(doc);
  return mapUser(doc);
}

export async function updateAppUser(
  id: string,
  input: { name: string; etsyEnabled?: boolean },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const db = await getDb();
  const user = await db.collection("User").findOne({ _id: oid(id) });
  if (!user || user.role !== "USER") {
    throw new Error("User not found.");
  }
  const etsyEnabled =
    typeof input.etsyEnabled === "boolean"
      ? input.etsyEnabled
      : Boolean(user.etsyEnabled);
  await db.collection("User").updateOne(
    { _id: oid(id) },
    { $set: { name, etsyEnabled, updatedAt: new Date() } },
  );
  return {
    id,
    email: user.email as string,
    name,
    isActive: user.isActive as boolean,
    etsyEnabled,
    createdAt: user.createdAt as Date,
  };
}

export async function setUserActive(id: string, isActive: boolean) {
  const db = await getDb();
  const user = await db.collection("User").findOne({ _id: oid(id) });
  if (!user || user.role !== "USER") {
    throw new Error("User not found.");
  }
  await db.collection("User").updateOne(
    { _id: oid(id) },
    { $set: { isActive, updatedAt: new Date() } },
  );
  return {
    id,
    email: user.email as string,
    name: user.name as string,
    isActive,
    etsyEnabled: Boolean(user.etsyEnabled),
    createdAt: user.createdAt as Date,
  };
}

export async function deleteAppUser(id: string) {
  const db = await getDb();
  const userId = oid(id);
  const user = await db.collection("User").findOne({ _id: userId });
  if (!user || user.role !== "USER") {
    throw new Error("User not found.");
  }

  const [calcs, products, imports, profiles] = await Promise.all([
    db
      .collection("PricingCalculation")
      .find({ userId }, { projection: { _id: 1 } })
      .toArray(),
    db
      .collection("JewelleryProduct")
      .find({ userId }, { projection: { _id: 1 } })
      .toArray(),
    db
      .collection("OcrImport")
      .find({ userId }, { projection: { _id: 1 } })
      .toArray(),
    db
      .collection("PricingProfile")
      .find({ userId }, { projection: { _id: 1 } })
      .toArray(),
  ]);
  const calcIds = calcs.map((c) => c._id);
  const productIds = products.map((p) => p._id);
  const importIds = imports.map((i) => i._id);
  const profileIds = profiles.map((p) => p._id);

  if (calcIds.length > 0) {
    await db
      .collection("PricingCalculationItem")
      .deleteMany({ calculationId: { $in: calcIds } });
  }
  if (productIds.length > 0) {
    await db
      .collection("JewelleryVariation")
      .deleteMany({ productId: { $in: productIds } });
  }
  if (importIds.length > 0) {
    await db
      .collection("OcrExtractedData")
      .deleteMany({ importId: { $in: importIds } });
  }
  if (profileIds.length > 0) {
    await db
      .collection("PricingProfileRevision")
      .deleteMany({ profileId: { $in: profileIds } });
  }

  await Promise.all([
    db.collection("PricingCalculation").deleteMany({ userId }),
    db.collection("JewelleryProduct").deleteMany({ userId }),
    db.collection("OcrImport").deleteMany({ userId }),
    db.collection("AppSetting").deleteMany({ userId }),
    db.collection("ApiKey").deleteMany({ userId }),
    db.collection("PricingProfile").deleteMany({ userId }),
    deleteSecurityRecordsForUser(db, userId),
  ]);

  await db.collection("User").deleteOne({ _id: userId });

  return { id, deleted: true };
}

export async function findUserByEmail(email: string) {
  const db = await getDb();
  return db.collection("User").findOne({ email: email.toLowerCase() });
}
