import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Geolocation } from "@capacitor/geolocation";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Motion } from "@capacitor/motion";
import { CameraPreview } from "@capacitor-community/camera-preview";

export type FieldCoordinate = {
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  accuracyMeters: number | null;
  source: "phone_gps";
};

export type FieldOrientation = {
  headingDegrees: number | null;
  headingAccuracyDegrees: number | null;
  pitchDegrees: number | null;
};

function toFieldCoordinate(position: {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
  };
}): FieldCoordinate {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    altitudeMeters: position.coords.altitude,
    accuracyMeters: position.coords.accuracy,
    source: "phone_gps",
  };
}

export async function requestLocationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return "geolocation" in navigator;

  const permission = await Geolocation.requestPermissions();
  return permission.location === "granted" || permission.coarseLocation === "granted";
}

export async function readCurrentFieldPosition(): Promise<FieldCoordinate> {
  if (Capacitor.isNativePlatform()) {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 0,
    });
    return toFieldCoordinate(position);
  }

  if (!navigator.geolocation) {
    throw new Error("Este navegador no ofrece ubicación. Puedes introducir las coordenadas manualmente.");
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 0,
    });
  });
  return toFieldCoordinate(position);
}

export async function watchFieldPosition(
  onPosition: (position: FieldCoordinate) => void,
  onError?: (error: GeolocationPositionError | Error) => void,
): Promise<() => void> {
  if (Capacitor.isNativePlatform()) {
    let active = true;
    const id = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
      (position, error) => {
        if (!active) return;
        if (error) {
          onError?.(new Error(error.message));
        } else if (position) {
          onPosition(toFieldCoordinate(position));
        }
      },
    );
    return () => {
      active = false;
      void Geolocation.clearWatch({ id });
    };
  }

  if (!navigator.geolocation) {
    onError?.(new Error("Este navegador no ofrece ubicación."));
    return () => undefined;
  }
  const id = navigator.geolocation.watchPosition(
    position => onPosition(toFieldCoordinate(position)),
    error => onError?.(error),
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export async function requestOrientationPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) return true;

  const Orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  if (!Orientation) return false;
  if (typeof Orientation.requestPermission === "function") {
    return (await Orientation.requestPermission()) === "granted";
  }
  return true;
}

export async function watchFieldOrientation(
  onReading: (reading: FieldOrientation) => void,
): Promise<() => void> {
  if (Capacitor.isNativePlatform()) {
    let active = true;
    const handle: PluginListenerHandle = await Motion.addListener("orientation", event => {
      if (!active) return;
      onReading({
        headingDegrees: event.alpha === null ? null : normalizeDegrees(360 - event.alpha),
        headingAccuracyDegrees: null,
        pitchDegrees: event.beta,
      });
    });
    return () => {
      active = false;
      void handle.remove();
    };
  }

  const handler = (event: DeviceOrientationEvent & {
    webkitCompassHeading?: number;
    webkitCompassAccuracy?: number;
  }) => {
    const webkitHeading = event.webkitCompassHeading;
    const absoluteHeading = event.absolute && event.alpha !== null
      ? normalizeDegrees(360 - event.alpha)
      : null;
    onReading({
      headingDegrees: typeof webkitHeading === "number" ? normalizeDegrees(webkitHeading) : absoluteHeading,
      headingAccuracyDegrees: typeof event.webkitCompassAccuracy === "number" && event.webkitCompassAccuracy >= 0
        ? event.webkitCompassAccuracy
        : null,
      pitchDegrees: event.beta,
    });
  };
  window.addEventListener("deviceorientation", handler);
  return () => window.removeEventListener("deviceorientation", handler);
}

export async function startFieldCameraPreview(elementId: string): Promise<void> {
  const element = document.getElementById(elementId);
  if (!element) throw new Error("No se encontró el área de vista previa de la cámara.");

  if (!Capacitor.isNativePlatform()) {
    await CameraPreview.start({
      parent: elementId,
      position: "rear",
      disableAudio: true,
      enableOpacity: true,
    });
    return;
  }

  const rect = element.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  document.documentElement.classList.add("capacitor-camera-active");
  try {
    await CameraPreview.start({
      position: "rear",
      x: Math.round(rect.left * pixelRatio),
      y: Math.round(rect.top * pixelRatio),
      width: Math.round(rect.width * pixelRatio),
      height: Math.round(rect.height * pixelRatio),
      toBack: true,
      enableZoom: true,
    });
  } catch (error) {
    document.documentElement.classList.remove("capacitor-camera-active");
    throw error;
  }
}

export async function stopFieldCameraPreview(): Promise<void> {
  try {
    await CameraPreview.stop();
  } finally {
    document.documentElement.classList.remove("capacitor-camera-active");
  }
}

export async function openFieldDirections(address: string): Promise<void> {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function fieldHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Haptics are optional; the interaction remains available without them.
  }
}