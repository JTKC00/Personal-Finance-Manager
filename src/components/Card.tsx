import {PropsWithChildren} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors, spacing} from '../theme';

type Props = PropsWithChildren<{
  title?: string;
}>;

export function Card({title, children}: Props) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
    padding: spacing.lg
  },
  title: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
    marginBottom: spacing.md
  }
});
