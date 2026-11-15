import React from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';

/**
 * Launch animation in a "liquid glass" style: soft colour blobs drift behind a
 * frosted backdrop, a glass lens forms around the logo with a light sweep
 * across it, then the lens swells and dissolves into the app.
 *
 * The native splash (same background + logo) stays up until this view has
 * drawn its first frame, so the hand-off is seamless.
 */

const BG = '#0C1B1E';
const LOGO = require('../../../assets/splash-logo.png') as number;
/** Native splash logo width (app.json → expo-splash-screen imageWidth). */
const NATIVE_LOGO = 200;
const LENS = 184;
const LOGO_SIZE = 136;
/** Keep the animation on screen at least this long, even if the app is ready sooner. */
const MIN_SHOW_MS = 1500;

const BLOBS = [
  { color: '#00E5FF', size: 360, x: -90, y: -170, dx: 50, dy: 40, ms: 5200 },
  { color: '#1DE9B6', size: 300, x: 110, y: 120, dx: -60, dy: -30, ms: 6100 },
  { color: '#536DFE', size: 320, x: -120, y: 210, dx: 40, dy: -50, ms: 7000 },
] as const;

function useLoop(ms: number, enabled: boolean): Animated.Value {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!enabled) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [enabled, ms, v]);
  return v;
}

function Blob({ b, drift }: { b: (typeof BLOBS)[number]; drift: Animated.Value }): React.ReactElement {
  return (
    <Animated.View
      style={[
        styles.blob,
        {
          width: b.size, height: b.size, borderRadius: b.size / 2, backgroundColor: b.color,
          marginLeft: b.x - b.size / 2, marginTop: b.y - b.size / 2,
          transform: [
            { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, b.dx] }) },
            { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, b.dy] }) },
            { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
          ],
        },
      ]}
    />
  );
}

