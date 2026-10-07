// Floating pill tab bar — patch3 §1 5a-B, port of .bnav / .ni:
//   .bnav{margin:12px 16px 16px;border-radius:24px;background:var(--nav-bg);backdrop-filter:blur(14px);
//         box-shadow:var(--nav-shadow),inset 0 1px 0 rgba(255,255,255,.07);padding:13px 18px 10px}
//         LIGHT: inset highlight rgba(255,255,255,.85)
//   .ni{flex:1;column;align-items:center;gap:7px;color:var(--nav-dim);transition:color .2s}  .ni.on{color:var(--gold)}
//   .ni-icon 19x19 hairline VICON (home/globe/search/dms/user)
//   .ni-badge{top:-1px;right:-2px;4x4;radius 50%;background:var(--gold)}  (DMS unread, no glow/count)
//   .ni-bar{12x1;transparent}  .ni.on .ni-bar{background:var(--gold);opacity:.7}
// Icons only, no labels.
import React, { memo, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { noteTabPress } from './switchTiming';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from '../ui/icons/Icon';
import { emitTabReselect } from './reselect';
import { NAV_ICONS } from '../ui/icons/paths';
import { useDmUnread } from './badges';
import { NAV_MARGIN, useBottomNavOffset } from './layout';

const LABELS: Record<string, string> = { void: 'Void', globe: 'Globe', search: 'Search', messages: 'Messages', profile: 'Me' };

// WHICH TAB IS LIT IS PLAIN REACT STATE, NOT A UI-THREAD ANIMATION.
// The pill used to cross-fade one Reanimated position. On the first globe visit after
// a cold start it snapped back to VOID while the globe showed - for weeks. Measured
// 10-07 with logging: navigator index 1, pos 1, no event after, and VOID lit again
// 1-4s later; giving each item a plain resting opacity as well did NOT stop it, so it
// was Reanimated re-applying a stale (VOID) value during the globe's heavy mount, not
// React. A lit tab must never be wrong, so it is no longer animated at all: the press
// sets `lit` at once (so the pill still never waits for a slow screen), and the
// navigator's index keeps it honest for back gestures and deep links.
const NavItem = memo(function NavItem({ name, lit, focused, onPress, onLongPress, badge }: { name: keyof typeof NAV_ICONS; lit: boolean; focused: boolean; onPress: () => void; onLongPress: () => void; badge: boolean }) {
  const { colors } = useTheme();
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
        <Icon name={icon} size={19} color={lit ? colors.gold : colors.navDim} />
        {badge ? <View style={[styles.badge, { backgroundColor: colors.gold }]} /> : null}
      </View>
      <View style={[styles.bar, { backgroundColor: colors.gold, opacity: lit ? 0.7 : 0 }]} />
    </Pressable>
  );
});

export function BottomNav({ state, descriptors, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const { colors, isLight } = theme;
  const bottom = useBottomNavOffset();
  const dmUnread = useDmUnread();

  // The lit tab. The press below sets it at once; this keeps it honest when the route
  // changes some other way (back gesture, deep link).
  const [lit, setLit] = useState(state.index);
  useEffect(() => setLit(state.index), [state.index]);

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
            if (focused && !event.defaultPrevented) {
              // Already here: the tap is a request to start this screen over.
              emitTabReselect(route.name);
              return;
            }
            if (!focused && !event.defaultPrevented) {
              // Light the tab NOW: the screen behind it may take a moment, and the
              // pill should never wait for that.
              noteTabPress();
              setLit(index);
              (navigation as any).navigate(route.name, route.params);
            }
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
          return <NavItem key={route.key} name={name} lit={lit === index} focused={focused} onPress={onPress} onLongPress={onLongPress} badge={name === 'messages' && dmUnread} />;
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
