import { DataTypes, Model, Sequelize, type ModelStatic } from "sequelize";

/**
 * The Sequelize layer is intentionally model-only: schema ownership remains with
 * Drizzle migrations. Importing this module never synchronizes or alters a schema.
 */
const databaseUrl = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to initialize Sequelize");

export const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  logging: false,
});

const id = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true };
const createdAt = { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "created_at" };
const date = (field: string, required = false) => ({ type: DataTypes.DATE, allowNull: !required, field });
const text = (field: string, required = false, defaultValue?: string) => ({
  type: DataTypes.TEXT, allowNull: !required, field, ...(defaultValue === undefined ? {} : { defaultValue }),
});
const integer = (field: string, required = false, defaultValue?: number) => ({
  type: DataTypes.INTEGER, allowNull: !required, field, ...(defaultValue === undefined ? {} : { defaultValue }),
});
const bool = (field: string, required = false, defaultValue?: boolean) => ({
  type: DataTypes.BOOLEAN, allowNull: !required, field, ...(defaultValue === undefined ? {} : { defaultValue }),
});
const decimal = (field: string, precision: number, scale: number, required = false) => ({
  type: DataTypes.DECIMAL(precision, scale), allowNull: !required, field,
});
const real = (field: string, required = false) => ({ type: DataTypes.REAL, allowNull: !required, field });
const json = (field: string, required = false, defaultValue?: object) => ({
  type: DataTypes.JSONB, allowNull: !required, field, ...(defaultValue === undefined ? {} : { defaultValue }),
});
const ref = (model: string, key = "id", onDelete?: string) => ({ model, key, ...(onDelete ? { onDelete } : {}) });

type RuntimeModel = ModelStatic<any>;

function define(name: string, tableName: string, attributes: Record<string, any>, indexes?: any[]): RuntimeModel {
  const DynamicModel = class extends Model<any, any> {};
  DynamicModel.init(attributes, {
    sequelize, modelName: name, tableName, timestamps: false, indexes,
  });
  return DynamicModel as unknown as RuntimeModel;
}

export const Node = define("Node", "nodes", {
  id, name: text("name", true), location: text("location", true), role: text("role", true), createdAt,
});
export const Equipment = define("Equipment", "equipment", {
  id, nodeId: { ...integer("node_id", true), references: ref("Node", "id", "CASCADE") },
  ip: text("ip", true), username: text("username", true), password: text("password", true),
  model: text("model", true), connectionType: text("connection_type", true, "mikrotik_routeros"),
  equipmentRole: text("equipment_role", true, "ap_distributor"),
  parentEquipmentId: { ...integer("parent_equipment_id"), references: ref("Equipment", "id", "SET NULL") },
  parentCapacityLimit: text("parent_capacity_limit"), snmpCommunity: text("snmp_community"), apiPort: integer("api_port"),
  latitude: decimal("latitude", 10, 7), longitude: decimal("longitude", 10, 7),
  altitudeMeters: decimal("altitude_meters", 8, 2), locationSource: text("location_source"),
  locationAccuracyMeters: decimal("location_accuracy_meters", 8, 2),
  lastSeenStatus: text("last_seen_status", true, "UNKNOWN"), lastCheckedAt: date("last_checked_at"), createdAt,
});
export const User = define("User", "users", {
  id, username: { ...text("username", true), unique: true }, passwordHash: text("password_hash", true),
  role: text("role", true, "operator"), isActive: bool("is_active", true, true), failedLoginAttempts: integer("failed_login_attempts", true, 0),
  lockedUntil: date("locked_until"), createdAt,
});
export const Client = define("Client", "clients", {
  id, equipmentId: { ...integer("equipment_id", true), references: ref("Equipment", "id", "CASCADE") },
  mac: text("mac", true), ip: text("ip"), name: text("name", true), planLimit: text("plan_limit", true),
  status: text("status", true, "ACTIVE"), lastSeenDbm: text("last_seen_dbm"), paymentStatus: text("payment_status", true, "PAID"),
  dhcpServer: text("dhcp_server"), dhcpPool: text("dhcp_pool"), monthlyFee: { ...decimal("monthly_fee", 10, 2), defaultValue: "0" },
  dueDate: date("due_date"), lastPaymentDate: date("last_payment_date"), contractReference: text("contract_reference"),
  contractNotes: text("contract_notes"), installationDate: date("installation_date"), installationAddress: text("installation_address"),
  assignedTechnicianId: { ...integer("assigned_technician_id"), references: ref("User", "id", "SET NULL") },
  accessPointEquipmentId: { ...integer("access_point_equipment_id"), references: ref("Equipment", "id", "SET NULL") }, createdAt,
});
export const ClientChangeHistory = define("ClientChangeHistory", "client_change_history", {
  id, clientId: { ...integer("client_id", true), references: ref("Client", "id", "CASCADE") },
  changedByUserId: { ...integer("changed_by_user_id"), references: ref("User", "id", "SET NULL") },
  changeType: text("change_type", true), reason: text("reason"), previousData: json("previous_data", true, {}),
  newData: json("new_data", true, {}), createdAt,
});
export const ClientContract = define("ClientContract", "client_contracts", {
  id, clientId: { ...integer("client_id", true), references: ref("Client", "id", "CASCADE") }, version: integer("version", true),
  status: text("status", true, "PENDING"), isCurrent: bool("is_current", true, false), originalName: text("original_name", true),
  mimeType: text("mime_type", true), sizeBytes: integer("size_bytes", true), sha256: text("sha256", true), storagePath: text("storage_path", true),
  uploadedByUserId: { ...integer("uploaded_by_user_id"), references: ref("User", "id", "SET NULL") },
  reviewedByUserId: { ...integer("reviewed_by_user_id"), references: ref("User", "id", "SET NULL") },
  reviewReason: text("review_reason"), uploadedAt: { ...date("uploaded_at", true), defaultValue: DataTypes.NOW }, reviewedAt: date("reviewed_at"),
}, [{ name: "client_contracts_client_version_idx", unique: true, fields: ["clientId", "version"] },
  { name: "client_contracts_current_idx", unique: true, fields: ["clientId"], where: { is_current: true } }]);

