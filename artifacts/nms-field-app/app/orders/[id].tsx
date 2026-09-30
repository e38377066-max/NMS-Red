import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  type GestureResponderEvent,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getListMyFieldWorkOrdersQueryKey,
  useListMyFieldWorkOrders,
  useUpdateMyFieldWorkOrder,
  type FieldWorkOrder,
} from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppButton, EmptyState, LoadingState, StatusPill, Surface, TextField } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import {
  formatOrderDate,
  formatOrderSchedule,
  formatOrderTime,
  isTerminalWorkOrder,
  orderVisitAddress,
  parseOptionalMeasurement,
  workOrderStatusLabel,
  workOrderTypeLabel,
} from '@/lib/field-work';
import Svg, { Path } from 'react-native-svg';

type SignatureStroke = Array<[number, number]>;
type SavedSignature = {
  signerName: string;
  signedAt: string;
  strokes: SignatureStroke[];
};

const SIGNATURE_CANVAS_HEIGHT = 150;

function parseSavedSignature(value: string | null | undefined): SavedSignature | null {
  if (!value || value.length > 24_000) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.version !== 1
      || typeof parsed.signerName !== 'string'
      || typeof parsed.signedAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.signedAt))
      || !Array.isArray(parsed.strokes)
      || parsed.strokes.length === 0
      || parsed.strokes.length > 32
      || !parsed.strokes.every(stroke =>
        Array.isArray(stroke)
        && stroke.length >= 2
        && stroke.length <= 500
        && stroke.every(point =>
          Array.isArray(point)
          && point.length === 2
          && point.every(coordinate =>
            typeof coordinate === 'number'
            && Number.isFinite(coordinate)
            && coordinate >= 0
            && coordinate <= 1,
          ),
        ),
      )
    ) return null;
    return {
      signerName: parsed.signerName,
      signedAt: parsed.signedAt,
      strokes: parsed.strokes as SignatureStroke[],
    };
  } catch {
    return null;
  }
}

function signaturePath(stroke: SignatureStroke, width: number): string {
  return stroke.map(([x, y], index) =>
    `${index === 0 ? 'M' : 'L'} ${(x * width).toFixed(1)} ${(y * SIGNATURE_CANVAS_HEIGHT).toFixed(1)}`,
  ).join(' ');
}

