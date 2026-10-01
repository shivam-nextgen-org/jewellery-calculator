import { Clock, ShieldAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DeviceNotice } from "@/lib/auth/session";

function formatDeadline(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ENDED_COPY: Record<"EXPIRED" | "REJECTED" | "REVOKED" | "SIGNED_IN_ELSEWHERE", string> = {
  SIGNED_IN_ELSEWHERE:
    "Your account was signed in on another device, so this session ended. Only one active session is allowed. Sign out and sign in again to continue here.",
  EXPIRED:
    "The approval request for this device expired. Sign out and sign in again to send a new request.",
  REJECTED:
    "Your administrator declined access from this device. Use one of your approved devices, or contact your administrator.",
  REVOKED:
    "This device was removed from your account. Sign out and sign in again, or use one of your approved devices.",
};

/**
 * Shown by protected pages when authorize() denies a signed-in user.
 * With a device notice it explains the waiting-for-approval state; otherwise
 * it stays generic and doesn't reveal which check failed.
 */
export function AccessRestricted({ device }: { device?: DeviceNotice } = {}) {
  if (device?.state === "RESTRICTED") {
    return (
      <Card role="alert">
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            <CardTitle>Account temporarily restricted</CardTitle>
          </div>
          <CardDescription>
            {device.pendingReview
              ? "Unusual activity was detected on this account, so access is paused until your administrator reviews it."
              : "Unusual activity was detected on this account, so access is paused for a while."}{" "}
            {device.until
              ? `Access returns automatically by ${formatDeadline(device.until)}.`
              : null}{" "}
            Contact your administrator if you need access sooner.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (device?.state === "PENDING") {
    return (
      <Card role="status" aria-live="polite">
        <CardHeader>
          <div className="flex items-center gap-2 text-champagne">
            <Clock className="h-4 w-4" aria-hidden="true" />
            <CardDescription className="text-champagne">New device</CardDescription>
          </div>
          <CardTitle>{device.title}</CardTitle>
          <CardDescription>{device.instructions}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Reference code:{" "}
            <span className="font-mono text-base font-semibold tracking-wider text-charcoal">
              {device.referenceCode}
            </span>
          </p>
          <p className="text-muted-foreground">
            Request expires {formatDeadline(device.expiresAt)}. Reload this page after
            approval.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card role="alert">
      <CardHeader>
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          <CardTitle>Access restricted</CardTitle>
        </div>
        <CardDescription>
          {device
            ? ENDED_COPY[device.state]
            : "This account can't load this page right now. Sign out and sign in again, or contact your administrator if this keeps happening."}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
