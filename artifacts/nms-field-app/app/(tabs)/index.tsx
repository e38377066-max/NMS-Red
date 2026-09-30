import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCreateSupportTicket, useListMyFieldWorkOrders, type FieldWorkOrder } from '@workspace/api-client-react';
import { EmptyState, LoadingState, StatusPill, Surface } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import {
  formatOrderDate,
  formatOrderSchedule,
  isTerminalWorkOrder,
  orderVisitAddress,
  workOrderStatusLabel,
  workOrderTypeLabel,
} from '@/lib/field-work';
import { useAuth } from '@/providers/auth';

type OrderFilter = 'active' | 'history';

export default function MyOrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const ordersQuery = useListMyFieldWorkOrders();
  const createAlignmentRequest = useCreateSupportTicket();
  const [filter, setFilter] = useState<OrderFilter>('active');
  const [requestVisible, setRequestVisible] = useState(false);
  const [requestClient, setRequestClient] = useState('');
  const [requestDevice, setRequestDevice] = useState('');
  const [requestDetails, setRequestDetails] = useState('');
  const [requestError, setRequestError] = useState('');
  const [requestTicketId, setRequestTicketId] = useState<number | null>(null);
  const orders = ordersQuery.data ?? [];

  const activeOrders = useMemo(
    () => orders
      .filter(order => !isTerminalWorkOrder(order))
      .sort((a, b) => Date.parse(a.scheduledAt ?? a.createdAt) - Date.parse(b.scheduledAt ?? b.createdAt)),
    [orders],
  );
  const historyOrders = useMemo(
    () => orders
      .filter(isTerminalWorkOrder)
      .sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt)),
    [orders],
  );
  const visibleOrders = filter === 'active' ? activeOrders : historyOrders;
  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 104 : insets.bottom + 105;

  const openOrder = (order: FieldWorkOrder) => {
    router.push({ pathname: '/orders/[id]', params: { id: String(order.id) } });
  };

  const closeRequest = () => {
    setRequestVisible(false);
    setRequestClient('');
    setRequestDevice('');
    setRequestDetails('');
    setRequestError('');
    setRequestTicketId(null);
  };

  const submitAlignmentRequest = async () => {
    const client = requestClient.trim();
    if (!client) {
      setRequestError('Indica el nombre del cliente o la dirección del servicio.');
      return;
    }
    setRequestError('');
    const description = [
      `Solicitud enviada desde NMS Field por ${user?.username ?? 'un técnico'}.`,
      `Cliente o dirección: ${client}`,
      requestDevice.trim() ? `Equipo, MAC o IP: ${requestDevice.trim()}` : null,
      requestDetails.trim() ? `Trabajo solicitado: ${requestDetails.trim()}` : null,
      'Revisar y crear o asignar una orden antes de consultar los radios.',
    ].filter(Boolean).join('\n\n').slice(0, 4000);

    try {
      const ticket = await createAlignmentRequest.mutateAsync({
        data: {
          subject: `Solicitud de alineación: ${client}`.slice(0, 200),
          description,
          category: 'alignment_request',
          priority: 'normal',
        },
      });
      setRequestTicketId(ticket.id);
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : 'No se pudo enviar la solicitud. Inténtalo de nuevo.');
    }
  };

  const renderOrder = ({ item }: { item: FieldWorkOrder }) => (
    <OrderCard order={item} onPress={() => openOrder(item)} />
  );

  if (ordersQuery.isLoading && !ordersQuery.data) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <LoadingState label="Buscando tus órdenes asignadas…" />
      </View>
    );
  }

  if (ordersQuery.isError && !ordersQuery.data) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="wifi-off"
          title="No se pudo cargar la agenda"
          description={ordersQuery.error instanceof Error ? ordersQuery.error.message : 'Comprueba la conexión e inténtalo de nuevo.'}
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver a cargar las órdenes"
              testID="retry-orders"
              onPress={() => void ordersQuery.refetch()}
              style={[styles.retry, { backgroundColor: colors.secondary }]}
            >
              <Feather name="refresh-cw" size={15} color={colors.primary} />
              <Text style={[styles.retryText, { color: colors.foreground }]}>Reintentar</Text>
            </Pressable>
          }
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 9 }]}>
        <View style={styles.headerTop}>
          <View style={styles.wordmark}>
            <View style={[styles.wordmarkMark, { backgroundColor: colors.primary }]}>
              <Feather name="radio" size={15} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.wordmarkText, { color: colors.mutedForeground }]}>NMS FIELD</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Actualizar órdenes"
            testID="refresh-orders"
            disabled={ordersQuery.isFetching}
            onPress={() => void ordersQuery.refetch()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>AGENDA DE CAMPO</Text>
        <Text style={[styles.heading, { color: colors.foreground }]}>
          Hola, {user?.username ?? 'técnico'}
        </Text>
        <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
          {activeOrders.length === 1
            ? 'Tienes 1 visita pendiente.'
            : `Tienes ${activeOrders.length} visitas pendientes.`}
        </Text>
      </View>

      <View style={[styles.filterRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
        <FilterButton
          selected={filter === 'active'}
          label={`Activas · ${activeOrders.length}`}
          onPress={() => setFilter('active')}
        />
        <FilterButton
          selected={filter === 'history'}
          label={`Historial · ${historyOrders.length}`}
          onPress={() => setFilter('history')}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Solicitar una alineación de radio"
        testID="open-alignment-request"
        onPress={() => {
          setRequestError('');
          setRequestTicketId(null);
          setRequestVisible(true);
        }}
        style={({ pressed }) => [styles.requestCardPressable, pressed && styles.pressed]}
      >
        <Surface style={[styles.requestCard, { borderColor: colors.border }]}>
          <View style={[styles.requestIcon, { backgroundColor: `${colors.primary}22` }]}>
            <Feather name="compass" size={19} color={colors.primary} />
          </View>
          <View style={styles.requestCopy}>
            <Text style={[styles.requestTitle, { color: colors.foreground }]}>Solicitar alineación</Text>
            <Text style={[styles.requestDescription, { color: colors.mutedForeground }]}>
              Envía los datos a supervisión para que prepare la orden.
            </Text>
          </View>
          <Feather name="chevron-right" size={19} color={colors.primary} />
        </Surface>
      </Pressable>

      <FlatList
        data={visibleOrders}
        keyExtractor={item => String(item.id)}
        renderItem={renderOrder}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: bottomInset, flexGrow: visibleOrders.length === 0 ? 1 : undefined },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={ordersQuery.isRefetching}
            onRefresh={() => void ordersQuery.refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon={filter === 'active' ? 'check-circle' : 'archive'}
            title={filter === 'active' ? 'Todo al día' : 'Sin visitas cerradas'}
            description={filter === 'active'
              ? 'Las órdenes asignadas aparecerán aquí. Si necesitas una alineación, usa el botón de arriba.'
              : 'Las visitas que completes quedarán guardadas en este historial.'}
          />
        }
      />

      <Modal
        visible={requestVisible}
        transparent
        animationType="slide"
        onRequestClose={closeRequest}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            style={styles.modalKeyboard}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              style={[styles.requestSheet, { backgroundColor: colors.card, borderColor: colors.border }]}
              contentContainerStyle={[styles.requestSheetContent, { paddingBottom: Math.max(insets.bottom, 20) }]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.requestModalHeader}>
                <View style={styles.requestModalHeading}>
                  <Text style={[styles.requestEyebrow, { color: colors.primary }]}>NUEVA SOLICITUD</Text>
                  <Text style={[styles.requestModalTitle, { color: colors.foreground }]}>Alinear un radio</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar solicitud"
                  testID="close-alignment-request"
                  onPress={closeRequest}
                  hitSlop={10}
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </Pressable>
              </View>

              {requestTicketId !== null ? (
                <View style={styles.requestSuccess}>
                  <View style={[styles.successIcon, { backgroundColor: `${colors.primary}22` }]}>
                    <Feather name="check" size={21} color={colors.primary} />
                  </View>
                  <Text style={[styles.requestSuccessTitle, { color: colors.foreground }]}>Solicitud enviada</Text>
                  <Text style={[styles.requestDescription, { color: colors.mutedForeground }]}>
                    Folio #{requestTicketId}. Supervisión revisará los datos y creará o asignará una orden. Todavía no se consultó ningún radio.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    testID="dismiss-alignment-request"
                    onPress={closeRequest}
                    style={({ pressed }) => [
                      styles.requestSubmit,
                      { backgroundColor: colors.primary },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.requestSubmitText, { color: colors.primaryForeground }]}>Listo</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Text style={[styles.requestDescription, { color: colors.mutedForeground }]}>
                    Describe dónde se necesita el trabajo. Supervisión revisará la solicitud y asignará una orden antes de habilitar el acceso a los radios.
                  </Text>

                  <RequestInput
                    label="Cliente o dirección del servicio"
                    value={requestClient}
                    onChangeText={setRequestClient}
                    placeholder="Nombre del cliente o dirección"
                    colors={colors}
                    required
                    testID="alignment-request-client"
                    maxLength={180}
                  />
                  <RequestInput
                    label="Equipo, MAC o IP (opcional)"
                    value={requestDevice}
                    onChangeText={setRequestDevice}
                    placeholder="Identificador del radio, si lo conoces"
                    colors={colors}
                    testID="alignment-request-device"
                    maxLength={180}
                  />
                  <RequestInput
                    label="Detalles (opcional)"
                    value={requestDetails}
                    onChangeText={setRequestDetails}
                    placeholder="Motivo, síntomas o indicaciones para supervisión"
                    colors={colors}
                    multiline
                    testID="alignment-request-details"
                    maxLength={1800}
                  />

                  {requestError ? (
                    <Text accessibilityRole="alert" style={[styles.requestError, { color: colors.destructive }]}>
                      {requestError}
                    </Text>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: createAlignmentRequest.isPending }}
                    testID="submit-alignment-request"
                    disabled={createAlignmentRequest.isPending}
                    onPress={() => void submitAlignmentRequest()}
                    style={({ pressed }) => [
                      styles.requestSubmit,
                      { backgroundColor: colors.primary },
                      pressed && styles.pressed,
                      createAlignmentRequest.isPending && styles.requestSubmitDisabled,
                    ]}
                  >
                    {createAlignmentRequest.isPending ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <Feather name="send" size={15} color={colors.primaryForeground} />
                    )}
                    <Text style={[styles.requestSubmitText, { color: colors.primaryForeground }]}>
                      {createAlignmentRequest.isPending ? 'Enviando…' : 'Enviar a supervisión'}
                    </Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function RequestInput({
  label,
  value,
  onChangeText,
  placeholder,
  colors,
  required = false,
  multiline = false,
  testID,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  colors: ReturnType<typeof useColors>;
  required?: boolean;
  multiline?: boolean;
  testID: string;
  maxLength: number;
}) {
  return (
    <View style={styles.requestInputGroup}>
      <Text style={[styles.requestInputLabel, { color: colors.foreground }]}>
        {label}{required ? ' *' : ''}
      </Text>
      <TextInput
        accessibilityLabel={label}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        maxLength={maxLength}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[
          styles.requestInput,
          multiline && styles.requestInputMultiline,
          { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
        ]}
      />
    </View>
  );
}

function FilterButton({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      testID={`orders-filter-${selected ? 'selected' : 'other'}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterButton,
        selected && { backgroundColor: colors.card, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.filterText, { color: selected ? colors.foreground : colors.mutedForeground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function OrderCard({ order, onPress }: { order: FieldWorkOrder; onPress: () => void }) {
  const colors = useColors();
  const isRelocation = order.type.toLowerCase() === 'relocation';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir orden ${order.id}, ${workOrderTypeLabel(order.type)}`}
      testID={`work-order-${order.id}`}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Surface style={styles.orderCard}>
        <View style={styles.cardTop}>
          <View style={styles.orderIcon}>
            <Feather
              name={isRelocation ? 'map-pin' : order.type.toLowerCase() === 'installation' ? 'wifi' : 'tool'}
              size={17}
              color={colors.primary}
            />
          </View>
          <View style={styles.cardTopText}>
            <Text style={[styles.orderType, { color: colors.foreground }]}>
              {workOrderTypeLabel(order.type)}
            </Text>
            <Text style={[styles.orderMeta, { color: colors.mutedForeground }]}>
              Orden #{order.id}{order.clientName ? ` · ${order.clientName}` : ''}
            </Text>
          </View>
          <StatusPill status={order.status} label={workOrderStatusLabel(order.status)} />
        </View>

        <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />

        <View style={styles.detailLine}>
          <Feather name="calendar" size={15} color={colors.mutedForeground} />
          <Text style={[styles.detailText, { color: colors.foreground }]}>
            {formatOrderDate(order.scheduledAt)} · {formatOrderSchedule(order)}
          </Text>
        </View>
        <View style={styles.detailLine}>
          <Feather name="map-pin" size={15} color={colors.mutedForeground} />
          <Text style={[styles.detailText, styles.addressText, { color: colors.mutedForeground }]} numberOfLines={2}>
            {isRelocation ? `Destino: ${orderVisitAddress(order)}` : orderVisitAddress(order)}
          </Text>
          <Feather name="arrow-up-right" size={15} color={colors.primary} />
        </View>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 21,
    paddingBottom: 17,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  wordmarkMark: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  wordmarkText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 1.4,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.35,
    marginBottom: 6,
  },
  heading: {
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    letterSpacing: -0.65,
  },
  subheading: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 5,
  },
  filterRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 6,
    padding: 4,
    borderWidth: 1,
    borderRadius: 13,
    gap: 4,
  },
  filterButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 39,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 9,
    paddingHorizontal: 8,
  },
  filterText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  orderCard: {
    gap: 13,
    padding: 15,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  orderIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  cardTopText: {
    flex: 1,
    gap: 3,
  },
  orderType: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  orderMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
  },
  detailLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  detailText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 18,
  },
  addressText: {
    fontFamily: 'Inter_400Regular',
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  retryText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  requestCardPressable: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 2,
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
  },
  requestIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  requestCopy: {
    flex: 1,
    gap: 3,
  },
  requestTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  requestDescription: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  modalKeyboard: {
    width: '100%',
  },
  requestSheet: {
    maxHeight: '90%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  requestSheetContent: {
    gap: 15,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  requestModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  requestModalHeading: {
    flex: 1,
    gap: 5,
  },
  requestEyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.2,
  },
  requestModalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 23,
  },
  requestInputGroup: {
    gap: 7,
  },
  requestInputLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  requestInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  requestInputMultiline: {
    minHeight: 100,
    paddingTop: 12,
  },
  requestError: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
  },
  requestSubmit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  requestSubmitText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  requestSubmitDisabled: {
    opacity: 0.65,
  },
  requestSuccess: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
  },
  successIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  requestSuccessTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 19,
  },
  pressed: {
    opacity: 0.76,
  },
});
