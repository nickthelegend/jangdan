// The film's takes. Times in seconds from the start of each take. look: [t, yawDeg (+ = left), pitchDeg].
// events: [t, kind, args]: right/left set a hand's driver mode; pinch / pose / click / seat are inputs.
// Every interaction is an emulated hand or gaze action; nothing calls the app's functions directly.

const menu = (t, id) => [
  [t, 'left', { mode: 'palmUp' }],
  [t + 0.9, 'right', { mode: 'poke', target: id }],
];
const menuTwo = (t, a, b) => [...menu(t, a), [t + 2.3, 'right', { mode: 'poke', target: b }]];

export const SEGMENTS = [
  {
    // first launch: the 2D entry card, Enter the hall, the stage settles onto the real surfaces
    name: 'launch',
    enter: false,
    script: {
      total: 17,
      look: [
        [0, 0, 0],
        [5.5, 0, 0],
        [7.5, 38, 4],
        [9.5, 38, 4],
        [11.5, -38, 4],
        [13.5, -38, 4],
        [15, 0, -12],
      ],
      events: [
        [0.2, 'seat', { y: 1.2 }],
        [3, 'click', { selector: '#enter' }],
        [3.6, 'seat', { y: 1.2 }],
      ],
    },
  },
  {
    // the core loop: raise, drop, count-in; a tour of the four sections; pp -> ff; faster; cues; solo/mute; fist
    name: 'conduct',
    reload: false,
    enter: false,
    script: {
      total: 68,
      look: [
        [0, 0, -4],
        [6, 0, -4],
        [8, 40, 2],
        [10.5, 40, 2],
        [12.5, 0, 2],
        [13.5, 0, 2],
        [15.5, -40, 2],
        [18, -40, 2],
        [19.5, 0, -24],
        [21.5, 0, -24],
        [23, 0, -2],
        [35, 0, -2],
        [36.5, -36, 0],
        [39.5, -36, 0],
        [41, 36, 0],
        [53, 36, 0],
        [55, 0, -4],
      ],
      events: [
        [0, 'left', { mode: 'height', from: -0.5, to: -0.5, dur: 1 }],
        [1, 'right', { mode: 'raise' }],
        [1.8, 'right', { mode: 'conduct', bpm: 84 }],
        [22, 'left', { mode: 'height', from: -0.5, to: -0.02, dur: 7 }],
        [28, 'right', { mode: 'conduct', bpm: 118 }],
        [33, 'left', { mode: 'height', from: -0.02, to: -0.3, dur: 1.5 }],
        [36.5, 'left', { mode: 'aim', target: 'winds' }],
        [38, 'pinch', { hand: 'left', dur: 0.2 }],
        [41, 'left', { mode: 'aim', target: 'strings' }],
        [42.5, 'pinch', { hand: 'left', dur: 0.2 }],
        [45, 'pinch', { hand: 'left', dur: 0.9 }],
        [48, 'pinch', { hand: 'left', dur: 0.9 }],
        [51, 'pinch', { hand: 'left', dur: 0.9 }],
        [53.5, 'left', { mode: 'height', from: -0.3, to: -0.05, dur: 2 }],
        [59, 'right', { mode: 'hold' }],
        [59, 'pose', { hand: 'right', poseId: 'fist' }],
        [66, 'pose', { hand: 'right', poseId: 'default' }],
        [66, 'right', { mode: 'rest' }],
      ],
    },
  },
  {
    // the wrist menu, Listen (a lean-back concert where sweeps paint light), then Ghost replays the take
    name: 'listen',
    script: {
      total: 50,
      look: [
        [0, 0, -14],
        [4.5, 0, -14],
        [6, 0, 0],
        [9, 30, 4],
        [13, -30, 4],
        [17, 0, 0],
        [24, 0, -14],
        [30, 0, -4],
        [34, 38, 2],
        [39, -38, 2],
        [44, 0, 0],
      ],
      events: [
        ...menu(0.8, 'btn-listen'),
        [3.4, 'left', { mode: 'rest' }],
        [3.4, 'right', { mode: 'rest' }],
        [8, 'right', { mode: 'sweep' }],
        [10, 'left', { mode: 'sweep' }],
        [20, 'right', { mode: 'rest' }],
        [20, 'left', { mode: 'rest' }],
        ...menu(24.5, 'btn-ghost'),
        [27.2, 'left', { mode: 'rest' }],
        [27.2, 'right', { mode: 'rest' }],
      ],
    },
  },
  {
    // comfort: calm light, one-hand mode (index tap), calibrate
    name: 'comfort',
    script: {
      total: 60,
      look: [
        [0, 0, -14],
        [6, 0, -14],
        [7.5, 0, 0],
        [11, 34, 2],
        [15, -34, 2],
        [18, 0, -4],
        [22, 0, -14],
        [27.5, 0, -14],
        [29, 0, 0],
        [33, 30, 0],
        [37, 0, 0],
        [43, 0, -14],
        [49, 0, -8],
      ],
      events: [
        ...menuTwo(0.8, 'btn-flash', 'btn-conduct'),
        [5.6, 'left', { mode: 'height', from: -0.4, to: -0.05, dur: 6 }],
        [5.6, 'right', { mode: 'rest' }],
        [6.6, 'right', { mode: 'raise' }],
        [7.4, 'right', { mode: 'conduct', bpm: 96 }],
        [19.5, 'right', { mode: 'hold' }],
        [19.5, 'pose', { hand: 'right', poseId: 'fist' }],
        [21.5, 'pose', { hand: 'right', poseId: 'default' }],
        ...menuTwo(22, 'btn-flash', 'btn-onehand'),
        [26.8, 'left', { mode: 'rest' }],
        [26.8, 'right', { mode: 'rest' }],
        [28, 'right', { mode: 'tap', bpm: 90 }],
        [39.5, 'right', { mode: 'hold' }],
        [39.5, 'pose', { hand: 'right', poseId: 'fist' }],
        [41.5, 'pose', { hand: 'right', poseId: 'default' }],
        ...menu(42.5, 'btn-onehand'),
        // Calibrate by hand ray + pinch (the menu takes poke or ray)
        [44.8, 'right', { mode: 'rayAt', target: 'btn-calibrate' }],
        [45.5, 'pinch', { hand: 'right', dur: 0.2 }],
        [47.2, 'left', { mode: 'rest' }],
        [47.2, 'right', { mode: 'rest' }],
        [48.5, 'right', { mode: 'conduct', bpm: 90 }],
        [58, 'right', { mode: 'rest' }],
      ],
    },
  },
  {
    // the Daily piece (seeded, the same for everyone on a UTC day) and a new best
    name: 'daily',
    reload: false,
    enter: false,
    script: {
      total: 36,
      look: [
        [0, 0, -14],
        [3.2, 0, -14],
        [5, 0, 0],
        [9, 36, 2],
        [13, 0, 2],
        [17, -36, 2],
        [21, 0, -20],
        [24, 0, -2],
      ],
      events: [
        ...menu(0.8, 'btn-piece-3'),
        [3, 'left', { mode: 'height', from: -0.45, to: -0.03, dur: 12 }],
        [3, 'right', { mode: 'rest' }],
        [4, 'right', { mode: 'raise' }],
        [4.8, 'right', { mode: 'conduct', bpm: 100 }],
        [27, 'right', { mode: 'hold' }],
        [27, 'pose', { hand: 'right', poseId: 'fist' }],
        [34, 'pose', { hand: 'right', poseId: 'default' }],
      ],
    },
  },
  {
    // a different room: the stage and the reverb follow the real surfaces
    name: 'office',
    room: 'home_office',
    script: {
      total: 24,
      look: [
        [0, 0, -4],
        [6, 0, -4],
        [9, 40, 2],
        [12, -40, 2],
        [15, 0, -20],
        [18, 0, 0],
      ],
      events: [
        [0, 'left', { mode: 'height', from: -0.3, to: -0.05, dur: 10 }],
        [0.8, 'right', { mode: 'raise' }],
        [1.6, 'right', { mode: 'conduct', bpm: 100 }],
        [21, 'right', { mode: 'hold' }],
        [21, 'pose', { hand: 'right', poseId: 'fist' }],
      ],
    },
  },
  {
    // calibrate: open the menu, hand ray + pinch on Calibrate, then beat along with eight clicks
    name: 'calibrate',
    script: {
      total: 14,
      look: [
        [0, 0, -14],
        [3.6, 0, -14],
        [4.6, 0, -4],
      ],
      events: [
        [0.5, 'left', { mode: 'palmUp' }],
        [1.4, 'right', { mode: 'rayAt', target: 'btn-calibrate' }],
        [2.2, 'pinch', { hand: 'right', dur: 0.2 }],
        [3.4, 'left', { mode: 'rest' }],
        [3.4, 'right', { mode: 'rest' }],
        [3.9, 'right', { mode: 'conduct', bpm: 90 }],
        [13, 'right', { mode: 'rest' }],
      ],
    },
  },
  {
    // Meta VR Glasses profile: look at a section and pinch to cue it; the HUD stays inside the narrow view,
    // edge arrows point at sections outside it
    name: 'glasses',
    device: 'metaVRGlasses',
    fovy: 1.19,
    script: {
      total: 22,
      look: [
        [0, 0, -2],
        [9, 0, -2],
        [11, 22, 0],
        [14, 22, 0],
        [16, -22, 0],
        [19, -22, 0],
        [21, 0, -2],
      ],
      events: [
        [0, 'left', { mode: 'height', from: -0.35, to: -0.1, dur: 8 }],
        [0.8, 'right', { mode: 'raise' }],
        [1.6, 'right', { mode: 'conduct', bpm: 96 }],
        [7, 'gaze', { target: 'brass' }],
        [8, 'pinch', { hand: 'left', dur: 0.2 }],
        [10.5, 'gaze', { target: 'strings' }],
        [12.5, 'pinch', { hand: 'left', dur: 0.2 }],
        [15, 'gaze', { target: 'winds' }],
        [17, 'pinch', { hand: 'left', dur: 0.2 }],
      ],
    },
  },
];

// quick check of a single menu poke (not part of the film)
export const PROBES = [];
