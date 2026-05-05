import type { WeightSet } from "./abilityTypes";

export const BASE_COURSE_WEIGHTS: Record<string, WeightSet> = {
  東京: {
    speed: 0.143,
    stamina: 0.143,
    kick: 0.357,
    sustain: 0.286,
    power: 0.071,
  },
  京都: {
    speed: 0.214,
    stamina: 0.143,
    kick: 0.357,
    sustain: 0.214,
    power: 0.071,
  },
  阪神外: {
    speed: 0.214,
    stamina: 0.143,
    kick: 0.286,
    sustain: 0.286,
    power: 0.214,
  },
  中山: {
    speed: 0.25,
    stamina: 0.188,
    kick: 0.125,
    sustain: 0.313,
    power: 0.313,
  },
  中京: {
    speed: 0.188,
    stamina: 0.313,
    kick: 0.188,
    sustain: 0.313,
    power: 0.25,
  },
  福島: {
    speed: 0.357,
    stamina: 0.214,
    kick: 0.071,
    sustain: 0.286,
    power: 0.143,
  },
  新潟: {
    speed: 0.286,
    stamina: 0.214,
    kick: 0.143,
    sustain: 0.286,
    power: 0.071,
  },
  小倉: {
    speed: 0.267,
    stamina: 0.267,
    kick: 0.133,
    sustain: 0.267,
    power: 0.133,
  },
  札幌函館: {
    speed: 0.143,
    stamina: 0.286,
    kick: 0.071,
    sustain: 0.214,
    power: 0.286,
  },
};

export const DEFAULT_VENUE_KEY = "東京";
