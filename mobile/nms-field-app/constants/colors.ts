/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const nmsPalette = {
  text: '#f8fafc',
  tint: '#0ea5e9',
  background: '#0b1120',
  foreground: '#f8fafc',
  card: '#111827',
  cardForeground: '#f8fafc',
  primary: '#0ea5e9',
  primaryForeground: '#f8fafc',
  secondary: '#222a39',
  secondaryForeground: '#f8fafc',
  muted: '#1c2330',
  mutedForeground: '#94a3b8',
  accent: '#222a39',
  accentForeground: '#f8fafc',
  destructive: '#ef4444',
  destructiveForeground: '#ffffff',
  success: '#34d399',
  warning: '#fbbf24',
  border: '#222a39',
  input: '#293241',
};

const colors = {
  light: { ...nmsPalette },
  dark: { ...nmsPalette },
  radius: 5,
};

export default colors;
