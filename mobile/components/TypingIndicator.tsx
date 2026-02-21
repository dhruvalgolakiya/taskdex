import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { Palette } from '../theme';
import { typography } from '../theme';

interface Props {
  label?: string;
  colors: Palette;
}

export function TypingIndicator({ label = 'Working', colors }: Props) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const shimmerPosition = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(shimmerPosition, {
      toValue: 1,
      duration: 1300,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [shimmerPosition]);

  const shimmerX = shimmerPosition.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 220],
  });

  return (
    <View style={styles.row}>
      <View style={styles.labelWrap}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shimmerBand,
            { transform: [{ translateX: shimmerX }, { skewX: '-20deg' }] },
          ]}
        />
      </View>
    </View>
  );
}

const createStyles = (colors: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 2,
    marginBottom: 10,
  },
  labelWrap: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 4,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: typography.medium,
  },
  shimmerBand: {
    position: 'absolute',
    top: -6,
    bottom: -6,
    width: 48,
    backgroundColor: colors.shimmer,
    opacity: 0.5,
  },
});
