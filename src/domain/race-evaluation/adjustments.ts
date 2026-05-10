import type { AdjustmentDefinition } from "./abilityTypes";

export const GROUND_ADJUSTMENTS: Record<string, AdjustmentDefinition> = {
  good: {
    label: "良",
    adjustment: {
      speed: 0.0,
      stamina: 0.0,
      kick: 0.0,
      sustain: 0.0,
      power: 0.0,
    },
  },
  yielding: {
    label: "稍重",
    adjustment: {
      speed: -0.055,
      stamina: 0.095,
      kick: -0.07,
      sustain: 0.065,
      power: 0.105,
    },
  },
  heavy: {
    label: "重",
    adjustment: {
      speed: -0.12,
      stamina: 0.185,
      kick: -0.155,
      sustain: 0.105,
      power: 0.205,
    },
  },
  bad: {
    label: "不良",
    adjustment: {
      speed: -0.185,
      stamina: 0.265,
      kick: -0.225,
      sustain: 0.135,
      power: 0.285,
    },
  },
};

export const TRACK_SPEED_ADJUSTMENTS: Record<string, AdjustmentDefinition> = {
  standard: {
    label: "標準時計",
    adjustment: {
      speed: 0.0,
      stamina: 0.0,
      kick: 0.0,
      sustain: 0.0,
      power: 0.0,
    },
  },
  fast: {
    label: "時計が速い",
    adjustment: {
      speed: 0.145,
      stamina: -0.1,
      kick: 0.2,
      sustain: 0.045,
      power: -0.145,
    },
  },
  slow: {
    label: "時計がかかる",
    adjustment: {
      speed: -0.1,
      stamina: 0.17,
      kick: -0.125,
      sustain: 0.115,
      power: 0.195,
    },
  },
};

export const BIAS_ADJUSTMENTS: Record<string, AdjustmentDefinition> = {
  flat: {
    label: "フラット",
    adjustment: {
      speed: 0.0,
      stamina: 0.0,
      kick: 0.0,
      sustain: 0.0,
      power: 0.0,
    },
  },
  front_favor: {
    label: "前残り",
    adjustment: {
      speed: 0.15,
      stamina: 0.02,
      kick: -0.16,
      sustain: 0.10,
      power: 0.04,
    },
  },
  closer_favor: {
    label: "差し有利",
    adjustment: {
      speed: -0.10,
      stamina: 0.04,
      kick: 0.16,
      sustain: 0.08,
      power: -0.02,
    },
  },
  inside_favor: {
    label: "内有利",
    adjustment: {
      speed: 0.08,
      stamina: 0.02,
      kick: -0.05,
      sustain: 0.06,
      power: 0.04,
    },
  },
  outside_favor: {
    label: "外有利",
    adjustment: {
      speed: -0.05,
      stamina: 0.03,
      kick: 0.09,
      sustain: 0.07,
      power: 0.01,
    },
  },
};

export const PACE_ADJUSTMENTS: Record<string, AdjustmentDefinition> = {
  slow: {
    label: "スロー",
    adjustment: {
      speed: -0.08,
      stamina: -0.08,
      kick: 0.22,
      sustain: 0.03,
      power: -0.06,
    },
  },
  middle: {
    label: "ミドル",
    adjustment: {
      speed: 0.0,
      stamina: 0.0,
      kick: 0.0,
      sustain: 0.0,
      power: 0.0,
    },
  },
  high: {
    label: "ハイ",
    adjustment: {
      speed: -0.08,
      stamina: 0.18,
      kick: -0.18,
      sustain: 0.14,
      power: 0.08,
    },
  },
  many_front_runners: {
    label: "逃げ先行多数",
    adjustment: {
      speed: -0.06,
      stamina: 0.14,
      kick: -0.10,
      sustain: 0.14,
      power: 0.06,
    },
  },
  no_front_runner: {
    label: "逃げ馬不在",
    adjustment: {
      speed: 0.07,
      stamina: -0.07,
      kick: 0.15,
      sustain: 0.01,
      power: -0.05,
    },
  },
};

/** 「弱め」でも馬場・ペース・時計プリセットの差が体感できるよう middle との差をやや縮める */
export const ADJUSTMENT_STRENGTH = {
  weak: 1.35,
  middle: 2.2,
  strong: 3.4,
} as const;
