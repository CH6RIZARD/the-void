// .vmod-veil — "GRAPHIC CONTENT · TAP TO VIEW" over graphic media while the
// graphic filter (moderation.graphicVeilOn) is on. The media underneath is blurred
// and darkened by its host; a tap on a veiled host reveals it instead of acting.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { VText } from '../../../ui/Text';
import { FONTS, em } from '../../../theme/palettes';
import { VmodIcon } from '../vmodIcons';

export function GraphicVeil() {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.veil}>
        <VmodIcon name="eyeOff" size={18} color="#f4f0ff" />
        <VText style={styles.t}>GRAPHIC CONTENT</VText>
        <VText style={styles.em}>TAP TO VIEW</VText>
      </View>
    </View>
  );
}

/** CSS filter: blur(32px) brightness(.5) — the darkening half, laid over the blurred still. */
export function VeilDim() {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2 }]} />;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 4, alignItems: 'center', justifyContent: 'center' },
  veil: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(4,2,12,0.72)',
    boxShadow: 'inset 0px 0px 0px 1px rgba(255,255,255,0.14)',
  },
  t: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: '#f4f0ff', textAlign: 'center' },
  em: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.2), color: 'rgba(244,240,255,0.6)', textAlign: 'center' },
});
