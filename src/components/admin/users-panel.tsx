"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "U";
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

export function AdminUsersPanel({
  initialUsers,
}: {
  initialUsers: AppUser[];
}) {
  const [users, setUsers] = useState<AppUser[]>(initialUsers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [keysByUser, setKeysByUser] = useState<Record<string, ApiKeyRow[]>>({});
  const [newToken, setNewToken] = useState<{
    userId: string;
    token: string;
  } | null>(null);
  const [keyName, setKeyName] = useState("Default");
  const [keyBusy, setKeyBusy] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function loadKeys(userId: string) {
    const res = await fetch(`/api/admin/users/${userId}/keys`);
    if (!res.ok) throw new Error("Could not load API keys");
    const keys = (await res.json()) as ApiKeyRow[];
    setKeysByUser((prev) => ({ ...prev, [userId]: keys }));
  }

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
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialUsers.length]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setCreateOpen(false);
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = (await res.json()) as AppUser & { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not create user");
      setUsers((prev) => [data, ...prev]);
      setName("");
      setEmail("");
      setPassword("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create user");
      // Reopen the dialog so the error is visible next to the form.
      setCreateOpen(true);
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
        await loadKeys(userId);
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

  const activeCount = users.filter((u) => u.isActive).length;
  const pwChecks = passwordChecks(password);
  const passwordValid =
    pwChecks.length && pwChecks.letter && pwChecks.number;

  return (
    <div className="space-y-5">
      {saving ? <PageLoader label="Creating user…" /> : null}
      {deleteBusy ? <PageLoader label="Deleting user…" /> : null}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Badge>{users.length} total</Badge>
          <Badge className="border-emerald-600/25 bg-emerald-600/10 text-emerald-800">
            {activeCount} active
          </Badge>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add user
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* User list */}
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
        <CardContent className="pt-0">
          {users.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ivory-deep text-champagne">
                <UserPlus className="h-6 w-6" />
              </span>
              <p className="text-sm text-muted-foreground">
                No users yet. Add your first workspace login.
              </p>
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Add user
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {users.map((user) => (
                <div key={user.id} className="py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className={
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold " +
                          (user.isActive
                            ? "bg-champagne-muted/60 text-charcoal"
                            : "bg-ivory-deep text-muted-foreground")
                        }
                      >
                        {initials(user.name)}
                      </span>
                      <div>
                        <p className="font-medium text-charcoal">{user.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className={
                          user.isActive
                            ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-800"
                            : "border-destructive/25 bg-destructive/10 text-destructive"
                        }
                      >
                        {user.isActive ? "Active" : "Disabled"}
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => toggleKeys(user.id)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {openUserId === user.id ? "Hide API" : "API access"}
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
                        variant="outline"
                        size="sm"
                        className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteUser(user)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>

                  {openUserId === user.id ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-border/80 bg-ivory/50 p-3">
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
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create user dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (open) {
            setName("");
            setEmail("");
            setPassword("");
          }
          if (!open) setFormError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              They can sign in and use the full jewellery workspace. Their data
              stays private. You can also issue an API key for the same access.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            {formError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="new-user-name">Name</Label>
              <Input
                id="new-user-name"
                name="new-user-name"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                name="new-user-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user-password">Password</Label>
              <PasswordInput
                id="new-user-password"
                name="new-user-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              <ul className="mt-1 space-y-0.5 text-xs">
                <PasswordRule
                  ok={pwChecks.length}
                  text="At least 8 characters"
                />
                <PasswordRule
                  ok={pwChecks.letter}
                  text="Contains a letter"
                />
                <PasswordRule
                  ok={pwChecks.number}
                  text="Contains a number"
                />
              </ul>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !passwordValid}>
                {saving ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete user confirmation dialog */}
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