export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone: () => void }): React.ReactElement {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const [introDone, setIntroDone] = React.useState(false);
  const shownAt = React.useRef(Date.now());

  const lens = React.useRef(new Animated.Value(0)).current; // 0 → 1 glass forms
  const logo = React.useRef(new Animated.Value(0)).current; // 0 native size → 1 settled
  const shine = React.useRef(new Animated.Value(0)).current; // light sweep across the lens
  const pulse = React.useRef(new Animated.Value(0)).current; // ring ripple
  const title = React.useRef(new Animated.Value(0)).current;
  const exit = React.useRef(new Animated.Value(0)).current; // 0 → 1 dissolve into app

  const d0 = useLoop(BLOBS[0].ms, !reduceMotion);
  const d1 = useLoop(BLOBS[1].ms, !reduceMotion);
  const d2 = useLoop(BLOBS[2].ms, !reduceMotion);
  const drifts = [d0, d1, d2];

  React.useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);

  const start = React.useCallback(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
    shownAt.current = Date.now();
    const spring = (v: Animated.Value, delay = 0): Animated.CompositeAnimation =>
      Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, damping: 14, stiffness: 120, mass: 1, useNativeDriver: true })]);
    Animated.parallel([
      spring(logo),
      spring(lens, 120),
      Animated.sequence([Animated.delay(520), Animated.timing(shine, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })]),
      Animated.sequence([Animated.delay(380), Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true })]),
      Animated.sequence([Animated.delay(420), Animated.timing(title, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true })]),
    ]).start(() => setIntroDone(true));
  }, [lens, logo, pulse, shine, title]);

  React.useEffect(() => {
    if (!ready || !introDone) return;
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt.current));
    const t = setTimeout(() => {
      Animated.timing(exit, { toValue: 1, duration: reduceMotion ? 250 : 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start(() => onDone());
    }, wait);
    return () => clearTimeout(t);
  }, [exit, introDone, onDone, ready, reduceMotion]);

  const cover = Math.hypot(width, height) / LENS + 0.5;
  const lensScale = Animated.add(
    lens.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
    exit.interpolate({ inputRange: [0, 1], outputRange: [0, reduceMotion ? 0 : cover - 1] }),
  );

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.root, { opacity: exit.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 1, 0] }) }]}
      onLayout={start}
    >
      {/* Drifting colour behind frosted glass. */}
      <View style={styles.center}>
        {BLOBS.map((b, i) => <Blob key={b.color} b={b} drift={drifts[i]!} />)}
      </View>
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={Platform.OS === 'ios' ? 80 : 100}
        tint="dark"
        {...(Platform.OS === 'android' ? { experimentalBlurMethod: 'dimezisBlurView' as const } : {})}
      />
      <LinearGradient colors={['rgba(12,27,30,0.15)', 'rgba(12,27,30,0.6)']} style={StyleSheet.absoluteFill} />

      <View style={styles.center}>
        {/* Ripple */}
        <Animated.View
          style={[
            styles.ring,
            {
              opacity: pulse.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.55, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.9] }) }],
            },
          ]}
        />

        {/* Glass lens */}
        <Animated.View style={[styles.lensWrap, { opacity: lens, transform: [{ scale: lensScale }] }]}>
          <LinearGradient
            colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.08)', 'rgba(128,240,255,0.35)']}
            locations={[0, 0.5, 1]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={styles.rim}
          >
            <View style={styles.lens}>
              <LinearGradient
                colors={['rgba(255,255,255,0.20)', 'rgba(255,255,255,0.04)', 'rgba(0,229,255,0.10)']}
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFill}
              />
              {/* Specular highlight */}
              <LinearGradient colors={['rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']} style={styles.specular} />
              {/* Light sweep */}
              <Animated.View
                style={[
                  styles.sweepWrap,
                  { transform: [{ translateX: shine.interpolate({ inputRange: [0, 1], outputRange: [-LENS * 1.4, LENS * 1.4] }) }, { rotate: '20deg' }] },
                ]}
              >
                <LinearGradient
                  colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.32)', 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Logo: starts at the native splash size, settles into the lens. */}
        <Animated.Image
          source={LOGO}
          style={[
            styles.logo,
            {
              opacity: exit.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
              transform: [
                { scale: logo.interpolate({ inputRange: [0, 1], outputRange: [NATIVE_LOGO / LOGO_SIZE, 1] }) },
                { scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) },
              ],
            },
          ]}
        />

        <Animated.Text
          style={[
            styles.title,
            {
              opacity: Animated.multiply(title, exit.interpolate({ inputRange: [0, 0.3], outputRange: [1, 0], extrapolate: 'clamp' })),
              transform: [{ translateY: title.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
            },
          ]}
        >
          Open Ultima
        </Animated.Text>
        <Animated.Text
          style={[
            styles.subtitle,
            {
              opacity: Animated.multiply(
                title.interpolate({ inputRange: [0.4, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
                exit.interpolate({ inputRange: [0, 0.3], outputRange: [1, 0], extrapolate: 'clamp' }),
              ),
            },
          ]}
        >
          Earbuds · Watch · Workouts
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: BG, zIndex: 1000, elevation: 1000 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  blob: { position: 'absolute', left: '50%', top: '50%', opacity: 0.8 },
  ring: { position: 'absolute', width: LENS, height: LENS, borderRadius: LENS / 2, borderWidth: 2, borderColor: '#4DD0E1' },
  lensWrap: {
    position: 'absolute', width: LENS, height: LENS, borderRadius: LENS / 2,
    shadowColor: '#00E5FF', shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: 10 },
  },
  rim: { flex: 1, borderRadius: LENS / 2, padding: 1.5 },
  lens: { flex: 1, borderRadius: LENS / 2, overflow: 'hidden', backgroundColor: 'rgba(20,40,44,0.35)' },
  specular: { position: 'absolute', top: 6, left: LENS * 0.18, width: LENS * 0.64, height: LENS * 0.36, borderRadius: LENS },
  sweepWrap: { position: 'absolute', top: -LENS * 0.3, left: LENS * 0.3, width: LENS * 0.35, height: LENS * 1.6 },
  logo: { position: 'absolute', width: LOGO_SIZE, height: LOGO_SIZE },
  title: { position: 'absolute', top: '50%', marginTop: LENS / 2 + 34, color: '#E8F7F9', fontSize: 28, fontWeight: '600', letterSpacing: 0.5 },
  subtitle: { position: 'absolute', top: '50%', marginTop: LENS / 2 + 76, color: 'rgba(200,230,235,0.7)', fontSize: 14, letterSpacing: 1.2 },
});
