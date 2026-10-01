import { notFound } from "next/navigation";
import { CustomerSecurityDetailView } from "@/components/admin/security-center/customer-detail";
import { AccessRestricted } from "@/components/security/access-restricted";
import { getPageAccess } from "@/lib/auth/session";
import { getSecurityConfig } from "@/lib/security/config";
import { parseObjectId } from "@/lib/security/ids";

export const dynamic = "force-dynamic";

export default async function AdminCustomerSecurityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (getSecurityConfig().flags.adminSecurityCenter !== "on") notFound();
  const access = await getPageAccess("ADMIN");
  if (access.kind !== "ok") return <AccessRestricted />;
  const { id } = await params;
  const userId = parseObjectId(id);
  if (!userId) notFound();
  return (
    <div>
      <CustomerSecurityDetailView userId={userId.toHexString()} />
    </div>
  );
}
