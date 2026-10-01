import { useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListMyFieldWorkOrders } from '@workspace/api-client-react';
import { AppButton, Surface } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { isTerminalWorkOrder } from '@/lib/field-work';
import { useAuth } from '@/providers/auth';

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operaciones',
  technician: 'Técnico de campo',
};

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const ordersQuery = useListMyFieldWorkOrders();
  const [error, setError] = useState('');
  const orders = ordersQuery.data ?? [];
  const activeCount = orders.filter(order => !isTerminalWorkOrder(order)).length;
  const completedCount = orders.filter(order => order.status.toLowerCase() === 'completed').length;
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const doSignOut = async () => {
    setError('');
    try {
      await signOut();
      router.replace('/login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cerrar la sesión.');
    }
  };

  const confirmSignOut = () => {
    Alert.alert(
      'Cerrar sesión',
      'Tendrás que volver a iniciar sesión para consultar tus órdenes.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: () => void doSignOut() },
      ],
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 17 }]}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>CUENTA DE CAMPO</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Tu perfil</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Información de la sesión activa.
        </Text>
      </View>

      <View style={styles.content}>
        <Surface style={styles.userCard}>
          <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
            <Feather name="user" size={22} color={colors.primary} />
          </View>
          <View style={styles.userDetails}>
            <Text style={[styles.userName, { color: colors.foreground }]}>{user?.username ?? 'Usuario'}</Text>
            <Text style={[styles.userRole, { color: colors.mutedForeground }]}>
              {roleLabels[user?.role ?? ''] ?? user?.role ?? 'Personal autorizado'}
            </Text>
          </View>
          <View style={[styles.sessionMark, { backgroundColor: `${colors.success}20` }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
          </View>
        </Surface>

        <View style={styles.statsRow}>
          <Surface style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{activeCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Órdenes activas</Text>
          </Surface>
          <Surface style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.success }]}>{completedCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Visitas completadas</Text>
          </Surface>
        </View>

        <Surface style={styles.securityCard}>
          <View style={[styles.securityIcon, { backgroundColor: `${colors.primary}18` }]}>
            <Feather name="shield" size={17} color={colors.primary} />
          </View>
          <View style={styles.securityCopy}>
            <Text style={[styles.securityTitle, { color: colors.foreground }]}>Sesión protegida</Text>
            <Text style={[styles.securityText, { color: colors.mutedForeground }]}>
              {Platform.OS === 'web'
                ? 'Tus órdenes se filtran en el servidor. En esta vista web, la sesión solo se conserva mientras la app está abierta.'
                : 'Tus órdenes se filtran en el servidor según la cuenta asignada. La sesión se guarda de forma segura en este dispositivo.'}
            </Text>
          </View>
        </Surface>

        {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

        <AppButton
          label="Cerrar sesión"
          icon="log-out"
          variant="secondary"
          onPress={confirmSignOut}
          testID="sign-out"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 21,
    paddingBottom: 18,
  },
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.35,
    marginBottom: 6,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    letterSpacing: -0.65,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 5,
  },
  content: {
    paddingHorizontal: 20,
    gap: 13,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 15,
  },
  avatar: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  userDetails: {
    flex: 1,
    gap: 4,
  },
  userName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  userRole: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  sessionMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    padding: 15,
    gap: 4,
  },
  statValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
  },
  statLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  securityCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 15,
  },
  securityIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  securityCopy: {
    flex: 1,
    gap: 4,
  },
  securityTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  securityText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 17,
  },
  error: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    paddingHorizontal: 3,
  },
});