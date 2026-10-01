export type DeviceIdentity = {
  manufacturer: "MikroTik" | "Ubiquiti" | "unknown";
  model: string | null;
  firmware: string | null;
  source: "device" | "inventory" | "unknown";
  profileId: string;
};

export type DeviceControlPolicy = {
  canApply: boolean;
  mode: "managed" | "read_only";
  reason: string;
};

export type DeviceCapabilities = Record<string, string | boolean>;

export type EditableConfigurationParameter = {
  key: string;
  value: string | null;
  sensitive: boolean;
  valueType: "text" | "number" | "boolean" | "password";
};

type DiscoveredDevice = {
  identity: DeviceIdentity;
  controlPolicy: DeviceControlPolicy;
  capabilities: DeviceCapabilities;
};

function decodeConfigValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch { /* Preserve the source text if it is not JSON-escaped. */ }
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'");
  }
  return trimmed;
}

export function isSensitiveConfigurationKey(key: string): boolean {
  return /password|passphrase|wpa2[-_.]?pre[-_.]?shared[-_.]?key|wpa.*psk|psk|wep.*key|auth[-_.]?key|shared[-_.]?secret|secret|private[-_.]?key|token|community|(?:^|[._-])key\d*(?:$|[._-])/i.test(key);
}

export function extractAirosConfigurationParameters(configuration: string): EditableConfigurationParameter[] {
  const parameters: EditableConfigurationParameter[] = [];
  for (const line of configuration.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-zA-Z0-9_.-]{1,160})\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2];
    const sensitive = isSensitiveConfigurationKey(key);
    if (sensitive) {
      parameters.push({ key, value: null, sensitive: true, valueType: "password" });
      continue;
    }
    const value = decodeConfigValue(rawValue);
    const valueType: EditableConfigurationParameter["valueType"] = /^(?:true|false|enabled|disabled|on|off|yes|no)$/i.test(value)
      ? "boolean"
      : /^-?\d+(?:\.\d+)?$/.test(value) ? "number" : "text";
    parameters.push({ key, value, sensitive: false, valueType });
  }
  return parameters;
}

function parseStatusValues(output: string): Map<string, string> {
  const values = new Map<string, string>();
  const trimmed = output.trim();
  if (!trimmed) return values;

  const addJsonValues = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => addJsonValues(item, `${path}.${index}`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        addJsonValues(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (typeof value === "string" || typeof value === "number") {
      values.set(path.toLowerCase(), String(value).trim());
    }
  };

  try {
    addJsonValues(JSON.parse(trimmed) as unknown, "");
  } catch {
    for (const line of trimmed.split(/\r?\n/)) {
      const match = line.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/);
      if (match?.[1] && match[2]) values.set(match[1].trim().toLowerCase(), match[2].trim());
    }
  }
  return values;
}

function firstValue(values: Map<string, string>, keys: string[]): string | null {
  for (const expected of keys) {
    const exact = values.get(expected);
    if (exact) return exact;
    for (const [key, value] of values) {
      if (key.endsWith(`.${expected}`) && value) return value;
    }
  }
  return null;
}

