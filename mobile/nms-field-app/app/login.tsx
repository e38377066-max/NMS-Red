import { useState } from 'react';
import {
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { AppButton } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/providers/auth';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, isRestoring, isSigningIn, signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  if (!isRestoring && user) return <Redirect href="/(tabs)" />;

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('Escribe tu usuario y contraseña para continuar.');
      return;
    }
    Keyboard.dismiss();
    setError('');
    try {
      await signIn(username, password);
      router.replace('/(tabs)');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.');
    }
  };

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: topInset + 24,
          paddingBottom: bottomInset + 28,
          backgroundColor: colors.background,
        },
      ]}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.content}>
        <View style={styles.brandBlock}>
          <Image
            source={require('../assets/images/icon.png')}
            style={styles.logo}
            accessibilityLabel="Imperio AP"
          />
          <View style={[styles.brandTag, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.brandTagText, { color: colors.mutedForeground }]}>OPERACIONES ISP</Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Imperio AP</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Tus órdenes de campo, listas para la visita.
          </Text>
        </View>

        <View style={[styles.form, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.formHeading}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Iniciar sesión</Text>
            <Text style={[styles.formHint, { color: colors.mutedForeground }]}>
              Usa la cuenta de operación que ya tienes.
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Usuario</Text>
            <TextInput
              value={username}
              onChangeText={value => {
                setUsername(value);
                if (error) setError('');
              }}
              placeholder="Tu usuario"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
              onSubmitEditing={() => undefined}
              accessibilityLabel="Usuario"
              testID="login-username"
              style={[
                styles.input,
                { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, borderRadius: colors.radius + 5 },
              ]}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Contraseña</Text>
            <View style={[
              styles.passwordWrap,
              { backgroundColor: colors.background, borderColor: colors.border, borderRadius: colors.radius + 5 },
            ]}>
              <TextInput
                value={password}
                onChangeText={value => {
                  setPassword(value);
                  if (error) setError('');
                }}
                placeholder="Tu contraseña"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                accessibilityLabel="Contraseña"
                testID="login-password"
                style={[styles.passwordInput, { color: colors.foreground }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                testID="toggle-password-visibility"
                hitSlop={10}
                onPress={() => setShowPassword(value => !value)}
                style={styles.eyeButton}
              >
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={19} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>

          {error ? (
            <View style={[styles.errorBox, { backgroundColor: `${colors.destructive}18`, borderColor: `${colors.destructive}55` }]}>
              <Feather name="alert-circle" size={16} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : null}

          <AppButton
            label="Entrar a mis órdenes"
            icon="arrow-right"
            loading={isSigningIn}
            onPress={() => void submit()}
            testID="login-submit"
          />
        </View>

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          Acceso protegido para personal autorizado.
        </Text>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: 26,
  },
  brandBlock: {
    alignItems: 'center',
    gap: 9,
  },
  logo: {
    width: 74,
    height: 74,
    borderRadius: 23,
    marginBottom: 2,
  },
  brandTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  brandTagText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.2,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 31,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  form: {
    borderWidth: 1,
    borderRadius: 17,
    padding: 20,
    gap: 18,
  },
  formHeading: {
    gap: 5,
    marginBottom: 1,
  },
  formTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 19,
  },
  formHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  input: {
    minHeight: 51,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  passwordWrap: {
    minHeight: 51,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 12,
  },
  passwordInput: {
    flex: 1,
    minHeight: 49,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  eyeButton: {
    minWidth: 32,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
  },
  errorText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  footer: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    textAlign: 'center',
  },
});