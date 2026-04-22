import {PropsWithChildren} from 'react';
import {SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import {colors, spacing} from '../theme';

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
}>;

export function Screen({title, subtitle, children}: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 96
  },
  header: {
    marginBottom: spacing.lg
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600'
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4
  }
});
