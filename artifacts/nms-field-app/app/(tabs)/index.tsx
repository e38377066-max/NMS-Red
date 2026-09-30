import { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListMyFieldWorkOrders, type FieldWorkOrder } from '@workspace/api-client-react';
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
  const [filter, setFilter] = useState<OrderFilter>('active');
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
              ? 'Las órdenes asignadas a tu cuenta aparecerán aquí.'
              : 'Las visitas que completes quedarán guardadas en este historial.'}
          />
        }
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
  pressed: {
    opacity: 0.76,
  },
});
