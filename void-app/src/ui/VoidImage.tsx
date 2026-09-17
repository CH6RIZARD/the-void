// <VoidImage> — the native form of imgWithLoader() + imgLoaded() + mediaFailed():
//   - the orbit loader covers the box until the image has actually been displayed;
//   - an image that FAILS removes its whole box (no third placeholder is allowed),
//     exactly like mediaFailed() removing the host.
import React, { memo, useCallback, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageContentFit, type ImageProps } from 'expo-image';
import { ImageOrbitLoader } from './ImageOrbitLoader';
import { SparkleLoader } from './SparkleLoader';

export interface VoidImageProps {
  uri: string | null | undefined;
  /** Style of the box (size, radius, margins). The image fills it. */
  style?: StyleProp<ViewStyle>;
  radius?: number;
  contentFit?: ImageContentFit;
  /** 'feed' for post media (LIGHT milky panel), 'media' for globe/reels/viewers. */
  surface?: 'media' | 'feed';
  /** Video posters use the sparkle loader instead of the orbit (imgLoaded clears either). */
  loader?: 'orbit' | 'sparkle' | 'none';
  /** Label for the loader (orbit default 'LOADING IMAGE'). */
  loaderLabel?: string;
  /** Called once the box has been removed because the image failed. */
  onFailed?: () => void;
  onLoaded?: () => void;
  /** Extra expo-image props (recyclingKey, priority, cachePolicy, blurhash...). */
  imageProps?: Omit<ImageProps, 'source' | 'style' | 'contentFit' | 'onDisplay' | 'onError'>;
  children?: React.ReactNode;
}

export const VoidImage = memo(function VoidImage({ uri, style, radius, contentFit = 'cover', surface = 'feed', loader = 'orbit', loaderLabel, onFailed, onLoaded, imageProps, children }: VoidImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const onDisplay = useCallback(() => {
    setLoaded(true);
    onLoaded?.();
  }, [onLoaded]);
  const onError = useCallback(() => {
    setFailed(true);
    onFailed?.();
  }, [onFailed]);

  if (!uri || failed) return null;

  return (
    <View style={[styles.box, radius != null ? { borderRadius: radius } : null, style]}>
      <Image
        cachePolicy="memory-disk"
        transition={0}
        {...imageProps}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        onDisplay={onDisplay}
        onError={onError}
      />
      {!loaded && loader === 'orbit' ? <ImageOrbitLoader surface={surface} radius={radius} label={loaderLabel ?? 'LOADING IMAGE'} /> : null}
      {!loaded && loader === 'sparkle' ? <SparkleLoader surface={surface} radius={radius} label={loaderLabel} /> : null}
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});

export default VoidImage;
