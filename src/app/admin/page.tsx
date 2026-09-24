import { AdminUsersPanel } from "@/components/admin/users-panel";
import { listAppUsers } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const users = await listAppUsers();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
          Super admin
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">
          Users
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Create workspace users and issue API keys. Each person only sees
          their jewellery data — login or API key, same access.
        </p>
      </div>
      <AdminUsersPanel
        initialUsers={users.map((user) => ({
          ...user,
          createdAt: user.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