export const Organization = define("Organization", "organizations", {
  id, name: text("name", true), slug: { ...text("slug", true), unique: true }, active: bool("active", true, true), createdAt,
});
export const Site = define("Site", "sites", {
  id, organizationId: { ...integer("organization_id"), references: ref("Organization", "id", "CASCADE") },
  name: text("name", true), address: text("address"), latitude: decimal("latitude", 10, 7), longitude: decimal("longitude", 10, 7),
  contactName: text("contact_name"), contactPhone: text("contact_phone"), active: bool("active", true, true), createdAt,
});
export const ServicePlan = define("ServicePlan", "service_plans", {
  id, organizationId: { ...integer("organization_id"), references: ref("Organization", "id", "CASCADE") }, name: text("name", true),
  downloadLimit: text("download_limit", true), uploadLimit: text("upload_limit", true), monthlyFee: decimal("monthly_fee", 12, 2, true),
  billingCycle: text("billing_cycle", true, "monthly"), active: bool("active", true, true), createdAt,
});
export const ClientLifecycleEvent = define("ClientLifecycleEvent", "client_lifecycle_events", {
  id, clientId: { ...integer("client_id", true), references: ref("Client", "id", "CASCADE") }, status: text("status", true), notes: text("notes"),
  technicianUserId: { ...integer("technician_user_id"), references: ref("User", "id", "SET NULL") },
  equipmentId: { ...integer("equipment_id"), references: ref("Equipment", "id", "SET NULL") }, metadata: json("metadata", true, {}), createdAt,
});
const money = (field: string, required = true) => decimal(field, 12, 2, required);
export const Invoice = define("Invoice", "invoices", {
  id, clientId: { ...integer("client_id", true), references: ref("Client", "id", "CASCADE") }, number: { ...text("number", true), unique: true },
  periodStart: date("period_start", true), periodEnd: date("period_end", true), dueDate: date("due_date", true), subtotal: money("subtotal"),
  discount: { ...money("discount"), defaultValue: "0" }, surcharge: { ...money("surcharge"), defaultValue: "0" }, total: money("total"),
  amountPaid: { ...money("amount_paid"), defaultValue: "0" }, balanceDue: money("balance_due"), status: text("status", true, "OPEN"),
  kind: text("kind", true, "RECURRING"), metadata: json("metadata", true, {}), createdAt,
});
export const Payment = define("Payment", "payments", {
  id, clientId: { ...integer("client_id", true), references: ref("Client", "id", "CASCADE") },
  invoiceId: { ...integer("invoice_id"), references: ref("Invoice", "id", "SET NULL") }, amount: money("amount"),
  currency: text("currency", true, "USD"), method: text("method", true), reference: text("reference"),
  receiptNumber: { ...text("receipt_number", true), unique: true }, status: text("status", true, "confirmed"), notes: text("notes"),
  paidAt: { ...date("paid_at", true), defaultValue: DataTypes.NOW }, receivedByUserId: { ...integer("received_by_user_id"), references: ref("User", "id", "SET NULL") },
  idempotencyKey: text("idempotency_key"), createdAt,
}, [{ name: "payments_idempotency_key_idx", unique: true, fields: ["idempotencyKey"] }]);
export const PaymentProof = define("PaymentProof", "payment_proofs", {
  id, clientId: { ...integer("client_id", true), references: ref("Client", "id", "CASCADE") }, invoiceId: { ...integer("invoice_id"), references: ref("Invoice", "id", "SET NULL") },
  amount: money("amount"), currency: text("currency", true, "USD"), method: text("method", true), reference: text("reference", true), notes: text("notes"),
  originalName: text("original_name"), mimeType: text("mime_type"), sizeBytes: integer("size_bytes"), sha256: text("sha256"), storagePath: text("storage_path"),
  status: text("status", true, "PENDING"), rejectionReason: text("rejection_reason"), submittedAt: { ...date("submitted_at", true), defaultValue: DataTypes.NOW },
  reviewedByUserId: { ...integer("reviewed_by_user_id"), references: ref("User", "id", "SET NULL") }, reviewedAt: date("reviewed_at"), resubmissionOfId: integer("resubmission_of_id"),
  approvedPaymentId: { ...integer("approved_payment_id"), references: ref("Payment", "id", "SET NULL") },
});
export const BillingSettings = define("BillingSettings", "billing_settings", {
  id, reminderDaysBefore: integer("reminder_days_before", true, 3), graceDays: integer("grace_days", true, 0),
  autoSuspend: bool("auto_suspend", true, true), reminderEnabled: bool("reminder_enabled", true, true), currency: text("currency", true, "USD"),
  updatedByUserId: { ...integer("updated_by_user_id"), references: ref("User", "id", "SET NULL") }, updatedAt: { ...date("updated_at", true), defaultValue: DataTypes.NOW },
});
export const CashClosure = define("CashClosure", "cash_closures", {
  id, closureDate: date("closure_date", true), openingBalance: { ...money("opening_balance"), defaultValue: "0" }, cashTotal: { ...money("cash_total"), defaultValue: "0" },
  transferTotal: { ...money("transfer_total"), defaultValue: "0" }, mobileTotal: { ...money("mobile_total"), defaultValue: "0" }, otherTotal: { ...money("other_total"), defaultValue: "0" },
  expectedTotal: { ...money("expected_total"), defaultValue: "0" }, countedTotal: money("counted_total"), difference: money("difference"), status: text("status", true, "CLOSED"),
  notes: text("notes"), closedByUserId: { ...integer("closed_by_user_id"), references: ref("User", "id", "SET NULL") }, createdAt,
});
export const Ticket = define("Ticket", "tickets", {
  id, clientId: { ...integer("client_id"), references: ref("Client", "id", "SET NULL") }, equipmentId: { ...integer("equipment_id"), references: ref("Equipment", "id", "SET NULL") },
  siteId: { ...integer("site_id"), references: ref("Site", "id", "SET NULL") }, createdByUserId: { ...integer("created_by_user_id"), references: ref("User", "id", "SET NULL") },
  assignedToUserId: { ...integer("assigned_to_user_id"), references: ref("User", "id", "SET NULL") }, subject: text("subject", true), description: text("description", true),
  category: text("category", true, "other"), priority: text("priority", true, "normal"), status: text("status", true, "open"), rootCause: text("root_cause"),
  firstResponseAt: date("first_response_at"), resolvedAt: date("resolved_at"), closedAt: date("closed_at"), closedByClient: bool("closed_by_client", true, false),
  clientReopenEnabled: bool("client_reopen_enabled", true, false), firstResponseDueAt: date("first_response_due_at"), resolutionDueAt: date("resolution_due_at"), createdAt,
  updatedAt: { ...date("updated_at", true), defaultValue: DataTypes.NOW },
});
export const TicketSlaPolicy = define("TicketSlaPolicy", "ticket_sla_policies", {
  priority: { ...text("priority", true), primaryKey: true }, firstResponseMinutes: integer("first_response_minutes", true),
  resolutionMinutes: integer("resolution_minutes", true), updatedByUserId: { ...integer("updated_by_user_id"), references: ref("User", "id", "SET NULL") },
  updatedAt: { ...date("updated_at", true), defaultValue: DataTypes.NOW },
});
export const TicketStatusHistory = define("TicketStatusHistory", "ticket_status_history", {
  id, ticketId: { ...integer("ticket_id", true), references: ref("Ticket", "id", "CASCADE") }, fromStatus: text("from_status"), toStatus: text("to_status", true),
  actorType: text("actor_type", true), actorUserId: { ...integer("actor_user_id"), references: ref("User", "id", "SET NULL") },
  actorClientId: { ...integer("actor_client_id"), references: ref("Client", "id", "SET NULL") }, actorName: text("actor_name"), reason: text("reason"), createdAt,
}, [{ name: "ticket_status_history_ticket_created_idx", fields: ["ticketId", "createdAt"] }]);
export const TicketAttachment = define("TicketAttachment", "ticket_attachments", {
  id, ticketId: { ...integer("ticket_id", true), references: ref("Ticket", "id", "CASCADE") }, uploadedByUserId: { ...integer("uploaded_by_user_id"), references: ref("User", "id", "SET NULL") },
  uploadedByClientId: { ...integer("uploaded_by_client_id"), references: ref("Client", "id", "SET NULL") }, fileName: text("file_name", true), mimeType: text("mime_type", true),
  sizeBytes: integer("size_bytes", true), sha256: text("sha256", true), storagePath: text("storage_path", true), visibleToClient: bool("visible_to_client", true, false), createdAt,
}, [{ name: "ticket_attachments_ticket_created_idx", fields: ["ticketId", "createdAt"] }]);
export const SupportNotification = define("SupportNotification", "support_notifications", {
  id, ticketId: { ...integer("ticket_id"), references: ref("Ticket", "id", "CASCADE") }, userId: { ...integer("user_id"), references: ref("User", "id", "CASCADE") },
  clientId: { ...integer("client_id"), references: ref("Client", "id", "CASCADE") }, title: text("title", true), message: text("message", true), readAt: date("read_at"), createdAt,
}, [{ name: "support_notifications_user_created_idx", fields: ["userId", "createdAt"] }, { name: "support_notifications_client_created_idx", fields: ["clientId", "createdAt"] }]);
export const TicketComment = define("TicketComment", "ticket_comments", {
  id, ticketId: { ...integer("ticket_id", true), references: ref("Ticket", "id", "CASCADE") }, userId: { ...integer("user_id"), references: ref("User", "id", "SET NULL") },
  body: text("body", true), internal: bool("internal", true, false), createdAt,
});
export const InventoryItem = define("InventoryItem", "inventory_items", {
  id, organizationId: { ...integer("organization_id"), references: ref("Organization", "id", "SET NULL") }, siteId: { ...integer("site_id"), references: ref("Site", "id", "SET NULL") },
  clientId: { ...integer("client_id"), references: ref("Client", "id", "SET NULL") }, equipmentId: { ...integer("equipment_id"), references: ref("Equipment", "id", "SET NULL") },
  sku: text("sku"), name: text("name", true), category: text("category", true), serialNumber: text("serial_number"), macAddress: text("mac_address"),
  status: text("status", true, "in_stock"), supplier: text("supplier"), warrantyUntil: date("warranty_until"), cost: money("cost", false), notes: text("notes"), createdAt,
  updatedAt: { ...date("updated_at", true), defaultValue: DataTypes.NOW },
});
export const FieldWorkOrder = define("FieldWorkOrder", "field_work_orders", {
  id, clientId: { ...integer("client_id"), references: ref("Client", "id", "SET NULL") }, siteId: { ...integer("site_id"), references: ref("Site", "id", "SET NULL") },
  assignedToUserId: { ...integer("assigned_to_user_id"), references: ref("User", "id", "SET NULL") }, type: text("type", true, "installation"), status: text("status", true, "pending"),
  scheduledAt: date("scheduled_at"), scheduledEndAt: date("scheduled_end_at"), address: text("address"), latitude: decimal("latitude", 10, 7), longitude: decimal("longitude", 10, 7),
  notes: text("notes"), materials: json("materials", true, []), measuredPower: decimal("measured_power", 8, 2), signalDbm: real("signal_dbm"), ccq: real("ccq"),
  installedEquipment: text("installed_equipment"), installedSerialNumber: text("installed_serial_number"), signatureData: text("signature_data"), completedAt: date("completed_at"), createdAt,
  updatedAt: { ...date("updated_at", true), defaultValue: DataTypes.NOW },
});
export const PortalAccess = define("PortalAccess", "portal_access", {
  id, clientId: { ...integer("client_id", true), unique: true, references: ref("Client", "id", "CASCADE") }, tokenHash: { ...text("token_hash", true), unique: true },
  expiresAt: date("expires_at"), lastUsedAt: date("last_used_at"), createdAt,
});
export const IncidentAlert = define("IncidentAlert", "incident_alerts", {
  id, equipmentId: { ...integer("equipment_id"), references: ref("Equipment", "id", "SET NULL") }, clientId: { ...integer("client_id"), references: ref("Client", "id", "SET NULL") },
  fingerprint: text("fingerprint", true), type: text("type", true), severity: text("severity", true, "warning"), message: text("message", true), status: text("status", true, "open"),
  acknowledgedByUserId: { ...integer("acknowledged_by_user_id"), references: ref("User", "id", "SET NULL") }, acknowledgedAt: date("acknowledged_at"), silencedUntil: date("silenced_until"), createdAt, resolvedAt: date("resolved_at"),
});
export const OrganizationMembership = define("OrganizationMembership", "organization_memberships", {
  id, organizationId: { ...integer("organization_id", true), references: ref("Organization", "id", "CASCADE") }, userId: { ...integer("user_id", true), references: ref("User", "id", "CASCADE") },
  role: text("role", true, "viewer"), siteId: { ...integer("site_id"), references: ref("Site", "id", "CASCADE") }, createdAt,
});
export const MaintenanceNotice = define("MaintenanceNotice", "maintenance_notices", {
  id, organizationId: { ...integer("organization_id"), references: ref("Organization", "id", "CASCADE") }, siteId: { ...integer("site_id"), references: ref("Site", "id", "CASCADE") },
  title: text("title", true), message: text("message", true), startsAt: date("starts_at", true), endsAt: date("ends_at"), active: bool("active", true, true),
  createdByUserId: { ...integer("created_by_user_id"), references: ref("User", "id", "SET NULL") }, createdAt,
});
export const AuditLog = define("AuditLog", "audit_logs", {
  id, timestamp: { ...date("timestamp", true), defaultValue: DataTypes.NOW }, userId: integer("user_id"), username: text("username"), equipmentId: integer("equipment_id"),
  clientId: integer("client_id"), entity: text("entity", true), action: text("action", true), commandSent: text("command_sent"), result: text("result", true, "Pending"),
  details: text("details", true), sourceIp: text("source_ip"), device: text("device"), beforeState: text("before_state"), afterState: text("after_state"), reason: text("reason"),
  confirmation: text("confirmation"), durationMs: integer("duration_ms"), error: text("error"),
});
export const Alert = define("Alert", "alerts", {
  id, equipmentId: integer("equipment_id", true), equipmentIp: text("equipment_ip", true), equipmentModel: text("equipment_model"), nodeName: text("node_name"),
  message: text("message", true), timestamp: { ...date("timestamp", true), defaultValue: DataTypes.NOW },
});
export const ProxmoxServer = define("ProxmoxServer", "proxmox_servers", {
  id, name: text("name", true), ip: text("ip", true), port: integer("port", true, 8006), username: text("username", true), password: text("password", true),
  nodeName: text("node_name", true, "pve"), lastSeenStatus: text("last_seen_status", true, "UNKNOWN"), lastCheckedAt: date("last_checked_at"), createdAt,
});
export const MetricHistory = define("MetricHistory", "metric_history", {
  id, equipmentId: { ...integer("equipment_id"), references: ref("Equipment", "id", "CASCADE") }, clientId: { ...integer("client_id"), references: ref("Client", "id", "CASCADE") },
  recordedAt: { ...date("recorded_at", true), defaultValue: DataTypes.NOW }, txMbps: decimal("tx_mbps", 8, 3), rxMbps: decimal("rx_mbps", 8, 3),
  signalDbm: decimal("signal_dbm", 6, 1), ccq: decimal("ccq", 5, 1),
});
export const Backup = define("Backup", "backups", {
  id, type: text("type", true), name: text("name", true), filePath: text("file_path", true), sizeBytes: integer("size_bytes", false, 0),
  equipmentId: { ...integer("equipment_id"), references: ref("Equipment", "id", "SET NULL") }, createdAt,
});
export const AuthSession = define("AuthSession", "auth_sessions", {
  id, tokenHash: { ...text("token_hash", true), unique: true }, userId: { ...integer("user_id", true), references: ref("User", "id", "CASCADE") },
  expiresAt: date("expires_at", true), revokedAt: date("revoked_at"), ipAddress: text("ip_address"), userAgent: text("user_agent"), createdAt,
  lastUsedAt: { ...date("last_used_at", true), defaultValue: DataTypes.NOW },
});
export const TaskQueue = define("TaskQueue", "task_queue", {
  id: { ...text("id", true), primaryKey: true }, type: text("type", true), description: text("description", true), equipmentId: integer("equipment_id"),
  equipmentLabel: text("equipment_label", true, ""), payload: json("payload", true), status: text("status", true, "pending"),
  retries: integer("retries", true, 0), maxRetries: integer("max_retries", true, 3), error: text("error"), result: text("result"), createdAt,
  startedAt: date("started_at"), completedAt: date("completed_at"), nextAttemptAt: date("next_attempt_at"), cancelledAt: date("cancelled_at"), requestedByUserId: integer("requested_by_user_id"),
});
export const TechnicianAvailability = define("TechnicianAvailability", "technician_availability", {
  id, technicianUserId: { ...integer("technician_user_id", true), references: ref("User", "id", "CASCADE") },
  startsAt: { ...date("starts_at", true), type: DataTypes.DATE }, endsAt: { ...date("ends_at", true), type: DataTypes.DATE }, notes: text("notes"),
  createdByUserId: { ...integer("created_by_user_id"), references: ref("User", "id", "SET NULL") }, createdAt,
}, [{ name: "technician_availability_user_start_idx", fields: ["technicianUserId", "startsAt"] }]);

export const models = {
  Node, Equipment, User, Client, ClientChangeHistory, ClientContract, Organization, Site, ServicePlan,
  ClientLifecycleEvent, Invoice, Payment, PaymentProof, BillingSettings, CashClosure, Ticket, TicketSlaPolicy,
  TicketStatusHistory, TicketAttachment, SupportNotification, TicketComment, InventoryItem, FieldWorkOrder,
  PortalAccess, IncidentAlert, OrganizationMembership, MaintenanceNotice, AuditLog, Alert, ProxmoxServer,
  MetricHistory, Backup, AuthSession, TaskQueue, TechnicianAvailability,
};

/** PostgreSQL checks are owned by the Drizzle schema and are not emitted by this layer. */
export const omittedConstraints = [
  "equipment latitude/longitude/altitude/location checks",
  "ticket SLA positive target check",
  "support notification exactly-one-recipient check",
  "field work order signal/CCQ range checks",
  "technician availability end > start check",
] as const;

export default sequelize;