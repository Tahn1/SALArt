import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { theme } from '../lib/theme';

export default function Button({
  title, onPress, loading, variant='filled', disabled
}: {
  title: string; onPress?: ()=>void; loading?: boolean;
  variant?: 'filled'|'outline'|'ghost'; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled||loading}
      style={({pressed})=>[
        styles.base,
        variant==='filled' && { backgroundColor: theme.color.brand },
        variant==='outline' && { borderWidth:1, borderColor: theme.color.brand, backgroundColor: 'transparent' },
        variant==='ghost' && { backgroundColor: 'transparent' },
        (disabled||loading) && { opacity: .6 },
        pressed && { transform:[{scale:.98}] },
      ]}>
      {loading ? <ActivityIndicator/> : null}
      <Text style={[
        styles.text,
        variant!=='filled' && { color: theme.color.brand }
      ]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: theme.color.brand,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
  },
  text: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: .3 },
});