function SignaturePad({
  strokes,
  onChange,
  disabled = false,
}: {
  strokes: SignatureStroke[];
  onChange?: Dispatch<SetStateAction<SignatureStroke[]>>;
  disabled?: boolean;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(1);
  const makePoint = (event: GestureResponderEvent): [number, number] => [
    Number(Math.max(0, Math.min(1, event.nativeEvent.locationX / Math.max(width, 1))).toFixed(4)),
    Number(Math.max(0, Math.min(1, event.nativeEvent.locationY / SIGNATURE_CANVAS_HEIGHT)).toFixed(4)),
  ];

  return (
    <View
      accessibilityLabel={disabled ? 'Firma de conformidad guardada' : 'Área para firmar'}
      onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))}
      onStartShouldSetResponder={disabled ? undefined : () => true}
      onMoveShouldSetResponder={disabled ? undefined : () => true}
      onResponderTerminationRequest={disabled ? undefined : () => false}
      onResponderGrant={disabled || !onChange ? undefined : event => {
        const point = makePoint(event);
        onChange(previous => previous.length >= 32 ? previous : [...previous, [point]]);
      }}
      onResponderMove={disabled || !onChange ? undefined : event => {
        const point = makePoint(event);
        onChange(previous => {
          if (!previous.length) return previous;
          const totalPoints = previous.reduce((total, stroke) => total + stroke.length, 0);
          if (totalPoints >= 1_000) return previous;
          const next = previous.slice();
          const lastIndex = next.length - 1;
          next[lastIndex] = [...next[lastIndex], point];
          return next;
        });
      }}
      style={[styles.signaturePad, { borderColor: colors.border, backgroundColor: colors.background }]}
    >
      <Svg
        width="100%"
        height={SIGNATURE_CANVAS_HEIGHT}
        viewBox={`0 0 ${width} ${SIGNATURE_CANVAS_HEIGHT}`}
        pointerEvents="none"
      >
        {strokes.map((stroke, index) => (
          <Path
            key={index}
            d={signaturePath(stroke, width)}
            fill="none"
            stroke={colors.foreground}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}

export default function WorkOrderScreen() {
  const colors = useColors();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(Array.isArray(rawId) ? rawId[0] : rawId);
  const ordersQuery = useListMyFieldWorkOrders();
  const order = ordersQuery.data?.find(item => item.id === orderId);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return <CenteredState icon="alert-circle" title="Orden inválida" description="No se pudo leer el identificador de la orden." />;
  }
  if (ordersQuery.isLoading && !ordersQuery.data) {
    return <View style={[styles.fullScreen, { backgroundColor: colors.background }]}><LoadingState label="Abriendo orden…" /></View>;
  }
  if (ordersQuery.isError && !ordersQuery.data) {
    return (
      <CenteredState
        icon="wifi-off"
        title="No se pudo abrir la orden"
        description={ordersQuery.error instanceof Error ? ordersQuery.error.message : 'Vuelve a la agenda e inténtalo de nuevo.'}
        action={<AppButton label="Reintentar" icon="refresh-cw" variant="secondary" onPress={() => void ordersQuery.refetch()} />}
      />
    );
  }
  if (!order) {
    return <CenteredState icon="file-minus" title="Orden no disponible" description="Esta orden no está asignada a tu cuenta o ya no está disponible." />;
  }

  return <WorkOrderDetails key={order.id} order={order} />;
}

function CenteredState({
  icon,
  title,
  description,
  action,
}: {
  icon: 'alert-circle' | 'wifi-off' | 'file-minus';
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={[styles.fullScreen, { backgroundColor: colors.background }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver a la agenda"
        onPress={() => router.back()}
        style={[styles.backButton, { borderColor: colors.border }]}
      >
        <Feather name="arrow-left" size={18} color={colors.foreground} />
      </Pressable>
      <EmptyState icon={icon} title={title} description={description} action={action} />
    </View>
  );
}

function WorkOrderDetails({ order }: { order: FieldWorkOrder }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateMyFieldWorkOrder();
  const [signalDbm, setSignalDbm] = useState(order.signalDbm == null ? '' : String(order.signalDbm));
  const [ccq, setCcq] = useState(order.ccq == null ? '' : String(order.ccq));
  const [installedEquipment, setInstalledEquipment] = useState(order.installedEquipment ?? '');
  const [installedSerialNumber, setInstalledSerialNumber] = useState(order.installedSerialNumber ?? '');
  const [signatureSignerName, setSignatureSignerName] = useState('');
  const [signatureStrokes, setSignatureStrokes] = useState<SignatureStroke[]>([]);
  const [destination, setDestination] = useState(order.address ?? '');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const isRelocation = order.type.toLowerCase() === 'relocation';
  const requiresClientSignature = order.type.toLowerCase() === 'installation';
  const savedSignature = parseSavedSignature(order.signatureData);
  const isTerminal = isTerminalWorkOrder(order);
  const isInProgress = order.status.toLowerCase() === 'in_progress';
  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const updateOrder = async (data: {
    status: 'in_progress' | 'completed';
    address?: string;
    signalDbm?: number;
    ccq?: number;
    installedEquipment?: string;
    installedSerialNumber?: string;
    signatureData?: string;
  }) => {
    setError('');
    setNotice('');
    try {
      await updateMutation.mutateAsync({ id: order.id, data });
      await queryClient.invalidateQueries({ queryKey: getListMyFieldWorkOrdersQueryKey() });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la orden.');
      return false;
    }
  };

  const startVisit = async () => {
    Keyboard.dismiss();
    const updated = await updateOrder({ status: 'in_progress' });
    if (updated) setNotice('Visita iniciada. Cuando termines, registra los resultados y completa la orden.');
  };

  const finishVisit = async () => {
    const signal = parseOptionalMeasurement(signalDbm);
    const quality = parseOptionalMeasurement(ccq);
    if (Number.isNaN(signal) || (signal !== undefined && (signal < -120 || signal > 0))) {
      setError('La señal debe estar entre -120 y 0 dBm.');
      return;
    }
    if (Number.isNaN(quality) || (quality !== undefined && (quality < 0 || quality > 100))) {
      setError('El CCQ debe estar entre 0 y 100 %.');
      return;
    }
    if (isRelocation && !destination.trim()) {
      setError('Escribe la nueva dirección antes de completar la reubicación.');
      return;
    }
    if (requiresClientSignature) {
      if (!signatureSignerName.trim()) {
        setError('Escribe el nombre de la persona que firma la conformidad.');
        return;
      }
      if (!signatureStrokes.some(stroke => stroke.length >= 2)) {
        setError('Pide al cliente que firme dentro del recuadro.');
        return;
      }
    }

    const data: {
      status: 'completed';
      address?: string;
      signalDbm?: number;
      ccq?: number;
      installedEquipment?: string;
      installedSerialNumber?: string;
      signatureData?: string;
    } = { status: 'completed' };
    if (isRelocation) data.address = destination.trim();
    if (signal !== undefined) data.signalDbm = signal;
    if (quality !== undefined) data.ccq = quality;
    if (installedEquipment.trim()) data.installedEquipment = installedEquipment.trim();
    if (installedSerialNumber.trim()) data.installedSerialNumber = installedSerialNumber.trim();
    if (requiresClientSignature) {
      data.signatureData = JSON.stringify({
        version: 1,
        signerName: signatureSignerName.trim(),
        strokes: signatureStrokes,
      });
    }

    const complete = async () => {
      Keyboard.dismiss();
      const updated = await updateOrder(data);
      if (updated) router.back();
    };

    if (isRelocation) {
      Alert.alert(
        'Confirmar reubicación',
        `Al completar la orden se actualizará la dirección del cliente a:\n\n${destination.trim()}\n\nNo cambiarán el AP/SXT, la IP, la MAC ni la configuración de red.`,
        [
          { text: 'Revisar', style: 'cancel' },
          { text: 'Completar visita', onPress: () => void complete() },
        ],
      );
      return;
    }
    await complete();
  };

  const openDirections = async () => {
    const address = orderVisitAddress(order);
    if (address === 'Dirección sin registrar') {
      setError('Esta orden no tiene una dirección registrada.');
      return;
    }
    const url = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
    try {
      await Linking.openURL(url);
    } catch {
      setError('No se pudo abrir la aplicación de mapas en este dispositivo.');
    }
  };

  return (
    <View style={[styles.fullScreen, { backgroundColor: colors.background }]}>
      <View style={[styles.navBar, { paddingTop: topInset + 5, borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a mis órdenes"
          testID="order-back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, { borderColor: colors.border }, pressed && styles.pressed]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.navTitleWrap}>
          <Text style={[styles.navEyebrow, { color: colors.mutedForeground }]}>ORDEN DE CAMPO</Text>
          <Text style={[styles.navTitle, { color: colors.foreground }]}>#{order.id}</Text>
        </View>
        <StatusPill status={order.status} label={workOrderStatusLabel(order.status)} />
      </View>

      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.detailContent,
          { paddingBottom: bottomInset + 26 },
        ]}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.orderHeading}>
          <Text style={[styles.typeLabel, { color: colors.primary }]}>{workOrderTypeLabel(order.type).toUpperCase()}</Text>
          <Text style={[styles.clientName, { color: colors.foreground }]}>
            {order.clientName?.trim() || `Cliente #${order.clientId ?? 'sin asignar'}`}
          </Text>
          <Text style={[styles.orderNumber, { color: colors.mutedForeground }]}>
            {formatOrderDate(order.scheduledAt)} · {formatOrderSchedule(order)}
          </Text>
        </View>

        <Surface style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: `${colors.primary}18` }]}>
              <Feather name="map-pin" size={17} color={colors.primary} />
            </View>
            <View style={styles.infoCopy}>
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>
                {isRelocation ? 'Dirección destino' : 'Dirección de visita'}
              </Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>{orderVisitAddress(order)}</Text>
              {isRelocation && order.clientInstallationAddress ? (
                <Text style={[styles.infoFootnote, { color: colors.mutedForeground }]}>
                  Dirección registrada: {order.clientInstallationAddress}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="clock" size={17} color={colors.mutedForeground} />
            </View>
            <View style={styles.infoCopy}>
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Horario asignado</Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>
                {formatOrderDate(order.scheduledAt)} · {formatOrderSchedule(order)}
              </Text>
              {order.scheduledEndAt ? (
                <Text style={[styles.infoFootnote, { color: colors.mutedForeground }]}>
                  Fin estimado: {formatOrderTime(order.scheduledEndAt)}
                </Text>
              ) : null}
            </View>
          </View>
          <AppButton label="Abrir indicaciones" icon="navigation" variant="secondary" onPress={() => void openDirections()} testID="open-directions" />
          {order.clientId ? (
            <AppButton
              label="Alinear radios"
              icon="compass"
              onPress={() => router.push(`/orders/${order.id}/alignment`)}
              testID="open-radio-alignment"
            />
          ) : null}
        </Surface>

        {order.notes?.trim() ? (
          <Surface style={styles.notesCard}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notas de la orden</Text>
            <Text style={[styles.notesText, { color: colors.mutedForeground }]}>{order.notes}</Text>
          </Surface>
        ) : null}

        {isTerminal ? (
          <Surface style={styles.completedCard}>
            <View style={[styles.completedIcon, { backgroundColor: `${colors.success}18` }]}>
              <Feather name="check" size={19} color={colors.success} />
            </View>
            <View style={styles.completedCopy}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Visita registrada</Text>
              <Text style={[styles.notesText, { color: colors.mutedForeground }]}>
                {order.completedAt
                  ? `Completada el ${new Date(order.completedAt).toLocaleString('es')}.`
                  : 'Esta orden ya no admite cambios desde la app móvil.'}
              </Text>
            </View>
          </Surface>
        ) : isInProgress ? (
          <Surface style={styles.formCard}>
            <View style={styles.sectionHeading}>
              <View style={[styles.sectionIcon, { backgroundColor: `${colors.primary}18` }]}>
                <Feather name="activity" size={17} color={colors.primary} />
              </View>
              <View style={styles.sectionCopy}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Resultados de la visita</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
                  Registra solo las mediciones disponibles.
                </Text>
              </View>
            </View>

            {isRelocation ? (
              <TextField
                label="Nueva dirección de instalación"
                value={destination}
                onChangeText={setDestination}
                placeholder="Dirección de destino"
                autoCapitalize="sentences"
                maxLength={500}
                testID="relocation-destination"
              />
            ) : null}

            <View style={styles.measurementRow}>
              <TextField
                label="Señal (dBm)"
                value={signalDbm}
                onChangeText={setSignalDbm}
                placeholder="-65"
                keyboardType="decimal-pad"
                maxLength={8}
                testID="visit-signal"
              />
              <TextField
                label="CCQ (%)"
                value={ccq}
                onChangeText={setCcq}
                placeholder="95"
                keyboardType="decimal-pad"
                maxLength={6}
                testID="visit-ccq"
              />
            </View>

            <TextField
              label="Equipo reportado"
              value={installedEquipment}
              onChangeText={setInstalledEquipment}
              placeholder="Modelo instalado"
              maxLength={200}
              helper="Se guarda como instantánea de la orden; no modifica el inventario."
              testID="visit-equipment"
            />
            <TextField
              label="Número de serie"
              value={installedSerialNumber}
              onChangeText={setInstalledSerialNumber}
              placeholder="Serie del equipo"
              maxLength={128}
              testID="visit-serial"
            />

            {requiresClientSignature ? (
              <View style={styles.signatureSection}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Firma de conformidad</Text>
                  <Text style={[styles.signatureHint, { color: colors.mutedForeground }]}>
                    Registra el nombre y la firma de la persona que recibe el trabajo.
                  </Text>
                </View>
                <TextField
                  label="Nombre de quien firma"
                  value={signatureSignerName}
                  onChangeText={setSignatureSignerName}
                  placeholder="Nombre y apellidos"
                  autoCapitalize="words"
                  maxLength={120}
                  testID="signature-signer-name"
                />
                <SignaturePad strokes={signatureStrokes} onChange={setSignatureStrokes} />
                <View style={styles.signatureActions}>
                  <Text style={[styles.signatureHint, { color: colors.mutedForeground }]}>
                    Firma con el dedo dentro del recuadro.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Borrar firma"
                    onPress={() => setSignatureStrokes([])}
                    style={({ pressed }) => [styles.signatureClearButton, pressed && styles.pressed]}
                  >
                    <Text style={[styles.signatureClearText, { color: colors.primary }]}>Borrar</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {isRelocation ? (
              <Text style={[styles.relocationWarning, { color: colors.warning }]}>
                Al completar, solo se actualizarán la dirección y el historial del cliente. La IP, MAC y configuración de red no cambiarán.
              </Text>
            ) : null}

            {notice ? (
              <View style={[styles.noticeBox, { backgroundColor: `${colors.success}15`, borderColor: `${colors.success}40` }]}>
                <Feather name="check-circle" size={16} color={colors.success} />
                <Text style={[styles.noticeText, { color: colors.success }]}>{notice}</Text>
              </View>
            ) : null}
            {error ? (
              <View style={[styles.noticeBox, { backgroundColor: `${colors.destructive}15`, borderColor: `${colors.destructive}40` }]}>
                <Feather name="alert-circle" size={16} color={colors.destructive} />
                <Text style={[styles.noticeText, { color: colors.destructive }]}>{error}</Text>
              </View>
            ) : null}

            <AppButton
              label={isRelocation ? 'Confirmar y completar reubicación' : 'Completar visita'}
              icon="check"
              loading={updateMutation.isPending}
              onPress={() => void finishVisit()}
              testID="complete-work-order"
            />
          </Surface>
        ) : (
          <Surface style={styles.startCard}>
            <View style={[styles.sectionIcon, { backgroundColor: `${colors.primary}18` }]}>
              <Feather name="play" size={17} color={colors.primary} />
            </View>
            <View style={styles.startCopy}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>¿Comenzar esta visita?</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
                Al iniciar, la orden quedará marcada como en curso.
              </Text>
            </View>
            {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
            <AppButton
              label="Iniciar visita"
              icon="play"
              loading={updateMutation.isPending}
              onPress={() => void startVisit()}
              testID="start-work-order"
            />
          </Surface>
        )}

        {isTerminal && savedSignature ? (
          <Surface style={styles.signatureSection}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Conformidad registrada</Text>
            <Text style={[styles.signatureHint, { color: colors.mutedForeground }]}>
              Firmó {savedSignature.signerName}
              {savedSignature.signedAt ? ` · ${new Date(savedSignature.signedAt).toLocaleString('es')}` : ''}
            </Text>
            <SignaturePad strokes={savedSignature.strokes} disabled />
          </Surface>
        ) : null}

        <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
          La app muestra únicamente órdenes asignadas a tu cuenta.
        </Text>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 13,
  },
  navTitleWrap: {
    flex: 1,
    gap: 2,
  },
  navEyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 1.1,
  },
  navTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
  },
  detailContent: {
    paddingHorizontal: 18,
    paddingTop: 19,
    gap: 13,
  },
  orderHeading: {
    gap: 5,
    paddingHorizontal: 2,
    paddingBottom: 3,
  },
  typeLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.2,
  },
  clientName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 25,
    letterSpacing: -0.6,
  },
  orderNumber: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  infoCard: {
    gap: 13,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  infoIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  infoCopy: {
    flex: 1,
    gap: 4,
    paddingTop: 1,
  },
  infoLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  infoValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 19,
  },
  infoFootnote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
  notesCard: {
    gap: 8,
  },
  notesText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  signatureSection: {
    gap: 9,
  },
  signatureHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  signaturePad: {
    height: SIGNATURE_CANVAS_HEIGHT,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  signatureActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  signatureClearButton: {
    minHeight: 36,
    minWidth: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signatureClearText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  completedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  completedIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  completedCopy: {
    flex: 1,
    gap: 4,
  },
  formCard: {
    gap: 16,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  sectionCopy: {
    flex: 1,
    gap: 3,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  sectionSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  measurementRow: {
    flexDirection: 'row',
    gap: 11,
  },
  relocationWarning: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 17,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
  },
  noticeText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  startCard: {
    gap: 12,
  },
  startCopy: {
    gap: 4,
  },
  footerNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    textAlign: 'center',
    paddingTop: 4,
  },
  pressed: {
    opacity: 0.75,
  },
});