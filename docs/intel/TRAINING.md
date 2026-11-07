# Training contest

Generated 2026-11-06 21:04 UTC from 1,576,423 real 1-minute readings, 2023-11-07 to 2026-11-06.
Each version trained 3 times and was judged on the average, on 3 separate 91-day periods it never trained on, with a gap around each. A new version replaces the current one only if it earns more per unit risked than training luck explains (and at least 0.005) and more in total, on 500+ trades, in as many periods, with no worse lower bound.
Totals and worst losing runs are in units of the fixed stake per trade. The lower bound counts each day once and is corrected for 79 combinations tried. Past periods helped design this contest, so only live results are truly unseen.

## Fixed Time, 60 minutes (needs 55.56%)

| Version | Trades | Won | Average | Training luck | Total | Worst run | Worst day | Corrected low | Periods up | Up share | Top coin | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| current (1 year, 150 rounds) | 1,874 | 55.02% | -0.0096 | 0.0156 | -30.8 | 58.1 | -14.8 | -0.1162 | 0 of 3 | 62% | 196% |  |
| 3 years, 150 rounds | 2,163 | 56.57% | +0.0182 | 0.0152 | +39.3 | 37.6 | -13.5 | -0.0688 | 3 of 3 | 75% | 220% |  |
| 3 years, 500 slower rounds | 1,862 | 56.96% | +0.0253 | 0.0096 | +44.8 | 38.1 | -12.7 | -0.0666 | 2 of 3 | 84% | 62% |  |
| 1 year, 500 slower rounds | 2,669 | 54.82% | -0.0133 | 0.0240 | -35.3 | 85.6 | -16.4 | -0.0891 | 1 of 3 | 83% | 84% |  |
| 3 years, blend of 3 models | 3,230 | 56.68% | +0.0203 | 0.0194 | +62.2 | 53.1 | -14.3 | -0.0480 | 3 of 3 | 77% | 64% | **Chosen** |

## InZone, 60 minutes (needs 47.62%)

| Version | Trades | Won | Average | Training luck | Total | Worst run | Worst day | Corrected low | Periods up | Up share | Top coin | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| current (1 year, 150 rounds) | 19,070 | 51.92% | +0.0903 | 0.0163 | +1718.6 | 98.9 | -29.2 | +0.0589 | 3 of 3 | 100% | 32% |  |
| 3 years, 150 rounds | 17,276 | 52.66% | +0.1058 | 0.0056 | +1827.4 | 55.2 | -23.9 | +0.0737 | 3 of 3 | 100% | 33% |  |
| 3 years, 500 slower rounds | 17,274 | 52.92% | +0.1112 | 0.0038 | +1920.3 | 47.7 | -30.3 | +0.0782 | 3 of 3 | 100% | 34% |  |
| 1 year, 500 slower rounds | 18,712 | 52.14% | +0.0949 | 0.0058 | +1775.2 | 58.2 | -28.5 | +0.0635 | 3 of 3 | 100% | 32% |  |
| 3 years, blend of 3 models | 16,983 | 53.08% | +0.1146 | 0.0051 | +1945.0 | 50.4 | -24.8 | +0.0812 | 3 of 3 | 100% | 31% | **Chosen** |
