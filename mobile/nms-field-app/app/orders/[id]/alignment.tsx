import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyFieldWorkOrderAlignmentQueryKey,
  getListMyFieldWorkOrdersQueryKey,
  useGetMyFieldWorkOrderAlignment,
  useReadMyFieldWorkOrderRadioGps,
  useSaveMyFieldWorkOrderAlignment,
} from '@workspace/api-client-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton, EmptyState, LoadingState, Surface } from '@/components/ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';

type CoordinateSource = 'manual' | 'external_gps' | 'phone_gps' | 'radio_gps' | 'unknown';
type EditableCoordinateSource = 'manual' | 'external_gps' | 'phone_gps';

type Position = {
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  source: CoordinateSource;
  accuracyMeters: number | null;
};

type CoordinateFields = {
  latitude: string;
  longitude: string;
  altitudeMeters: string;
};

type Source = 'nms' | 'radio_gps' | 'manual';

const EMPTY_FIELDS: CoordinateFields = { latitude: '', longitude: '', altitudeMeters: '' };

function formatCoordinate(value: number | null | undefined, digits = 6) {
  return value == null ? '' : value.toFixed(digits);
}

function positionToFields(position: Position | null | undefined): CoordinateFields {
  if (!position) return { ...EMPTY_FIELDS };
  return {
    latitude: formatCoordinate(position.latitude),
    longitude: formatCoordinate(position.longitude),
    altitudeMeters: formatCoordinate(position.altitudeMeters, 1),
  };
}

function parseCoordinateFields(
  fields: CoordinateFields,
  source: EditableCoordinateSource,
  accuracyText: string,
): { position: Position | null; invalid: boolean } {
  const latitudeText = fields.latitude.trim();
  const longitudeText = fields.longitude.trim();
  const altitudeText = fields.altitudeMeters.trim();
  const accuracyValue = accuracyText.trim() ? Number(accuracyText.trim().replace(',', '.')) : null;
  if (!latitudeText && !longitudeText && !altitudeText) return { position: null, invalid: accuracyValue !== null && (!Number.isFinite(accuracyValue) || accuracyValue < 0 || accuracyValue > 10000) };
  if (!latitudeText || !longitudeText) return { position: null, invalid: true };

  const latitude = Number(latitudeText.replace(',', '.'));
  const longitude = Number(longitudeText.replace(',', '.'));
  const altitudeMeters = altitudeText ? Number(altitudeText.replace(',', '.')) : null;
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || (altitudeMeters !== null && !Number.isFinite(altitudeMeters))
    || (accuracyValue !== null && (!Number.isFinite(accuracyValue) || accuracyValue < 0 || accuracyValue > 10000))
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
    || (altitudeMeters !== null && (altitudeMeters < -500 || altitudeMeters > 10000))
  ) return { position: null, invalid: true };

  return {
    position: {
      latitude,
      longitude,
      altitudeMeters,
      source,
      accuracyMeters: accuracyValue,
    },
    invalid: false,
  };
}

function editableSource(source: CoordinateSource | undefined): EditableCoordinateSource {
  return source === 'external_gps' || source === 'phone_gps' ? source : 'manual';
}

function radians(degrees: number) {
  return degrees * (Math.PI / 180);
}

function degrees(radiansValue: number) {
  return radiansValue * (180 / Math.PI);
}

function distanceMeters(from: Position, to: Position) {
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude))
    * Math.cos(radians(to.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(from: Position, to: Position) {
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude);
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude)
    - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function signedAngle(degreesValue: number) {
  return ((degreesValue + 540) % 360) - 180;
}

function numberLabel(value: number | null, suffix = '') {
  return value == null ? '—' : `${value.toFixed(0)}${suffix}`;
}

function CenteredError({ title, description }: { title: string; description: string }) {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <EmptyState icon="alert-circle" title={title} description={description} />
      <AppButton label="Volver" icon="arrow-left" variant="secondary" onPress={() => router.back()} />
    </View>
  );
}

