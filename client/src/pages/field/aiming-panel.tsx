import { useEffect, useRef, useState } from "react";
import { Check, Compass, LocateFixed, Video, VideoOff } from "lucide-react";
import type { AlignmentPosition } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  fieldHaptic,
  readCurrentFieldPosition,
  requestLocationPermission,
  requestOrientationPermission,
  startFieldCameraPreview,
  stopFieldCameraPreview,
  watchFieldOrientation,
  watchFieldPosition,
  type FieldCoordinate,
} from "@/lib/field-device";

type Coordinate = Pick<AlignmentPosition, "latitude" | "longitude" | "altitudeMeters" | "accuracyMeters">;

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue: number) {
  return (radiansValue * 180) / Math.PI;
}

function bearingBetween(origin: Coordinate, target: Coordinate): number {
  const lat1 = radians(origin.latitude);
  const lat2 = radians(target.latitude);
  const deltaLongitude = radians(target.longitude - origin.longitude);
  const y = Math.sin(deltaLongitude) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function distanceBetween(origin: Coordinate, target: Coordinate): number {
  const earthRadiusMeters = 6_371_000;
  const deltaLatitude = radians(target.latitude - origin.latitude);
  const deltaLongitude = radians(target.longitude - origin.longitude);
  const lat1 = radians(origin.latitude);
  const lat2 = radians(target.latitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function signedAngle(degreesValue: number): number {
  return ((degreesValue + 180) % 360 + 360) % 360 - 180;
}

function formatNumber(value: number | null, digits = 0): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function FieldAimingPanel({
  clientPosition,
  accessPointPosition,
}: {
  clientPosition: AlignmentPosition | null;
  accessPointPosition: AlignmentPosition | null;
}) {
  const [phonePosition, setPhonePosition] = useState<FieldCoordinate | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const [locationError, setLocationError] = useState("");
  const [orientationError, setOrientationError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [sensorsActive, setSensorsActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const locationStopRef = useRef<(() => void) | null>(null);
  const orientationStopRef = useRef<(() => void) | null>(null);
  const cameraActiveRef = useRef(false);

  const stopSensors = () => {
    locationStopRef.current?.();
    orientationStopRef.current?.();
    locationStopRef.current = null;
    orientationStopRef.current = null;
    setSensorsActive(false);
  };

  useEffect(() => () => {
    locationStopRef.current?.();
    orientationStopRef.current?.();
    if (cameraActiveRef.current) void stopFieldCameraPreview();
  }, []);

  const startSensors = async () => {
    if (sensorsActive) {
      stopSensors();
      return;
    }
    setLocationError("");
    setOrientationError("");

    try {
      const permitted = await requestLocationPermission();
      if (!permitted) {
        setLocationError("Permiso de ubicación denegado. La orientación todavía puede usarse con la posición guardada del radio cliente.");
      } else {
        const position = await readCurrentFieldPosition();
        setPhonePosition(position);
        locationStopRef.current = await watchFieldPosition(
          nextPosition => {
            setPhonePosition(nextPosition);
            setLocationError("");
          },
          error => setLocationError(error.message),
        );
      }
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "No se pudo leer el GPS del teléfono.");
    }

    try {
      const permitted = await requestOrientationPermission();
      if (!permitted) {
        setOrientationError("Permiso de orientación denegado. Revisa los permisos del dispositivo.");
      } else {
        orientationStopRef.current = await watchFieldOrientation(reading => {
          setHeading(reading.headingDegrees);
          setHeadingAccuracy(reading.headingAccuracyDegrees);
          setPitch(reading.pitchDegrees);
        });
      }
    } catch (error) {
      setOrientationError(error instanceof Error ? error.message : "La orientación no está disponible en este dispositivo.");
    }

    setSensorsActive(Boolean(locationStopRef.current || orientationStopRef.current));
  };

  const toggleCamera = async () => {
    setCameraError("");
    try {
      if (cameraActiveRef.current) {
        await stopFieldCameraPreview();
        cameraActiveRef.current = false;
        setCameraActive(false);
      } else {
        await startFieldCameraPreview("field-camera-preview");
        cameraActiveRef.current = true;
        setCameraActive(true);
      }
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "No se pudo abrir la cámara.");
    }
  };

  const phoneIsUsable =
    phonePosition !== null &&
    (phonePosition.accuracyMeters === null || phonePosition.accuracyMeters <= 100);
  const origin: Coordinate | null = phoneIsUsable ? phonePosition : clientPosition;
  const bearing = origin && accessPointPosition ? bearingBetween(origin, accessPointPosition) : null;
  const distance = origin && accessPointPosition ? distanceBetween(origin, accessPointPosition) : null;
  const headingDelta = bearing !== null && heading !== null ? signedAngle(bearing - heading) : null;
  const targetElevation =
    origin?.altitudeMeters !== null &&
    origin?.altitudeMeters !== undefined &&
    accessPointPosition?.altitudeMeters !== null &&
    accessPointPosition?.altitudeMeters !== undefined &&
    distance !== null
      ? degrees(Math.atan2(
          accessPointPosition.altitudeMeters - origin.altitudeMeters,
          Math.max(distance, 1),
        ))
      : null;
  const pitchDelta = targetElevation !== null && pitch !== null ? targetElevation - pitch : null;

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Apuntado y orientación</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Ayuda visual con GPS y sensores del teléfono; no cambia la configuración de los radios.
          </p>
        </div>
        <Button variant="outline" className="min-h-11 shrink-0" onClick={() => void startSensors()}>
          {sensorsActive ? "Detener sensores" : "Activar sensores"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Rumbo al AP" value={bearing === null ? "—" : `${Math.round(bearing)}°`} />
        <Metric label="Distancia" value={distance === null ? "—" : `${Math.round(distance)} m`} />
        <Metric
          label="Giro horizontal"
          value={headingDelta === null
            ? "—"
            : `${headingDelta > 0 ? "Derecha" : headingDelta < 0 ? "Izquierda" : "En rumbo"} ${Math.abs(Math.round(headingDelta))}°`}
        />
        <Metric
          label="Inclinación"
          value={pitchDelta === null
            ? pitch === null ? "—" : `${Math.round(pitch)}°`
            : `${pitchDelta > 0 ? "Subir" : pitchDelta < 0 ? "Bajar" : "A nivel"} ${Math.abs(Math.round(pitchDelta))}°`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Posición de referencia: {phoneIsUsable ? "teléfono" : clientPosition ? "radio cliente guardado" : "no disponible"}
          {phoneIsUsable && ` · GPS ±${phonePosition.accuracyMeters === null ? "?" : Math.round(phonePosition.accuracyMeters)} m`}
        </span>
        <span>Rumbo del teléfono: {formatNumber(heading, 0)}°{headingAccuracy === null ? "" : ` · ±${Math.round(headingAccuracy)}°`}</span>
        {targetElevation !== null && <span>Elevación estimada del AP: {targetElevation.toFixed(1)}°</span>}
      </div>
      {locationError && <p role="status" className="text-sm text-amber-200">{locationError}</p>}
      {orientationError && <p role="alert" className="text-sm text-amber-200">{orientationError}</p>}
      {headingDelta === null && (
        <p className="text-xs text-muted-foreground">
          Para calcular el rumbo hacen falta coordenadas válidas del AP y del radio cliente o del teléfono.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="relative min-h-44 overflow-hidden bg-black/10">
          <div id="field-camera-preview" className="absolute inset-0" aria-label="Vista previa de cámara" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-16 w-16 rounded-full border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,.45)]">
              <span className="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 bg-white" />
              <span className="absolute bottom-0 left-1/2 h-5 w-px -translate-x-1/2 bg-white" />
              <span className="absolute left-0 top-1/2 h-px w-5 -translate-y-1/2 bg-white" />
              <span className="absolute right-0 top-1/2 h-px w-5 -translate-y-1/2 bg-white" />
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-black/55 p-3 text-white">
            <span className="text-xs">{cameraActive ? "Vista de cámara activa" : "Vista de cámara opcional"}</span>
            <Button variant="secondary" className="min-h-10" onClick={() => void toggleCamera()}>
              {cameraActive ? <VideoOff className="mr-2 h-4 w-4" /> : <Video className="mr-2 h-4 w-4" />}
              {cameraActive ? "Cerrar cámara" : "Abrir cámara"}
            </Button>
          </div>
        </div>
      </div>
      {cameraError && <p role="alert" className="text-sm text-amber-200">{cameraError}</p>}
      {phonePosition && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LocateFixed className="h-3.5 w-3.5" />
          Teléfono: {phonePosition.latitude.toFixed(6)}, {phonePosition.longitude.toFixed(6)}
          {phonePosition.altitudeMeters !== null && ` · ${phonePosition.altitudeMeters.toFixed(1)} m`}
          {phoneIsUsable && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}