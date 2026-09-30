import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/providers/auth';

export default function IndexRoute() {
  const colors = useColors();
  const { user, isRestoring } = useAuth();

  if (isRestoring) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Redirect href={user ? '/(tabs)' : '/login'} />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});