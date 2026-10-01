import { handleAdminDecision } from "@/lib/security/admin-device-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/security/devices/:id/reject — body { userId, password, reason } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleAdminDecision("REJECT", request, params);
}
