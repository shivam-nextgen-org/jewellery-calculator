import type { Db } from "mongodb";
import type { DeviceDoc, DeviceVerificationMethod } from "@/lib/security/collections";
import type { DeviceVerifierId, SecurityConfig } from "@/lib/security/config";

/**
 * Replaceable new-device verification mechanism (ADR-013 / G3).
 *
 * The device/session/risk code never depends on how verification happens.
 * A verifier only decides:
 *   - what happens when a pending device is created (`onPendingDevice`),
 *   - what the customer is told while it waits (`customerState`),
 *   - which method is stamped on the device once trusted (`method`).
 *
 * Completion always goes through the same state transition,
 * `trustPendingDevice()` in ./device-verification.ts, which enforces
 * ownership, expiry and atomicity. A future email-OTP verifier would send a
 * code in `onPendingDevice` and call `trustPendingDevice` after checking it;
 * nothing else changes.
 */
export interface DeviceVerifier {
  readonly id: DeviceVerifierId;
  readonly method: DeviceVerificationMethod;
  onPendingDevice(db: Db, device: DeviceDoc): Promise<void>;
  customerState(): { title: string; instructions: string };
}

/** Launch mechanism: an administrator approves the device. The queue is the database. */
export const adminApprovalVerifier: DeviceVerifier = {
  id: "admin-approval",
  method: "ADMIN_APPROVAL",
  async onPendingDevice() {
    // Nothing to send: pending devices appear in the admin approval queue.
  },
  customerState() {
    return {
      title: "Waiting for approval",
      instructions:
        "This device is new to your account. Ask your administrator to approve it and quote the reference code below. Requests expire after 24 hours.",
    };
  },
};

const VERIFIERS: Record<DeviceVerifierId, DeviceVerifier> = {
  "admin-approval": adminApprovalVerifier,
};

export function getDeviceVerifier(config: SecurityConfig): DeviceVerifier {
  return VERIFIERS[config.device.verifier];
}
