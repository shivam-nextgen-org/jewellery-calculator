import { notFound } from "next/navigation";
import { SecurityCustomerList } from "@/components/admin/security-center/customer-list";
import { AccessRestricted } from "@/components/security/access-restricted";
import { PageHeading } from "@/components/ui/page-heading";
import { getPageAccess } from "@/lib/auth/session";
import { getSecurityConfig } from "@/lib/security/config";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  if (getSecurityConfig().flags.adminSecurityCenter !== "on") notFound();
  const access = await getPageAccess("ADMIN");
  if (access.kind !== "ok") return <AccessRestricted />;
  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Super admin"
        title="Security center"
        description="Per-customer devices, sessions, risk, restrictions and limits."
      />
      <SecurityCustomerList />
    </div>
  );
}
