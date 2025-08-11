// app/home.tsx
import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';

export default function Home() {
  const isDark = useColorScheme() === 'dark';
  const BG = isDark ? '#2B241F' : '#F8F4EF';
  const TXT = isDark ? '#EDEAE6' : '#42362F';

  return (
    <View style={[styles.wrap, { backgroundColor: BG }]}>
      <Text style={[styles.h1, { color: TXT }]}>Home</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 20, fontWeight: '800' },
});
