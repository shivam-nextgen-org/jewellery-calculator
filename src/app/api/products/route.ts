import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import {
  listProducts,
  saveJewelleryProduct,
  type SaveProductPayload,
} from "@/lib/services/products";
import { decimalToNumber } from "@/lib/services/settings";

export async function GET() {
  try {
    const session = await requireUser();
    const products = await listProducts(session.id);
    return NextResponse.json(
      products.map((p) => ({
        id: p.id,
        designNo: p.designNo,
        category: p.category,
        variationCount: p.variationCount,
        priceMin: p.priceMin ? decimalToNumber(p.priceMin) : 0,
        priceMax: p.priceMax ? decimalToNumber(p.priceMax) : 0,
        netWeight: decimalToNumber(p.netWeight),
        diamondWeight: decimalToNumber(p.diamondWeight),
        updatedAt: p.updatedAt.toISOString(),
        createdAt: p.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Failed to list products" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const body = (await request.json()) as SaveProductPayload;
    if (!body?.extracted?.designNo || !body?.extracted?.netWeight) {
      return NextResponse.json(
        { error: "Design number and net weight are required" },
        { status: 400 },
      );
    }
    const result = await saveJewelleryProduct(body, session.id);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Failed to save product";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
