import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import {
  db,
  maintenanceTable,
  type MaintenanceReason,
  type MaintenanceService,
} from "@workspace/db";

export type MaintenanceRecord = {
  service: MaintenanceService;
  message: string;
  reason: MaintenanceReason;
  endsAt: Date | null;
  updatedByUserId: string;
  updatedAt: Date;
};

export async function getActiveMaintenance(
  service: MaintenanceService,
  now = new Date(),
): Promise<MaintenanceRecord | null> {
  const [record] = await db
    .select()
    .from(maintenanceTable)
    .where(
      and(
        eq(maintenanceTable.service, service),
        or(isNull(maintenanceTable.endsAt), gt(maintenanceTable.endsAt, now)),
      ),
    )
    .limit(1);

  return record ?? null;
}

export async function getActiveMaintenances(
  now = new Date(),
): Promise<MaintenanceRecord[]> {
  return db
    .select()
    .from(maintenanceTable)
    .where(
      or(
        isNull(maintenanceTable.endsAt),
        gt(maintenanceTable.endsAt, now),
      ),
    );
}

export async function setMaintenance(
  service: MaintenanceService,
  values: {
    message: string;
    reason: MaintenanceReason;
    endsAt: Date | null;
    updatedByUserId: string;
  },
): Promise<void> {
  await db
    .insert(maintenanceTable)
    .values({ service, ...values })
    .onConflictDoUpdate({
      target: maintenanceTable.service,
      set: { ...values, updatedAt: new Date() },
    });
}

export function maintenanceReasonLabel(reason: MaintenanceReason): string {
  const labels: Record<MaintenanceReason, string> = {
    "mise-a-jour": "Mise à jour",
    "incident-technique": "Incident technique",
    "maintenance-preventive": "Maintenance préventive",
    autre: "Autre",
  };
  return labels[reason];
}

export async function clearMaintenance(
  services: MaintenanceService[],
): Promise<void> {
  if (services.length === 0) {
    return;
  }
  await db
    .delete(maintenanceTable)
    .where(inArray(maintenanceTable.service, services));
}

export async function clearExpiredMaintenance(
  now = new Date(),
): Promise<MaintenanceService[]> {
  const expired = await db
    .delete(maintenanceTable)
    .where(lte(maintenanceTable.endsAt, now))
    .returning({ service: maintenanceTable.service });

  return expired.map((record) => record.service);
}