export default function RadioAlignmentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(Array.isArray(rawId) ? rawId[0] : rawId);
  const alignmentQuery = useGetMyFieldWorkOrderAlignment(orderId, {
    query: {
      enabled: Number.isInteger(orderId) && orderId > 0,
      retry: false,
      refetchInterval: 8_000,
      refetchIntervalInBackground: false,
    },
  });
  const radioGpsMutation = useReadMyFieldWorkOrderRadioGps();
  const saveMutation = useSaveMyFieldWorkOrderAlignment();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationPermission, requestLocationPermission] = Location.useForegroundPermissions();
  const [source, setSource] = useState<Source>('nms');
  const [radioGps, setRadioGps] = useState<Awaited<ReturnType<typeof radioGpsMutation.mutateAsync>> | null>(null);
  const [manualClient, setManualClient] = useState<CoordinateFields>({ ...EMPTY_FIELDS });
  const [manualAp, setManualAp] = useState<CoordinateFields>({ ...EMPTY_FIELDS });
  const [manualClientSource, setManualClientSource] = useState<EditableCoordinateSource>('manual');
  const [manualApSource, setManualApSource] = useState<EditableCoordinateSource>('manual');
  const [manualClientAccuracy, setManualClientAccuracy] = useState('');
  const [manualApAccuracy, setManualApAccuracy] = useState('');
  const [phonePosition, setPhonePosition] = useState<Position | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [phonePitch, setPhonePitch] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const initializedRef = useRef(false);
  const initializedApEquipmentIdRef = useRef<number | null>(null);

  useEffect(() => {
    const current = alignmentQuery.data;
    if (!current) return;
    if (!initializedRef.current) {
      setManualClient(positionToFields(current.clientRadio.position));
      setManualClientSource(editableSource(current.clientRadio.position?.source));
      setManualClientAccuracy(current.clientRadio.position?.accuracyMeters?.toString() ?? '');
      initializedRef.current = true;
    }
    if (initializedApEquipmentIdRef.current !== current.accessPoint.equipmentId) {
      setManualAp(positionToFields(current.accessPoint.position));
      setManualApSource(editableSource(current.accessPoint.position?.source));
      setManualApAccuracy(current.accessPoint.position?.accuracyMeters?.toString() ?? '');
      setRadioGps(null);
      initializedApEquipmentIdRef.current = current.accessPoint.equipmentId;
    }
  }, [alignmentQuery.data]);

  useEffect(() => {
    if (!locationPermission?.granted) return;
    let active = true;
    let positionSubscription: Location.LocationSubscription | null = null;
    let headingSubscription: Location.LocationSubscription | null = null;
    let motionSubscription: { remove: () => void } | null = null;

    void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then(position => {
        if (!active) return;
        setPhonePosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitudeMeters: position.coords.altitude,
          source: 'phone_gps',
          accuracyMeters: position.coords.accuracy,
        });
      })
      .catch(() => undefined);

    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 3_000, distanceInterval: 1 },
      position => setPhonePosition({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitudeMeters: position.coords.altitude,
        source: 'phone_gps',
        accuracyMeters: position.coords.accuracy,
      }),
    ).then(subscription => {
      if (active) positionSubscription = subscription;
      else subscription.remove();
    }).catch(() => undefined);

    void Location.watchHeadingAsync(value => {
      const currentHeading = value.trueHeading >= 0 ? value.trueHeading : value.magHeading;
      if (Number.isFinite(currentHeading) && currentHeading >= 0) setHeading(currentHeading);
      setHeadingAccuracy(Number.isFinite(value.accuracy) && value.accuracy >= 0 ? value.accuracy : null);
    }).then(subscription => {
      if (active) headingSubscription = subscription;
      else subscription.remove();
    }).catch(() => setHeading(null));

    void DeviceMotion.isAvailableAsync().then(available => {
      if (!active || !available) return;
      DeviceMotion.setUpdateInterval(250);
      motionSubscription = DeviceMotion.addListener(measurement => {
        const beta = measurement.rotation?.beta;
        if (typeof beta === 'number' && Number.isFinite(beta)) setPhonePitch(Math.round(degrees(beta)));
      });
    }).catch(() => setPhonePitch(null));

    return () => {
      active = false;
      positionSubscription?.remove();
      headingSubscription?.remove();
      motionSubscription?.remove();
    };
  }, [locationPermission?.granted]);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return <CenteredError title="Orden inválida" description="No se pudo leer el identificador de la orden." />;
  }
  if (alignmentQuery.isLoading && !alignmentQuery.data) {
    return <View style={[styles.centered, { backgroundColor: colors.background }]}><LoadingState label="Cargando radios y coordenadas…" /></View>;
  }
  if (alignmentQuery.isError && !alignmentQuery.data) {
    return (
      <CenteredError
        title="No se pudo abrir la alineación"
        description={alignmentQuery.error instanceof Error ? alignmentQuery.error.message : 'Vuelve a la orden e inténtalo de nuevo.'}
      />
    );
  }
  if (!alignmentQuery.data) {
    return <CenteredError title="Alineación no disponible" description="La orden no está asignada a tu cuenta o no tiene cliente asociado." />;
  }

  const alignment = alignmentQuery.data;
  const hasConfirmedAccessPoint = alignment.accessPointAssociation.status === 'detected'
    && alignment.accessPoint.equipmentId !== null;
  const nmsClientPosition = alignment.clientRadio.position;
  const nmsApPosition = hasConfirmedAccessPoint ? alignment.accessPoint.position : null;
  const manualClientResult = parseCoordinateFields(manualClient, manualClientSource, manualClientAccuracy);
  const manualApResult = parseCoordinateFields(manualAp, manualApSource, manualApAccuracy);
  const activeClientPosition = source === 'nms'
    ? nmsClientPosition
    : source === 'radio_gps'
      ? (radioGps?.clientRadio.supported ? radioGps.clientRadio.position : null)
      : manualClientResult.position;
  const activeApPosition = !hasConfirmedAccessPoint
    ? null
    : source === 'nms'
      ? nmsApPosition
      : source === 'radio_gps'
        ? (radioGps?.accessPoint.supported ? radioGps.accessPoint.position : null)
        : manualApResult.position;
  const originPosition = phonePosition && (phonePosition.accuracyMeters == null || phonePosition.accuracyMeters <= 100)
    ? phonePosition
    : activeClientPosition;
  const targetBearing = originPosition && activeApPosition
    ? bearingDegrees(originPosition, activeApPosition)
    : null;
  const distance = originPosition && activeApPosition ? distanceMeters(originPosition, activeApPosition) : null;
  const headingDelta = targetBearing !== null && heading !== null
    ? signedAngle(targetBearing - heading)
    : null;
  const targetElevation = originPosition?.altitudeMeters != null
    && activeApPosition?.altitudeMeters != null
    && distance != null
    ? degrees(Math.atan2(activeApPosition.altitudeMeters - originPosition.altitudeMeters, Math.max(distance, 1)))
    : null;
  const pitchDifference = targetElevation !== null && phonePitch !== null
    ? targetElevation - phonePitch
    : null;

  const setManualValue = (
    endpoint: 'client' | 'ap',
    key: keyof CoordinateFields,
    value: string,
  ) => {
    const update = endpoint === 'client' ? setManualClient : setManualAp;
    update(current => ({ ...current, [key]: value }));
  };

  const setManualSource = (endpoint: 'client' | 'ap', nextSource: EditableCoordinateSource) => {
    if (endpoint === 'client') setManualClientSource(nextSource);
    else setManualApSource(nextSource);
  };

  const readRadioGps = async () => {
    setError('');
    setNotice('');
    try {
      const result = await radioGpsMutation.mutateAsync({ id: orderId });
      setRadioGps(result);
      setSource('radio_gps');
      setNotice('Se consultó la ubicación que exponen los radios. Los que no tengan GPS compatible quedan marcados como no disponibles.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar el GPS de los radios.');
    }
  };

  const usePhonePosition = () => {
    if (!phonePosition) {
      setError('Activa el permiso de ubicación y espera a que el teléfono obtenga una posición.');
      return;
    }
    setManualClient({
      latitude: formatCoordinate(phonePosition.latitude),
      longitude: formatCoordinate(phonePosition.longitude),
      altitudeMeters: formatCoordinate(phonePosition.altitudeMeters, 1),
    });
    setManualClientSource('phone_gps');
    setManualClientAccuracy(phonePosition.accuracyMeters?.toString() ?? '');
    setSource('manual');
    setError('');
    setNotice(`Coordenada del teléfono copiada. Precisión indicada: ${phonePosition.accuracyMeters == null ? 'no disponible' : `±${Math.round(phonePosition.accuracyMeters)} m`}.`);
  };

  const saveCoordinates = async () => {
    setError('');
    setNotice('');
    if (!hasConfirmedAccessPoint) {
      setError(alignment.accessPointAssociation.status === 'ambiguous'
        ? 'Hay varias asociaciones activas. Pide a supervisión que confirme el AP del cliente en Imperio AP antes de guardar.'
        : 'Imperio AP no detectó un AP asociado en vivo. El AP guardado se muestra solo como referencia; no se usará para orientar ni guardar.');
      return;
    }
    let clientPosition = activeClientPosition;
    let apPosition = activeApPosition;
    if (source === 'manual') {
      if (manualClientResult.invalid || manualApResult.invalid) {
        setError('Revisa latitud, longitud, altitud y precisión. Usa latitud de −90 a 90, longitud de −180 a 180, altitud de −500 a 10 000 m y precisión de 0 a 10 000 m.');
        return;
      }
      clientPosition = manualClientResult.position;
      apPosition = manualApResult.position;
    }
    if (!clientPosition && !apPosition) {
      setError('No hay coordenadas válidas para guardar. Completa ambas coordenadas o consulta un GPS compatible.');
      return;
    }

    const data: {
      clientRadioLocation?: Position;
      accessPointLocation?: Position;
    } = {};
    if (clientPosition) data.clientRadioLocation = clientPosition;
    if (apPosition) data.accessPointLocation = apPosition;

    try {
      await saveMutation.mutateAsync({ id: orderId, data });
      await queryClient.invalidateQueries({ queryKey: getGetMyFieldWorkOrderAlignmentQueryKey(orderId) });
      await queryClient.invalidateQueries({ queryKey: getListMyFieldWorkOrdersQueryKey() });
      setNotice('Coordenadas guardadas en Imperio AP para los equipos asociados a este cliente.');
      setSource('nms');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar las coordenadas.');
    }
  };

  const requestLocation = async () => {
    const permission = await requestLocationPermission();
    if (!permission.granted && !permission.canAskAgain && Platform.OS !== 'web') {
      try { await Linking.openSettings(); } catch { /* Settings may not be available on every device. */ }
    }
  };

  const requestCamera = async () => {
    const permission = await requestCameraPermission();
    if (!permission.granted && !permission.canAskAgain && Platform.OS !== 'web') {
      try { await Linking.openSettings(); } catch { /* Settings may not be available on every device. */ }
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.navBar, { paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 4, borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a la orden"
          onPress={() => router.back()}
          style={[styles.navIcon, { borderColor: colors.border }]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.navHeading}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>ALINEACIÓN · ORDEN #{alignment.workOrderId}</Text>
          <Text numberOfLines={1} style={[styles.navTitle, { color: colors.foreground }]}>{alignment.clientName}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Actualizar métricas"
          onPress={() => void alignmentQuery.refetch()}
          style={[styles.navIcon, { borderColor: colors.border }]}
        >
          <Feather name="refresh-cw" size={16} color={colors.primary} />
        </Pressable>
      </View>

      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 26 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sectionHeading}>
          <View>
            <Text style={[styles.sectionKicker, { color: colors.primary }]}>GUÍA DE RADIO</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Alinea hacia el AP</Text>
          </View>
          <View style={[styles.liveBadge, { borderColor: colors.border }]}>
            <View style={[styles.liveDot, { backgroundColor: alignment.metrics.available ? colors.primary : colors.mutedForeground }]} />
            <Text style={[styles.liveText, { color: colors.mutedForeground }]}>
              {alignment.metrics.available ? 'MÉTRICAS EN VIVO' : 'SIN MÉTRICAS'}
            </Text>
          </View>
        </View>

        <Surface style={styles.associationCard}>
          <View style={styles.associationHeading}>
            <Feather
              name={hasConfirmedAccessPoint ? 'check-circle' : 'alert-triangle'}
              size={18}
              color={hasConfirmedAccessPoint ? colors.primary : colors.destructive}
            />
            <Text style={[styles.associationTitle, { color: colors.foreground }]}>
              {hasConfirmedAccessPoint
                ? 'AP asociado detectado en vivo'
                : alignment.accessPointAssociation.status === 'ambiguous'
                  ? 'Asociación ambigua'
                  : 'No se detectó el AP asociado'}
            </Text>
          </View>
          {hasConfirmedAccessPoint ? (
            <>
              <Text style={[styles.helperText, { color: colors.foreground }]}>
                {alignment.accessPoint.model ?? 'AP / Repartidor'} · Equipo #{alignment.accessPoint.equipmentId}
                {alignment.accessPointAssociation.method === 'saved_reference'
                  ? ' · confirmado con la referencia guardada'
                  : ''}
              </Text>
              {alignment.savedReferenceAccessPoint
                && alignment.savedReferenceAccessPoint.equipmentId !== alignment.accessPoint.equipmentId ? (
                <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
                  El AP asociado detectado difiere del guardado en Imperio AP (equipo #{alignment.savedReferenceAccessPoint.equipmentId}).
                </Text>
              ) : null}
            </>
          ) : alignment.accessPointAssociation.status === 'ambiguous' ? (
            <>
              <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
                La MAC del cliente aparece en varios AP. No se seleccionará uno automáticamente.
              </Text>
              {alignment.accessPointAssociation.candidates.map(candidate => (
                <Text key={candidate.equipmentId} style={[styles.helperText, { color: colors.foreground }]}>
                  {candidate.model} · Equipo #{candidate.equipmentId}
                  {candidate.signalDbm == null ? '' : ` · ${candidate.signalDbm} dBm`}
                </Text>
              ))}
            </>
          ) : (
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
              {alignment.savedReferenceAccessPoint
                ? `AP guardado como referencia: ${alignment.savedReferenceAccessPoint.model ?? 'AP / Repartidor'} · Equipo #${alignment.savedReferenceAccessPoint.equipmentId}. No se usará como objetivo hasta confirmar una asociación en vivo.`
                : 'Se buscaron asociaciones en los AP / Repartidores administrados por Imperio AP. Pide a supervisión que revise la asociación del cliente.'}
            </Text>
          )}
        </Surface>

        <Surface style={styles.metricsCard}>
          <View style={styles.metricsHeader}>
            <View>
              <Text style={[styles.cardEyebrow, { color: colors.mutedForeground }]}>ENLACE CLIENTE → AP</Text>
              <Text style={[styles.metricsTitle, { color: colors.foreground }]}>{alignment.clientRadio.model ?? 'Radio cliente'} <Text style={{ color: colors.mutedForeground }}>↔</Text> {alignment.accessPoint.model ?? 'AP sin asociar'}</Text>
            </View>
            {alignmentQuery.isFetching ? <ActivityIndicator color={colors.primary} size="small" /> : null}
          </View>
          <View style={styles.metricGrid}>
            <Metric label="SEÑAL" value={numberLabel(alignment.metrics.signalDbm, ' dBm')} colors={colors} />
            <Metric label="CCQ" value={numberLabel(alignment.metrics.ccq, '%')} colors={colors} />
            <Metric label="RUIDO" value={numberLabel(alignment.metrics.noiseDbm, ' dBm')} colors={colors} />
            <Metric label="DISTANCIA" value={alignment.metrics.distance ?? (distance == null ? '—' : `${(distance / 1000).toFixed(2)} km`)} colors={colors} />
          </View>
          <View style={[styles.rateRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.rateText, { color: colors.mutedForeground }]}>TX {alignment.metrics.txRate ?? '—'}</Text>
            <Text style={[styles.rateText, { color: colors.mutedForeground }]}>RX {alignment.metrics.rxRate ?? '—'}</Text>
            <Text style={[styles.rateText, { color: colors.mutedForeground }]}>{alignment.clientMac}</Text>
          </View>
        </Surface>

        <View style={styles.sourceBlock}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Fuente de coordenadas</Text>
          <View style={[styles.sourceTabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SourceButton label="Imperio AP" active={source === 'nms'} onPress={() => setSource('nms')} colors={colors} />
            <SourceButton label="GPS de radios" active={source === 'radio_gps'} onPress={() => setSource('radio_gps')} colors={colors} />
            <SourceButton label="Manual / externo" active={source === 'manual'} onPress={() => setSource('manual')} colors={colors} />
          </View>
          <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
            {source === 'nms'
              ? 'Usa las coordenadas guardadas en Imperio AP para cada equipo.'
              : source === 'radio_gps'
                ? 'Consulta el GPS integrado si el modelo y firmware del radio lo exponen.'
                : 'Escribe coordenadas de un GPS externo o toma una referencia del teléfono.'}
          </Text>
        </View>

        {source === 'radio_gps' ? (
          <Surface style={styles.sourceCard}>
            <View style={styles.positionLine}>
              <View style={styles.positionLabel}>
                <Feather name="radio" size={16} color={colors.primary} />
                <Text style={[styles.positionName, { color: colors.foreground }]}>Radio cliente</Text>
              </View>
              <Text style={[styles.positionValue, { color: radioGps?.clientRadio.supported ? colors.primary : colors.mutedForeground }]}>
                {radioGps?.clientRadio.supported ? 'GPS disponible' : (radioGps?.clientRadio.message ?? 'Aún no consultado')}
              </Text>
            </View>
            <PositionSummary position={radioGps?.clientRadio.position ?? null} colors={colors} />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.positionLine}>
              <View style={styles.positionLabel}>
                <Feather name="wifi" size={16} color={colors.primary} />
                <Text style={[styles.positionName, { color: colors.foreground }]}>AP asociado</Text>
              </View>
              <Text style={[styles.positionValue, { color: radioGps?.accessPoint.supported ? colors.primary : colors.mutedForeground }]}>
                {radioGps?.accessPoint.supported ? 'GPS disponible' : (radioGps?.accessPoint.message ?? 'Aún no consultado')}
              </Text>
            </View>
            <PositionSummary position={radioGps?.accessPoint.position ?? null} colors={colors} />
            <AppButton
              label={radioGpsMutation.isPending ? 'Consultando radios…' : 'Leer GPS de radios'}
              icon="crosshair"
              variant="secondary"
              loading={radioGpsMutation.isPending}
              onPress={() => void readRadioGps()}
            />
          </Surface>
        ) : null}

        {source === 'nms' ? (
          <Surface style={styles.sourceCard}>
            <View style={styles.positionLine}>
              <View style={styles.positionLabel}>
                <Feather name="radio" size={16} color={colors.primary} />
                <Text style={[styles.positionName, { color: colors.foreground }]}>Radio cliente</Text>
              </View>
              <Text style={[styles.positionValue, { color: colors.mutedForeground }]}>{alignment.clientRadio.equipmentId ? `Equipo #${alignment.clientRadio.equipmentId}` : 'Sin equipo asociado'}</Text>
            </View>
            <PositionSummary position={nmsClientPosition} colors={colors} />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.positionLine}>
              <View style={styles.positionLabel}>
                <Feather name="wifi" size={16} color={colors.primary} />
                <Text style={[styles.positionName, { color: colors.foreground }]}>AP asociado</Text>
              </View>
              <Text style={[styles.positionValue, { color: colors.mutedForeground }]}>{alignment.accessPoint.equipmentId ? `Equipo #${alignment.accessPoint.equipmentId}` : 'Sin equipo asociado'}</Text>
            </View>
            <PositionSummary position={nmsApPosition} colors={colors} />
            {!nmsClientPosition || !nmsApPosition ? (
              <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
                Falta una ubicación guardada. Usa entrada manual o consulta el GPS de los radios si está disponible.
              </Text>
            ) : null}
          </Surface>
        ) : null}

        {source === 'manual' ? (
          <Surface style={styles.sourceCard}>
            <View style={styles.positionLine}>
              <Text style={[styles.positionName, { color: colors.foreground }]}>Radio cliente</Text>
              <Text style={[styles.positionValue, { color: colors.mutedForeground }]}>{alignment.clientRadio.model ?? 'Equipo asociado'}</Text>
            </View>
            <View style={[styles.sourceTabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SourceButton label="Manual" active={manualClientSource === 'manual'} onPress={() => setManualSource('client', 'manual')} colors={colors} />
              <SourceButton label="GPS externo" active={manualClientSource === 'external_gps'} onPress={() => setManualSource('client', 'external_gps')} colors={colors} />
              {manualClientSource === 'phone_gps' ? <SourceButton label="GPS teléfono" active onPress={usePhonePosition} colors={colors} /> : null}
            </View>
            <CoordinateInput label="Latitud" value={manualClient.latitude} onChangeText={value => setManualValue('client', 'latitude', value)} colors={colors} />
            <CoordinateInput label="Longitud" value={manualClient.longitude} onChangeText={value => setManualValue('client', 'longitude', value)} colors={colors} />
            <CoordinateInput label="Altitud (m, opcional)" value={manualClient.altitudeMeters} onChangeText={value => setManualValue('client', 'altitudeMeters', value)} colors={colors} />
            <CoordinateInput label="Precisión estimada ±m (opcional)" value={manualClientAccuracy} onChangeText={setManualClientAccuracy} colors={colors} />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.positionLine}>
              <Text style={[styles.positionName, { color: colors.foreground }]}>AP asociado</Text>
              <Text style={[styles.positionValue, { color: colors.mutedForeground }]}>{alignment.accessPoint.model ?? 'Equipo asociado'}</Text>
            </View>
            <View style={[styles.sourceTabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SourceButton label="Manual" active={manualApSource === 'manual'} onPress={() => setManualSource('ap', 'manual')} colors={colors} />
              <SourceButton label="GPS externo" active={manualApSource === 'external_gps'} onPress={() => setManualSource('ap', 'external_gps')} colors={colors} />
            </View>
            <CoordinateInput label="Latitud" value={manualAp.latitude} onChangeText={value => setManualValue('ap', 'latitude', value)} colors={colors} />
            <CoordinateInput label="Longitud" value={manualAp.longitude} onChangeText={value => setManualValue('ap', 'longitude', value)} colors={colors} />
            <CoordinateInput label="Altitud (m, opcional)" value={manualAp.altitudeMeters} onChangeText={value => setManualValue('ap', 'altitudeMeters', value)} colors={colors} />
            <CoordinateInput label="Precisión estimada ±m (opcional)" value={manualApAccuracy} onChangeText={setManualApAccuracy} colors={colors} />
            <View style={styles.phoneGpsRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.positionName, { color: colors.foreground }]}>GPS del teléfono</Text>
                <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
                  {phonePosition
                    ? `Precisión indicada ±${phonePosition.accuracyMeters == null ? '—' : `${Math.round(phonePosition.accuracyMeters)} m`}. No es equipo de topografía.`
                    : 'Disponible al permitir ubicación.'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Usar coordenada actual del teléfono"
                onPress={usePhonePosition}
                style={[styles.iconButton, { borderColor: colors.border }]}
              >
                <Feather name="crosshair" size={17} color={colors.primary} />
              </Pressable>
            </View>
          </Surface>
        ) : null}

        <Surface style={styles.cameraCard}>
          <View style={styles.cameraHeader}>
            <View>
              <Text style={[styles.cardEyebrow, { color: colors.primary }]}>VISTA DE ALINEACIÓN</Text>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Cámara y rumbo</Text>
            </View>
            {headingDelta !== null ? (
              <View style={[styles.directionBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather
                  name="navigation"
                  size={16}
                  color={colors.primary}
                  style={{ transform: [{ rotate: `${headingDelta}deg` }] }}
                />
                <Text style={[styles.directionText, { color: colors.foreground }]}>
                  {Math.abs(headingDelta) < 5
                    ? 'EN RUMBO'
                    : `Gira ${Math.round(Math.abs(headingDelta))}° ${headingDelta > 0 ? 'derecha' : 'izquierda'}`}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={[styles.cameraFrame, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {cameraPermission?.granted ? (
              <>
                <CameraView style={StyleSheet.absoluteFill} facing="back" />
                <View pointerEvents="none" style={styles.cameraOverlay}>
                  <View style={[styles.cameraTopTag, { backgroundColor: 'rgba(5, 12, 24, 0.78)' }]}>
                    <Feather name="target" size={13} color={colors.primary} />
                    <Text style={[styles.cameraTagText, { color: colors.foreground }]}>
                      {targetBearing === null ? 'COORDENADAS INCOMPLETAS' : `OBJETIVO ${Math.round(targetBearing)}°`}
                    </Text>
                  </View>
                  <View style={styles.reticle}>
                    <View style={[styles.reticleHorizontal, { backgroundColor: colors.primary }]} />
                    <View style={[styles.reticleVertical, { backgroundColor: colors.primary }]} />
                    <View style={[styles.reticleCenter, { borderColor: colors.primary }]} />
                  </View>
                  <View style={[styles.cameraBottomTag, { backgroundColor: 'rgba(5, 12, 24, 0.78)' }]}>
                    <Feather name="compass" size={13} color={colors.primary} />
                    <Text style={[styles.cameraTagText, { color: colors.foreground }]}>
                      {heading === null ? 'ESPERANDO BRÚJULA' : `RUMBO ${Math.round(heading)}°`}
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.cameraPermission}>
                <Feather name="camera" size={27} color={colors.primary} />
                <Text style={[styles.cameraPermissionTitle, { color: colors.foreground }]}>Activa la cámara para ver la guía</Text>
                <AppButton
                  label={cameraPermission?.status === 'denied' && !cameraPermission.canAskAgain ? 'Abrir configuración' : 'Permitir cámara'}
                  icon="camera"
                  variant="secondary"
                  onPress={() => void requestCamera()}
                />
              </View>
            )}
          </View>
          <View style={styles.readingGrid}>
            <Reading label="RUMBO AL AP" value={headingDelta === null ? '—' : `${Math.round(targetBearing ?? 0)}°`} colors={colors} />
            <Reading label="DISTANCIA" value={distance === null ? '—' : `${(distance / 1000).toFixed(2)} km`} colors={colors} />
            <Reading label="ÁNGULO VERTICAL" value={targetElevation === null ? '—' : `${targetElevation.toFixed(1)}°`} colors={colors} />
            <Reading label="INCLINACIÓN MÓVIL" value={phonePitch === null ? '—' : `${phonePitch}°`} colors={colors} />
          </View>
          {headingAccuracy !== null || pitchDifference !== null ? (
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
              {headingAccuracy !== null ? `Precisión de brújula indicada ±${Math.round(headingAccuracy)}°. ` : ''}
              {pitchDifference !== null ? `Diferencia vertical estimada ${pitchDifference.toFixed(1)}°.` : ''}
            </Text>
          ) : null}
          <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
            La superposición guía por rumbo y coordenadas; no reconoce la antena en la imagen. La precisión depende del GPS, la brújula, la altura y las coordenadas. Confirma el ajuste con señal y CCQ reales.
          </Text>
        </Surface>

        {!locationPermission?.granted ? (
          <Surface style={styles.permissionCard}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.positionName, { color: colors.foreground }]}>Permite ubicación para rumbo y GPS del teléfono</Text>
              <Text style={[styles.helperText, { color: colors.mutedForeground }]}>La entrada manual sigue disponible sin este permiso.</Text>
            </View>
            <AppButton
              label={locationPermission?.status === 'denied' && !locationPermission.canAskAgain ? 'Configuración' : 'Permitir'}
              icon="map-pin"
              variant="secondary"
              onPress={() => void requestLocation()}
            />
          </Surface>
        ) : null}

        {source !== 'nms' ? (
          <AppButton
            label={saveMutation.isPending ? 'Guardando coordenadas…' : 'Guardar coordenadas en Imperio AP'}
            icon="save"
            loading={saveMutation.isPending}
            disabled={!hasConfirmedAccessPoint}
            onPress={() => void saveCoordinates()}
          />
        ) : null}

        {error ? (
          <View style={[styles.messageBox, { borderColor: colors.destructive }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.messageText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}
        {notice ? (
          <View style={[styles.messageBox, { borderColor: colors.border }]}>
            <Feather name="check-circle" size={16} color={colors.primary} />
            <Text style={[styles.messageText, { color: colors.foreground }]}>{notice}</Text>
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function Metric({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function Reading({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.reading}>
      <Text style={[styles.readingLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.readingValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function SourceButton({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.sourceButton,
        active && { backgroundColor: colors.primary },
      ]}
    >
      <Text style={[styles.sourceButtonText, { color: active ? colors.background : colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

function PositionSummary({
  position,
  colors,
}: {
  position: Position | null;
  colors: ReturnType<typeof useColors>;
}) {
  if (!position) {
    return <Text style={[styles.positionValue, { color: colors.mutedForeground }]}>Sin coordenadas disponibles</Text>;
  }
  return (
    <View style={styles.positionSummary}>
      <Text style={[styles.coordinates, { color: colors.mutedForeground }]}>
        {position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}
        {position.altitudeMeters == null ? '' : ` · ${position.altitudeMeters.toFixed(1)} m`}
      </Text>
      <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
        {position.source === 'radio_gps'
          ? 'GPS integrado del radio'
          : position.source === 'phone_gps'
            ? 'GPS del teléfono'
            : position.source === 'external_gps'
              ? 'GPS externo'
              : position.source === 'manual'
                ? 'Entrada manual'
                : 'Origen no registrado'}
        {position.accuracyMeters == null ? '' : ` · precisión ±${Math.round(position.accuracyMeters)} m`}
      </Text>
    </View>
  );
}

function CoordinateInput({
  label,
  value,
  onChangeText,
  colors,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.coordinateInput}>
      <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="—"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="decimal-pad"
        selectTextOnFocus
        accessibilityLabel={label}
        style={[
          styles.coordinateTextInput,
          { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 13, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  navIcon: { width: 38, height: 38, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navHeading: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  navTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  content: { paddingHorizontal: 18, paddingTop: 20, gap: 17 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  sectionKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.35, marginBottom: 4 },
  title: { fontSize: 23, fontWeight: '800', letterSpacing: -0.35 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  metricsCard: { gap: 14 },
  associationCard: { gap: 9 },
  associationHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  associationTitle: { fontSize: 14, fontWeight: '800' },
  metricsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  metricsTitle: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginTop: 4 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '48%', minHeight: 56, justifyContent: 'center', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  metricLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  metricValue: { fontSize: 17, fontWeight: '800', marginTop: 3 },
  rateRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11 },
  rateText: { fontSize: 10, fontWeight: '600' },
  sourceBlock: { gap: 9 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  sourceTabs: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 4, gap: 3 },
  positionSummary: { gap: 3 },
  sourceButton: { flex: 1, minHeight: 38, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sourceButtonText: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  helperText: { fontSize: 11, lineHeight: 16 },
  sourceCard: { gap: 12 },
  positionLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  positionLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  positionName: { fontSize: 13, fontWeight: '700' },
  positionValue: { flexShrink: 1, fontSize: 10, lineHeight: 15, textAlign: 'right' },
  coordinates: { fontSize: 12, fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  coordinateInput: { gap: 5 },
  inputLabel: { fontSize: 10, fontWeight: '700' },
  coordinateTextInput: { height: 43, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, fontSize: 14, fontVariant: ['tabular-nums'] },
  phoneGpsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 3 },
  iconButton: { width: 38, height: 38, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cameraCard: { gap: 13 },
  cameraHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  directionBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, paddingVertical: 7, borderWidth: 1, borderRadius: 12 },
  directionText: { fontSize: 9, fontWeight: '800' },
  cameraFrame: { height: 230, borderWidth: 1, borderRadius: 18, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  cameraOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  cameraTopTag: { position: 'absolute', top: 12, left: 12, right: 12, height: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 9 },
  cameraBottomTag: { position: 'absolute', bottom: 12, left: 12, right: 12, height: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 9 },
  cameraTagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  reticle: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  reticleHorizontal: { position: 'absolute', width: '100%', height: 1, opacity: 0.8 },
  reticleVertical: { position: 'absolute', width: 1, height: '100%', opacity: 0.8 },
  reticleCenter: { width: 24, height: 24, borderWidth: 1.5, borderRadius: 12 },
  cameraPermission: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 18 },
  cameraPermissionTitle: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  readingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reading: { width: '48%', gap: 3 },
  readingLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 0.75 },
  readingValue: { fontSize: 14, fontWeight: '700' },
  disclaimer: { fontSize: 10, lineHeight: 15 },
  permissionCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  messageBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderRadius: 12, padding: 11 },
  messageText: { flex: 1, fontSize: 11, lineHeight: 16 },
});