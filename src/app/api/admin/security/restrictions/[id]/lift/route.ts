import { handleLift } from "@/lib/security/admin-restriction-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/security/restrictions/:id/lift — body { userId, password, reason } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleLift(request, params);
}
