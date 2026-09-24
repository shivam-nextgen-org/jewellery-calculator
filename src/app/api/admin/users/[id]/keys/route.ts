import { NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth/session";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/lib/auth/api-keys";

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message =
    error instanceof Error ? error.message : "Request failed";
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    return NextResponse.json(await listApiKeys(id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      name?: string;
    } | null;
    const key = await createApiKey(id, body?.name ?? "Default");
    return NextResponse.json(key, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await request.json()) as { keyId?: string };
    if (!body.keyId) {
      return NextResponse.json({ error: "keyId is required" }, { status: 400 });
    }
    return NextResponse.json(await revokeApiKey(id, body.keyId));
  } catch (error) {
    return fail(error);
  }
}
