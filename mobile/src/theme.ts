// Crixo design tokens — ported from the web app's globals.css (v4 light warm
// theme). Two hues only: apricot + butter on a warm-white base; THE gradient
// (apricot -> butter, 135deg) is the identity and stays special.

export const colors = {
  bg: '#FFF9F0',
  panel: '#FFFFFF',
  panel2: '#FFF6E3',
  line: '#F0E2CC',
  text: '#3A2E1E',
  muted: '#7E6A4E',
  ink: '#4A2B0F', // dark text on bright gradient fills

  apricot: '#FFA94D',
  apricotDeep: '#E8590C',
  apricotInk: '#C2410C',

  butter: '#FFD43B',
  butterPale: '#FFF3BF',

  danger: '#C63D08',

  cream: '#FFF9EA', // score-plate face top
  creamDeep: '#FFF3D9', // score-plate face bottom
} as const;

// THE gradient, 135° — with expo-linear-gradient use GRAD_START/GRAD_END.
export const GRAD = ['#FFB86B', '#FFE08A'] as const;
export const GRAD_START = { x: 0, y: 0 } as const;
export const GRAD_END = { x: 1, y: 1 } as const;

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
} as const;

export const radius = {
  md: 14,
  sm: 10,
} as const;

// Soft warm shadow — the light theme's depth cue.
export const shadow = {
  shadowColor: '#E6A050',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.12,
  shadowRadius: 10,
  elevation: 2,
} as const;

export const shadowSm = {
  shadowColor: '#E6A050',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
  elevation: 1,
} as const;
