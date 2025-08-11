// app/_layout.tsx
import React from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';

export default function Root() {
  const isDark = useColorScheme() === 'dark';
  const BG = isDark ? '#2B241F' : '#F8F4EF';

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG },
        }}
      />
    </>
  );
}
