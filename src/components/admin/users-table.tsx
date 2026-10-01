"use client";

import Link from "next/link";
import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShieldHalf,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { PageLoader } from "@/components/brand/video-loader";

type AppUser = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  createdAt: string;
};

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  token?: string;
};

const PAGE_SIZE = 8;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "U";
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function passwordChecks(password: string) {
  return {
    length: password.length >= 8,
    letter: /[A-Za-z]/.test(password),
    number: /[0-9]/.test(password),
  };
}

function PasswordRule({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li
      className={
        "flex items-center gap-1.5 " +
        (ok ? "text-emerald-700" : "text-muted-foreground")
      }
    >
      {ok ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <X className="h-3.5 w-3.5 opacity-60" />
      )}
      {text}
    </li>
  );
}

export function AdminUsersTable({
  initialUsers,
  securityCenterEnabled,
}: {
  initialUsers: AppUser[];
  securityCenterEnabled: boolean;
}) {
  const [users, setUsers] = useState<AppUser[]>(initialUsers);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Create / edit dialog state.
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // API keys drawer + delete confirm.
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [keysByUser, setKeysByUser] = useState<Record<string, ApiKeyRow[]>>({});
  const [newToken, setNewToken] = useState<{ userId: string; token: string } | null>(null);
  const [keyName, setKeyName] = useState("Default");
  const [keyBusy, setKeyBusy] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (initialUsers.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/users");
        if (!res.ok) throw new Error("Could not load users");
        const rows = (await res.json()) as AppUser[];
        if (!cancelled) setUsers(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialUsers.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const activeCount = users.filter((u) => u.isActive).length;

  const pwChecks = passwordChecks(password);
  const passwordValid = pwChecks.length && pwChecks.letter && pwChecks.number;

  function openCreate() {
    setDialog("create");
    setEditingId(null);
    setName("");
    setEmail("");
    setPassword("");
    setFormError(null);
  }

  function openEdit(user: AppUser) {
    setDialog("edit");
    setEditingId(user.id);
    setName(user.name);
    setEmail(user.email);
    setPassword("");
    setFormError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (dialog === "edit" && editingId) {
        const res = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, name }),
        });
        const data = (await res.json()) as AppUser & { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not update user");
        setUsers((prev) => prev.map((u) => (u.id === data.id ? data : u)));
      } else {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        const data = (await res.json()) as AppUser & { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not create user");
        setUsers((prev) => [data, ...prev]);
      }
      setDialog(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: AppUser) {
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
    });
    const data = (await res.json()) as AppUser & { error?: string };
    if (!res.ok) {
      setError(data.error || "Could not update user");
      return;
    }
    setUsers((prev) => prev.map((row) => (row.id === data.id ? data : row)));
  }

  async function confirmDelete() {
    if (!deleteUser) return;
    const target = deleteUser;
    setDeleteUser(null);
    setDeleteBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not delete user");
      setUsers((prev) => prev.filter((row) => row.id !== target.id));
      if (openUserId === target.id) setOpenUserId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete user");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function toggleKeys(userId: string) {
    if (openUserId === userId) {
      setOpenUserId(null);
      return;
    }
    setOpenUserId(userId);
    setNewToken(null);
    if (!keysByUser[userId]) {
      try {
        const res = await fetch(`/api/admin/users/${userId}/keys`);
        if (!res.ok) throw new Error("Could not load API keys");
        const keys = (await res.json()) as ApiKeyRow[];
        setKeysByUser((prev) => ({ ...prev, [userId]: keys }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load keys");
      }
    }
  }

  async function createKey(userId: string) {
    setKeyBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName }),
      });
      const data = (await res.json()) as ApiKeyRow & { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not create API key");
      setKeysByUser((prev) => ({
        ...prev,
        [userId]: [data, ...(prev[userId] ?? [])],
      }));
      if (data.token) setNewToken({ userId, token: data.token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create API key");
    } finally {
      setKeyBusy(false);
    }
  }

  async function revokeKey(userId: string, keyId: string) {
    setKeyBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/keys`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId }),
      });
      const data = (await res.json()) as ApiKeyRow & { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not revoke key");
      setKeysByUser((prev) => ({
        ...prev,
        [userId]: (prev[userId] ?? []).map((row) =>
          row.id === data.id ? data : row,
        ),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke key");
    } finally {
      setKeyBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {saving ? (
        <PageLoader label={dialog === "edit" ? "Saving user…" : "Creating user…"} />
      ) : null}
      {deleteBusy ? <PageLoader label="Deleting user…" /> : null}

      {/* Toolbar: search + counts + add */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search name or email"
            className="pl-9"
            aria-label="Search users"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge>{users.length} total</Badge>
            <Badge className="border-emerald-600/25 bg-emerald-600/10 text-emerald-800">
              {activeCount} active
            </Badge>
          </div>
          <Button type="button" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add user
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader className="border-b border-border/70">
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Workspace users
          </CardTitle>
          <CardDescription>
            Each person only sees their own jewellery data, whether they sign in
            or use an API key.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ivory-deep text-champagne">
                <UserPlus className="h-6 w-6" />
              </span>
              <p className="text-sm text-muted-foreground">
                {query ? "No users match your search." : "No users yet."}
              </p>
              {!query ? (
                <Button type="button" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Add user
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-ivory-deep/40 text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">
                      Created
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {pageRows.map((user) => (
                    <Fragment key={user.id}>
                      <tr className="align-middle">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span
                              className={
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
                                (user.isActive
                                  ? "bg-champagne-muted/60 text-charcoal"
                                  : "bg-ivory-deep text-muted-foreground")
                              }
                            >
                              {initials(user.name)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-charcoal">
                                {user.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {user.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={
                              user.isActive
                                ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-800"
                                : "border-destructive/25 bg-destructive/10 text-destructive"
                            }
                          >
                            {user.isActive ? "Active" : "Disabled"}
                          </Badge>
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                          {shortDate(user.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {securityCenterEnabled ? (
                              <Button
                                asChild
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="Security & limits"
                              >
                                <Link href={`/admin/security/${user.id}`}>
                                  <ShieldHalf className="h-3.5 w-3.5" />
                                  Security
                                </Link>
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleKeys(user.id)}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              {openUserId === user.id ? "Hide API" : "API"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(user)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => toggleActive(user)}
                            >
                              {user.isActive ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeleteUser(user)}
                              aria-label={`Delete ${user.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {openUserId === user.id ? (
                        <tr>
                          <td colSpan={4} className="px-4 pb-4">
                            <div className="space-y-3 rounded-lg border border-border/80 bg-ivory/50 p-3">
                              <div className="flex items-center gap-2 text-xs font-medium text-charcoal-muted">
                                <ShieldCheck className="h-3.5 w-3.5 text-champagne" />
                                API keys let external tools act as this user.
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                                <div className="flex-1 space-y-1.5">
                                  <Label htmlFor={`key-name-${user.id}`}>
                                    Key name
                                  </Label>
                                  <Input
                                    id={`key-name-${user.id}`}
                                    value={keyName}
                                    onChange={(e) => setKeyName(e.target.value)}
                                  />
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={keyBusy || !user.isActive}
                                  onClick={() => createKey(user.id)}
                                >
                                  Create API key
                                </Button>
                              </div>

                              {newToken?.userId === user.id ? (
                                <div className="rounded-md border border-champagne/40 bg-champagne-muted/30 p-3">
                                  <p className="text-xs font-medium text-charcoal">
                                    Copy this key now. It will not be shown again.
                                  </p>
                                  <code className="mt-2 block break-all text-xs text-charcoal">
                                    {newToken.token}
                                  </code>
                                </div>
                              ) : null}

                              {(keysByUser[user.id] ?? []).length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  No API keys yet.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {(keysByUser[user.id] ?? []).map((key) => (
                                    <div
                                      key={key.id}
                                      className="flex flex-col gap-2 rounded-md border border-border/70 bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                      <div>
                                        <p className="text-sm font-medium text-charcoal">
                                          {key.name}{" "}
                                          <span className="font-mono text-xs text-muted-foreground">
                                            {key.prefix}…
                                          </span>
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {key.revokedAt
                                            ? "Revoked"
                                            : key.lastUsedAt
                                              ? `Last used ${new Date(key.lastUsedAt).toLocaleString("en-IN")}`
                                              : "Never used"}
                                        </p>
                                      </div>
                                      {!key.revokedAt ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          disabled={keyBusy}
                                          onClick={() => revokeKey(user.id, key.id)}
                                        >
                                          Revoke
                                        </Button>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {filtered.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <span className="text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Create / edit dialog */}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setFormError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "edit" ? "Edit user" : "Create user"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "edit"
                ? "Update this person's name. Email is their login and can't be changed here."
                : "They can sign in and use the full jewellery workspace. Their data stays private."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            {formError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="user-name">Name</Label>
              <Input
                id="user-name"
                name="user-name"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                name="user-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={dialog === "edit"}
              />
            </div>
            {dialog === "create" ? (
              <div className="space-y-1.5">
                <Label htmlFor="user-password">Password</Label>
                <PasswordInput
                  id="user-password"
                  name="user-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <ul className="mt-1 space-y-0.5 text-xs">
                  <PasswordRule ok={pwChecks.length} text="At least 8 characters" />
                  <PasswordRule ok={pwChecks.letter} text="Contains a letter" />
                  <PasswordRule ok={pwChecks.number} text="Contains a number" />
                </ul>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  saving ||
                  !name.trim() ||
                  (dialog === "create" && (!email.trim() || !passwordValid))
                }
              >
                {saving
                  ? "Saving…"
                  : dialog === "edit"
                    ? "Save changes"
                    : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteUser !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteUser(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <span className="font-medium text-charcoal">
                {deleteUser?.name}
              </span>{" "}
              ({deleteUser?.email}) and all of their jewellery data — products,
              variations, pricing history, OCR imports, settings and API keys.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteUser(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-destructive text-ivory hover:bg-destructive/90"
              onClick={confirmDelete}
              disabled={deleteBusy}
            >
              {deleteBusy ? "Deleting…" : "Delete user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
