import { AdminUsersTable } from "@/components/admin/users-table";
import { AccessRestricted } from "@/components/security/access-restricted";
import { PageHeading } from "@/components/ui/page-heading";
import { getPageAccess } from "@/lib/auth/session";
import { listAppUsers } from "@/lib/auth/users";
import { getSecurityConfig } from "@/lib/security/config";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const access = await getPageAccess("ADMIN");
  if (access.kind !== "ok") return <AccessRestricted />;
  const users = await listAppUsers();
  const securityCenterEnabled =
    getSecurityConfig().flags.adminSecurityCenter === "on";

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Super admin"
        title="User management"
        description="Create workspace users, issue API keys, and manage access. Each person only sees their own jewellery data — login or API key, same access."
      />
      <AdminUsersTable
        initialUsers={users.map((user) => ({
          ...user,
          createdAt: user.createdAt.toISOString(),
        }))}
        securityCenterEnabled={securityCenterEnabled}
      />
    </div>
  );
}
