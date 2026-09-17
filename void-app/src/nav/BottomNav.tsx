// Floating pill tab bar — patch3 §1 5a-B, port of .bnav / .ni:
//   .bnav{margin:12px 16px 16px;border-radius:24px;background:var(--nav-bg);backdrop-filter:blur(14px);
//         box-shadow:var(--nav-shadow),inset 0 1px 0 rgba(255,255,255,.07);padding:13px 18px 10px}
//         LIGHT: inset highlight rgba(255,255,255,.85)
//   .ni{flex:1;column;align-items:center;gap:7px;color:var(--nav-dim);transition:color .2s}  .ni.on{color:var(--gold)}
//   .ni-icon 19x19 hairline VICON (home/globe/search/dms/user)
//   .ni-badge{top:-1px;right:-2px;4x4;radius 50%;background:var(--gold)}  (DMS unread, no glow/count)
//   .ni-bar{12x1;transparent}  .ni.on .ni-bar{background:var(--gold);opacity:.7}
// Icons only, no labels.
import React, { memo, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons/Icon';
import { NAV_ICONS } from '../ui/icons/paths';
import { useDmUnread } from './badges';
import { NAV_MARGIN, useBottomNavOffset } from './layout';

const LABELS: Record<string, string> = { void: 'Void', globe: 'Globe', search: 'Search', messages: 'Messages', profile: 'Me' };
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

const NavItem = memo(function NavItem({ name, focused, onPress, onLongPress, badge }: { name: keyof typeof NAV_ICONS; focused: boolean; onPress: () => void; onLongPress: () => void; badge: boolean }) {
  const { colors } = useTheme();
  const on = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(focused ? 1 : 0, { duration: 200, easing: EASE, reduceMotion: ReduceMotion.Never });
  }, [focused, on]);
  const goldStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const barStyle = useAnimatedStyle(() => ({ opacity: 0.7 * on.value }));
  const icon = NAV_ICONS[name];
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={LABELS[name]}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.item}
      hitSlop={{ top: 13, bottom: 10 }}
    >
      <View style={styles.icon}>
        <Animated.View style={[StyleSheet.absoluteFill, dimStyle]}>
          <Icon name={icon} size={19} color={colors.navDim} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, goldStyle]}>
          <Icon name={icon} size={19} color={colors.gold} />
        </Animated.View>
        {badge ? <View style={[styles.badge, { backgroundColor: colors.gold }]} /> : null}
      </View>
      <Animated.View style={[styles.bar, { backgroundColor: colors.gold }, barStyle]} />
    </Pressable>
  );
});

export function BottomNav({ state, descriptors, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const { colors, isLight } = theme;
  const bottom = useBottomNavOffset();
  const dmUnread = useDmUnread();

  const focusedKey = state.routes[state.index]?.key;
  const focusedOptions = focusedKey ? (descriptors[focusedKey]?.options as any) : null;
  if (focusedOptions?.tabBarStyle?.display === 'none') return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom, left: NAV_MARGIN.side, right: NAV_MARGIN.side }]}>
      <View style={[styles.pill, { boxShadow: colors.navShadow }]}>
        <View style={[StyleSheet.absoluteFill, styles.clip]} pointerEvents="none">
          {Platform.OS === 'ios' ? <BlurView intensity={28} tint={isLight ? 'light' : 'dark'} style={StyleSheet.absoluteFill} /> : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.navBg }]} />
        </View>
        {state.routes.map((route, index) => {
          const name = route.name as keyof typeof NAV_ICONS;
          if (!(name in NAV_ICONS)) return null;
          const focused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) (navigation as any).navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
          return <NavItem key={route.key} name={name} focused={focused} onPress={onPress} onLongPress={onLongPress} badge={name === 'messages' && dmUnread} />;
        })}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { boxShadow: `inset 0px 1px 0px ${isLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.07)'}` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 50 },
  pill: { borderRadius: 24, paddingTop: 13, paddingBottom: 10, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
  clip: { borderRadius: 24, overflow: 'hidden' },
  item: { flex: 1, flexDirection: 'column', alignItems: 'center', gap: 7 },
  icon: { width: 19, height: 19, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -1, right: -2, width: 4, height: 4, borderRadius: 2 },
  bar: { width: 12, height: 1 },
});

export default BottomNav;
