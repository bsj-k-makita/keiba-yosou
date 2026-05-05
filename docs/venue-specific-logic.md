# 競馬場ごとの実装ロジック

アプリ内で「会場名」に依存する評価ロジックの整理です。実装の正は各 TypeScript ファイルを参照してください。

## 1. ベース重み（競馬場プロファイル）

各競馬場に、能力5軸（`speed` / `stamina` / `kick` / `sustain` / `power`）の初期重みが定義されています。

- **定義**: `src/domain/race-evaluation/courseWeights.ts` の `BASE_COURSE_WEIGHTS`
- **参照キー**: `getBaseWeights` では `condition.courseKey ?? condition.venue` をキーにします。いずれかが `BASE_COURSE_WEIGHTS` に存在すればその重みを使い、**未登録の場合は `DEFAULT_VENUE_KEY`（`"東京"`）**にフォールバックします。

登録キー一覧と数値（抜粋・コピー用）:

| キー | speed | stamina | kick | sustain | power |
|------|-------|---------|------|---------|-------|
| 東京 | 0.143 | 0.143 | 0.357 | 0.286 | 0.071 |
| 京都 | 0.214 | 0.143 | 0.357 | 0.214 | 0.071 |
| 阪神外 | 0.214 | 0.143 | 0.286 | 0.286 | 0.214 |
| 中山 | 0.25 | 0.188 | 0.125 | 0.313 | 0.313 |
| 中京 | 0.188 | 0.313 | 0.188 | 0.313 | 0.25 |
| 福島 | 0.357 | 0.214 | 0.071 | 0.286 | 0.143 |
| 新潟 | 0.286 | 0.214 | 0.143 | 0.286 | 0.071 |
| 小倉 | 0.267 | 0.267 | 0.133 | 0.267 | 0.133 |
| 札幌函館 | 0.143 | 0.286 | 0.071 | 0.214 | 0.286 |

## 2. 条件補正の合成（会場重み + 物理特性 + 馬場 / 時計 / バイアス / 展開）

最終的な5軸重みは `getFinalWeights`（`src/domain/race-evaluation/weightResolver.ts`）で次の順に合成されます。

1. **ベース**: `getBaseWeights(condition)`（`BASE_COURSE_WEIGHTS`、上記 1.）
2. **物理特性（直線・坂・コーナー・距離・芝/ダ）**: `applyVenuePhysicalFactorAdjustments`（`venuePhysicalFactors.ts`）  
   - 案のとおり、直線の長短・ゴール前の上り量・コーナー半径・距離帯・`surface`（芝/ダ）に応じて5軸に加減算し、クランプのうえ **正規化** したものを、以降の「ベース」として扱います。  
   - 均一 0.2 から組み直す案ではなく、**既存の会場ベース重みの上に同じ加減算**を載せる形にして、従来の会場差を壊さないようにしています。  
   - 会場名の解決: `resolveVenuePhysicalFactorKey`（例: `venue` が「京都」→ `京都外`、`courseKey` や `raceName` に「京都内」→ `京都内`、`新潟`→ `新潟外`、`札幌函館` は馬名等に「函館」を含むとき `函館`、それ以外は `札幌`、など）。
3. **馬場状態 `ground`**: `GROUND_ADJUSTMENTS`（`adjustments.ts`）  
   - 旧データで `ground` が `fast_track` / `slow_track` の場合は、互換のため **`normalizedGround` は `good` に読み替え**て馬場補正をかけます。
4. **時計傾向 `trackSpeed`**: `TRACK_SPEED_ADJUSTMENTS`（`adjustments.ts`）  
   - `trackSpeed` が無い旧データでは、`ground === fast_track` → `fast`、`slow_track` → `slow`、それ以外 → `standard` として扱います。
5. **馬場バイアス `bias`**: `BIAS_ADJUSTMENTS`
6. **展開 `pace`**: `PACE_ADJUSTMENTS`
7. **補正強度 `adjustmentStrength`**: `ADJUSTMENT_STRENGTH` で上記デルタに係数を掛けます。
8. 各軸をクランプし、合計が 1 になるよう正規化します。

`RaceCondition.surface`（`"芝" | "ダート"`、任意）が無い場合、物理特性補正の芝/ダ分岐は **芝** 扱いです。`convertToRaceEvaluationData` と `RaceDetailView` で `raceInfo.surface` から埋まります。

**要点**: 「稍重・重・不良」と「時計が速い・かかる」は **別パラメータ** として積み上がります（UI も分離）。

## 3. 会場・コース文脈ボーナス（`contextualBonuses.ts`）

ベース重みとは別に、馬ごとの加点・文脈補正があります。

### 3.1 コース形状（topology）の推定

`inferCourseTopology`（明示の `condition.courseTopology` が無いとき）:

- 会場文字列に **「京都」** を含む → `downhill_to_flat`
- **「阪神」または「中山」** を含む → `uphill`
- 上記以外 → `flat`

`courseKey` と `venue` を連結した lower 文字列で判定しています。

### 3.2 血統名ベースの会場・距離ボーナス（例）

- 種牡馬名に **ルーラーシップ**: 会場が **京都** なら加点、**距離 2200m 以上** でも加点（`inferSireBiasByName`）。
- **スワーヴリチャード**: 性別と距離帯（牡 2200m+、牝 2000m 以下）に応じて加点。

坂・直線の傾向に合わせた血統加算（プリンスリーギフト、グレイソヴリン、ブランドフォード等）は `inferSlopePedigreeByName` と topology 連動。

### 3.3 騎手・厩舎（長距離・京都）

`venueKey` に **京都** を含み、かつ **距離 3000m 以上** のとき、騎手名に **ルメール** / **レーン**、厩舎に **木村哲也** など条件に合致すると加点（該当箇所は `contextualBonuses.ts` 内の connections 系ロジックを参照）。

---

## 4. 関連ファイル一覧

| 内容 | パス |
|------|------|
| 競馬場ベース重み | `src/domain/race-evaluation/courseWeights.ts` |
| 直線・坂・コーナー等の物理特性と補正 | `src/domain/race-evaluation/venuePhysicalFactors.ts` |
| 最終重みの合成 | `src/domain/race-evaluation/weightResolver.ts` |
| 馬場・時計・バイアス・展開のデルタ定義 | `src/domain/race-evaluation/adjustments.ts` |
| 会場・血統・ゲート等の文脈ボーナス | `src/domain/race-evaluation/contextualBonuses.ts` |
| 条件型（`trackSpeed` 等） | `src/domain/race-evaluation/abilityTypes.ts` |
| 条件 UI（会場・馬場・時計傾向） | `src/components/race/RaceAdjustmentPanel.tsx` |
| 同一日・会場の条件引き継ぎ | `src/components/race/RaceDetailView.tsx` |

---

*最終更新: リポジトリ上の `courseWeights.ts` / `venuePhysicalFactors.ts` / `weightResolver.ts` / `contextualBonuses.ts` に基づく。*
