import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../lib/theme';

export default function Card({title, subtitle}:{title:string; subtitle?:string}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing(2),
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: theme.color.divider,
  },
  title: { fontSize: 16, fontWeight: '800', color: theme.color.text },
  sub:   { marginTop: 6, color: theme.color.muted },
});
