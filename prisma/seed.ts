import { PrismaClient, GoldMetalCode, GoldColorCode } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertByCode<
  T extends { findUnique: Function; create: Function; update: Function },
>(
  model: T,
  code: string,
  create: Record<string, unknown>,
  update: Record<string, unknown>,
) {
  const existing = await model.findUnique({ where: { code } });
  if (existing) {
    await model.update({ where: { code }, data: update });
    return;
  }
  await model.create({ data: create });
}

async function wipeBusinessData() {
  await prisma.pricingCalculationItem.deleteMany();
  await prisma.pricingCalculation.deleteMany();
  await prisma.jewelleryVariation.deleteMany();
  await prisma.jewelleryProduct.deleteMany();
  await prisma.ocrExtractedData.deleteMany();
  await prisma.ocrImport.deleteMany();
  await prisma.appSetting.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await wipeBusinessData();

  const metals = [
    { code: GoldMetalCode.GOLD, label: "Gold" },
    { code: GoldMetalCode.SILVER, label: "Silver" },
    { code: GoldMetalCode.PLATINUM, label: "Platinum" },
  ];
  for (const m of metals) {
    await upsertByCode(prisma.goldMetal, m.code, m, { label: m.label });
  }

  const purities = [
    { code: "24K", label: "24K", percentage: 100, sortOrder: 1 },
    { code: "22K", label: "22K", percentage: 91.67, sortOrder: 2 },
    { code: "18K", label: "18K", percentage: 75, sortOrder: 3 },
    { code: "14K", label: "14K", percentage: 58.33, sortOrder: 4 },
    { code: "10K", label: "10K", percentage: 41.67, sortOrder: 5 },
    { code: "9K", label: "9K", percentage: 37.5, sortOrder: 6 },
    { code: "925", label: "925 Silver", percentage: 92.5, sortOrder: 7 },
    { code: "999", label: "999 Silver", percentage: 99.9, sortOrder: 8 },
    { code: "958", label: "958 Silver", percentage: 95.8, sortOrder: 9 },
  ];
  for (const p of purities) {
    await upsertByCode(prisma.goldPurity, p.code, p, {
      label: p.label,
      percentage: p.percentage,
      sortOrder: p.sortOrder,
    });
  }

  const colors = [
    // Gold colours
    { code: GoldColorCode.YELLOW, label: "Yellow Gold" },
    { code: GoldColorCode.WHITE, label: "White Gold" },
    { code: GoldColorCode.ROSE, label: "Rose Gold" },
    // Silver colour
    { code: GoldColorCode.SILVER, label: "Sterling Silver" },
  ];
  for (const c of colors) {
    await upsertByCode(prisma.goldColor, c.code, c, { label: c.label });
  }

  const diamondTypes = [
    { code: "natural", label: "Natural" },
    { code: "lab-grown", label: "Lab Grown" },
  ];
  for (const t of diamondTypes) {
    await upsertByCode(prisma.diamondType, t.code, t, { label: t.label });
  }

  const shapes = [
    { code: "round", label: "Round" },
    { code: "princess", label: "Princess" },
    { code: "oval", label: "Oval" },
    { code: "pear", label: "Pear" },
    { code: "marquise", label: "Marquise" },
    { code: "emerald", label: "Emerald" },
    { code: "cushion", label: "Cushion" },
  ];
  for (const s of shapes) {
    await upsertByCode(prisma.diamondShape, s.code, s, { label: s.label });
  }

  const chargeTypes = [
    { code: "making", label: "Making" },
    { code: "certification", label: "Certification" },
    { code: "labour", label: "Labour" },
    { code: "polishing", label: "Polishing" },
    { code: "other", label: "Other" },
  ];
  for (const c of chargeTypes) {
    await upsertByCode(prisma.chargeType, c.code, c, { label: c.label });
  }

  const email = (
    process.env.SUPER_ADMIN_EMAIL ?? "admin@atelier.local"
  ).toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? "AtelierAdmin@2026";
  await prisma.user.create({
    data: {
      email,
      name: "Super Admin",
      passwordHash: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN",
      isActive: true,
    },
  });

  console.log(`Mongo seed complete. Super admin: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