function normalizeModel(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/^["']|["']$/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function isUbiquitiMSeries(model: string | null): boolean {
  if (!model) return false;
  return /(?:nanostation|nano\s*station|loco|rocket|bullet|powerbeam|airgrid|nanobridge|powerbridge)\s*(?:m\s*)?[25]\b/i.test(model);
}

function isSupportedRouterOsFirmware(firmware: string | null): boolean {
  return Boolean(firmware && /^(?:routeros\s+)?[67]\.\d+(?:\.\d+)?\b/i.test(firmware.trim()));
}

function isSupportedMSeriesFirmware(firmware: string | null): boolean {
  return Boolean(firmware && /^(?:(?:XM|XW)\.)?v?6\.\d+(?:\.\d+)?\b/i.test(firmware.trim()));
}

function detectAirMaxState(configuration: string): string {
  const matches = configuration.split(/\r?\n/)
    .map(line => line.match(/^\s*([^=:#]+)\s*[=:]\s*([^#]*)/))
    .filter((match): match is RegExpMatchArray => Boolean(match?.[1] && /air\s*max|airmax/i.test(match[1])));
  if (matches.length === 0) return "not_detected";

  const values = matches.map(match => match[2].trim().replace(/^["']|["']$/g, "").toLowerCase());
  if (values.some(value => ["1", "true", "yes", "on", "enabled"].includes(value))) return "enabled";
  if (values.some(value => ["0", "false", "no", "off", "disabled"].includes(value))) return "disabled";
  return "unknown";
}

function detectAirosCapabilities(configuration: string): DeviceCapabilities {
  const keys = configuration.split(/\r?\n/)
    .map(line => line.match(/^\s*([^=:#]+)\s*[=:]/)?.[1]?.trim().toLowerCase())
    .filter((key): key is string => Boolean(key));
  const has = (pattern: RegExp) => keys.some(key => pattern.test(key));

  return {
    wireless: has(/^(?:wireless|radio)\./) ? "detected" : "not_detected",
    network: has(/^(?:netconf|network)\./) ? "detected" : "not_detected",
    ssid: has(/(?:^|\.)ssid$/) ? "detected" : "not_detected",
    channel: has(/(?:channel|frequency|freq)$/) ? "detected" : "not_detected",
    txPower: has(/(?:txpower|tx_power)$/) ? "detected" : "not_detected",
    airMax: detectAirMaxState(configuration),
    nativeRestore: keys.some(key => /^(?:wireless|radio|netconf|network|system)\./.test(key))
      ? "detected"
      : "not_detected",
  };
}

function detectRouterOsCapabilities(configuration: string): DeviceCapabilities {
  const source = configuration.toLowerCase();
  const hasImportableExport = /(?:^|\n)\/(?:interface|ip|system|queue|tool|user|routing)\b/m.test(source);
  return {
    wireless: source.includes("/interface/wifi")
      ? "routeros_wifi"
      : source.includes("/interface/wireless")
        ? "routeros_wireless"
        : "not_detected",
    network: /\/ip\/(?:address|route)/.test(source) ? "detected" : "not_detected",
    dhcp: source.includes("/ip/dhcp-server") ? "detected" : "not_detected",
    queues: source.includes("/queue/") ? "detected" : "not_detected",
    airMax: "not_applicable",
    nativeRestore: hasImportableExport ? "detected" : "not_detected",
  };
}

export function discoverDeviceCapabilities(input: {
  connectionType: string;
  declaredModel: string;
  deviceInfo: string;
  configuration: string;
}): DiscoveredDevice {
  const values = parseStatusValues(input.deviceInfo);
  const routerOs = input.connectionType === "mikrotik_routeros";
  const manufacturer: DeviceIdentity["manufacturer"] = routerOs
    ? "MikroTik"
    : input.connectionType === "ubiquiti_airos" ? "Ubiquiti" : "unknown";
  const detectedModel = normalizeModel(firstValue(values, [
    "board.name",
    "board-name",
    "device.model",
    "hardware.model",
    "model",
    "board",
  ]));
  const firmware = firstValue(values, [
    "system.version",
    "fwversion",
    "firmware",
    "version",
  ]);
  const supportedFirmware = routerOs
    ? isSupportedRouterOsFirmware(firmware)
    : isSupportedMSeriesFirmware(firmware);
  const source: DeviceIdentity["source"] = detectedModel
    ? "device"
    : input.declaredModel.trim() ? "inventory" : "unknown";
  const model = detectedModel ?? normalizeModel(input.declaredModel);
  const mSeries = !routerOs && input.connectionType === "ubiquiti_airos" && isUbiquitiMSeries(detectedModel);
  const verifiedModelProfile = routerOs ? Boolean(detectedModel) : mSeries;
  const profileId = verifiedModelProfile && supportedFirmware
    ? routerOs ? "mikrotik-routeros" : "ubiquiti-airos-m-series"
    : "unverified";
  const capabilities = routerOs
    ? detectRouterOsCapabilities(input.configuration)
    : detectAirosCapabilities(input.configuration);
  const restorableExportDetected = capabilities.nativeRestore === "detected";

  let controlPolicy: DeviceControlPolicy;
  if (routerOs && verifiedModelProfile && supportedFirmware && restorableExportDetected) {
    controlPolicy = {
      canApply: true,
      mode: "managed",
      reason: "Modelo, versión y export recuperable detectados desde el equipo.",
    };
  } else if (!routerOs && verifiedModelProfile && supportedFirmware && restorableExportDetected) {
    controlPolicy = {
      canApply: true,
      mode: "managed",
      reason: "Equipo Ubiquiti M-series, firmware y configuración recuperable detectados. Los cambios siguen requiriendo revisión, respaldo y confirmación.",
    };
  } else {
    controlPolicy = {
      canApply: false,
      mode: "read_only",
      reason: !restorableExportDetected
        ? "No se detectó un export nativo recuperable; el equipo queda en solo lectura para no aplicar cambios sin respaldo."
        : !detectedModel
          ? "No se pudo confirmar el modelo desde el equipo. La lectura permanece disponible; se bloquean los cambios."
          : !supportedFirmware
            ? "La versión de firmware no coincide con un perfil verificado; el equipo queda en solo lectura."
            : "El modelo y firmware no coinciden con un perfil de configuración validado. La lectura permanece disponible; se bloquean los cambios.",
    };
  }

  return {
    identity: { manufacturer, model, firmware, source, profileId },
    controlPolicy,
    capabilities,
  };
}