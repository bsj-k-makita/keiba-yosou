/**
 * 最終判定の合成における層別ウェイト（仕様の「参考値」）。
 * 能力過信を抑え、4角・コース適性・枠順を相対的に強める。
 */
export const ABILITY_RELATIVE_BLEND = 0.8;
/** 旧 0.5 → 1.5 に相当する層のスケール（4角予測ボーナス側で反映） */
export const FOURTH_CORNER_PREDICTION_WEIGHT = 1.5;
/** 旧 0.7 → 1.2（ラップ・適性スタックへの倍率） */
export const COURSE_SHAPE_FIT_RATIO = 1.2 / 0.7;
/** 旧 0.3 → 0.8（枠順・ゲート由来ボーナスへの倍率） */
export const FRAME_GATE_WEIGHT_RATIO = 0.8 / 0.3;
