# Signals: harder test

Generated 2026-11-06 09:35 UTC. Report only: nothing here changes what the app shows.

**What is different from RESULTS.md.**

- RESULTS.md counts each signal once per target size, so one signal can count up to three times. Here each signal is one trade.
- 60 combinations were tried in all, so the bar is corrected for that: z = 3.14 instead of 1.96.
- The pass rule was fixed in code before these results were seen, and must not be loosened after reading them.
- Crypto is left out here because it already lost money on its large samples in RESULTS.md.

**How to read R.** Each trade risks 1R. +0.10R means an average gain of a tenth of the amount risked, per trade.

## 1. What users would really get

One trade per market per signal, chosen as the scanner chooses today.

| Group | Separate trades | Won | 95% low | Needed to break even | Average result (R) | Corrected low (R) |
|---|---:|---:|---:|---:|---:|---:|
| Commodities | 106 | 57.5% | 48.0% | 42.5% | +0.203 | -0.105 |
| Forex | 290 | 45.5% | 39.9% | 42.0% | -0.048 | -0.235 |
| Indices | 130 | 49.2% | 40.8% | 42.1% | +0.092 | -0.214 |

## 2. One target size fixed in advance

| Group and target | Separate trades | Won | 95% low | Needed to break even | Average result (R) | Corrected low (R) |
|---|---:|---:|---:|---:|---:|---:|
| Commodities, 1:1 | 43 | 67.4% | 52.5% | 50.4% | +0.347 | -0.085 |
| Commodities, 1.5:1 | 81 | 55.6% | 44.7% | 40.5% | +0.255 | -0.120 |
| Commodities, 2:1 | 102 | 52.0% | 42.4% | 33.7% | +0.155 | -0.193 |
| Forex, 1:1 | 111 | 48.6% | 39.6% | 50.5% | -0.082 | -0.363 |
| Forex, 1.5:1 | 187 | 44.4% | 37.4% | 40.4% | -0.068 | -0.303 |
| Forex, 2:1 | 278 | 42.8% | 37.1% | 33.7% | -0.072 | -0.275 |
| Indices, 1:1 | 49 | 49.0% | 35.6% | 50.8% | -0.028 | -0.457 |
| Indices, 1.5:1 | 81 | 43.2% | 33.0% | 40.7% | -0.004 | -0.391 |
| Indices, 2:1 | 126 | 48.4% | 39.9% | 33.9% | +0.178 | -0.169 |

## 3. The full pass rule

### Commodities: not passed

| Check | Result | Measured |
|---|---|---|
| At least 200 separate trades | **Fail** | 106 |
| Average result above zero after correcting for 60 combinations | **Fail** | lower bound -0.105R |
| Still makes money with costs doubled | Pass | +0.190R |
| Still makes money with the stop and time limit nudged | Pass | +0.212 / +0.193 / +0.328 / +0.136 |
| Most years positive | Pass | 4 of 5 |
| Profit not from one market alone | **Fail** | largest share 76% |

### Forex: not passed

| Check | Result | Measured |
|---|---|---|
| At least 200 separate trades | Pass | 290 |
| Average result above zero after correcting for 60 combinations | **Fail** | lower bound -0.235R |
| Still makes money with costs doubled | **Fail** | -0.060R |
| Still makes money with the stop and time limit nudged | **Fail** | -0.079 / -0.045 / -0.039 / -0.061 |
| Most years positive | **Fail** | 2 of 5 |
| Profit not from one market alone | **Fail** | largest share 100% |

### Indices: not passed

| Check | Result | Measured |
|---|---|---|
| At least 200 separate trades | **Fail** | 130 |
| Average result above zero after correcting for 60 combinations | **Fail** | lower bound -0.214R |
| Still makes money with costs doubled | Pass | +0.015R |
| Still makes money with the stop and time limit nudged | **Fail** | -0.240 / +0.091 / +0.061 / +0.071 |
| Most years positive | Pass | 3 of 5 |
| Profit not from one market alone | **Fail** | largest share 77% |

## Crypto test signals

Shown to users on demo accounts as test signals, with these numbers.

| Group | Separate trades | Won | 95% low | Needed to break even | Average result (R) | Corrected low (R) |
|---|---:|---:|---:|---:|---:|---:|
| Crypto, 1-hour | 27032 | 38.1% | 37.5% | 37.3% | -0.051 | -0.076 |
| Crypto, 4-hour | 25225 | 45.6% | 45.0% | 42.5% | -0.036 | -0.054 |

## 4. Commodities market by market and year by year

| Market | Trades | Won | Average (R) |
|---|---:|---:|---:|
| UKOIL | 34 | 52.9% | +0.028 |
| XAGUSD | 36 | 63.9% | +0.456 |
| XAUUSD | 36 | 55.6% | +0.115 |

| Year | Trades | Won | Average (R) |
|---|---:|---:|---:|
| 2022 | 7 | 42.9% | -0.201 |
| 2023 | 20 | 50.0% | +0.008 |
| 2024 | 17 | 58.8% | +0.504 |
| 2025 | 30 | 53.3% | +0.050 |
| 2026 | 32 | 68.8% | +0.397 |

## 5. Is the percentage on screen honest?

Commodities: what the model said against what happened, using trades as users would get them.

| Model said | Trades | Average said | Really won |
|---|---:|---:|---:|
| (0.0, 0.45] | 33 | 41.7% | 51.5% |
| (0.45, 0.5] | 10 | 46.6% | 70.0% |
| (0.5, 0.55] | 37 | 52.2% | 54.1% |
| (0.55, 0.6] | 19 | 56.8% | 84.2% |
| (0.6, 0.65] | 4 | 63.3% | 25.0% |
| (0.65, 1.0] | 3 | 73.5% | 0.0% |

## 6. Do tests see future prices?

Checked 102 comparisons.
No differences: signals do not use later prices.

## Result

**No daily market group passed the full rule.**

**What this cannot show.** The model and strategies were designed with these years in view, so this is not fully unseen data. The only truly unseen results are the live ones, which are still far too few.
