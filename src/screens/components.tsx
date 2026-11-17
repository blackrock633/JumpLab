import React, { createContext, useContext } from 'react';
import { Pressable, Text, TextInput, View, useColorScheme, StyleSheet } from 'react-native';
export const palette = {
  light: { bg: '#F7F6F2', ink: '#182E2A', muted: '#485E59', accent: '#17634D', surface: '#FFFFFF', line: '#71847E', danger: '#9C2727' },
  dark: { bg: '#101D1A', ink: '#F2F7F3', muted: '#BCD1C8', accent: '#8CE2B5', surface: '#20342E', line: '#8FA99D', danger: '#FFB4AF' },
};
export const Theme = createContext(palette.light);
export const useTheme = () => useContext(Theme);
export function Appearance({ children }: { children: React.ReactNode }) { return <Theme.Provider value={palette[useColorScheme() === 'dark' ? 'dark' : 'light']}>{children}</Theme.Provider>; }
export function Copy({ children, heading = false, muted = false }: { children: React.ReactNode; heading?: boolean; muted?: boolean }) {
  const t = useTheme(); return <Text accessibilityRole={heading ? 'header' : undefined} style={{ color: muted ? t.muted : t.ink, fontSize: heading ? 26 : 17, fontWeight: heading ? '700' : '400', marginVertical: 7, flexShrink: 1 }}>{children}</Text>;
}
export function Button({ title, onPress, selected, disabled, danger, testID }: { title: string; onPress: () => void; selected?: boolean; disabled?: boolean; danger?: boolean; testID?: string }) {
  const t = useTheme(); return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 48, minWidth: 48, padding: 12, marginVertical: 4, borderRadius: 10, borderWidth: selected ? 2 : 1, borderColor: danger ? t.danger : selected ? t.accent : t.line, backgroundColor: t.surface, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}>
    <Text style={{ fontSize: 17, fontWeight: selected ? '700' : '500', color: danger ? t.danger : t.ink }}>{title}</Text>
  </Pressable>;
}
export function Field({ label, value, onChange, numeric, secret }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean; secret?: boolean }) {
  const t = useTheme(); return <View><Copy>{label}</Copy><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} secureTextEntry={secret}
    keyboardType={numeric ? 'decimal-pad' : 'default'} autoCapitalize="none" autoCorrect={false} textContentType={secret ? 'password' : 'none'}
    style={{ minHeight: 48, color: t.ink, backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 17 }} /></View>;
}
export function Choices<T extends string>({ label, values, value, onChange }: { label: string; values: readonly T[]; value: T; onChange: (v: T) => void }) {
  return <View><Copy>{label}</Copy>{values.map(v => <Button key={v} title={v} selected={v === value} onPress={() => onChange(v)} />)}</View>;
}
export const styles = StyleSheet.create({ block: { marginVertical: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
