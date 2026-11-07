# Why InZone trades fail

Generated 2026-11-07 12:16 UTC from 71,734 test trades of the version trading now, and every live signal. The rule is at the top of intel/run_loss_causes.py and was fixed before any result was seen.

## The cause of each loss

| Cause | Test losses | Share | Live losses | Share |
|---|---:|---:|---:|---:|
| InZone: it finished just outside the corridor, so a small late move decided it. | 4,315 | 13.3% | 7 | 8.9% |
| InZone: the whole market moved as far as the corridor, taking this coin with it. | 17,063 | 52.5% | 40 | 50.6% |
| InZone: a sudden jump of at least twice the corridor, inside 5 minutes. | 1,169 | 3.6% | 1 | 1.3% |
| InZone: the coin moved far more than the recent prices that set the corridor had shown. | 48 | 0.1% | 1 | 1.3% |
| InZone: a steady move in one direction carried it out, with no jump and no unusual movement. | 9,889 | 30.4% | 30 | 38.0% |

Live signals so far: 113 won, 86 lost. That is too few to compare closely with the tests.

## Warning signs that could be seen before entry

A sign becomes part of the strategy only if those trades lose money under the fixed rule. InZone breaks even at 47.62% won.

| Before entry | Trades | Won | Per trade | Total | Newest 60 days, per trade | Added to strategy |
|---|---:|---:|---:|---:|---:|---|
| this coin has been jumpy all week | 7,787 | 52.86% | +0.1100 | +856.6 | +0.1025 | No |
| coins are moving very differently from each other | 9,466 | 53.43% | +0.1221 | +1155.8 | +0.1537 | No |
| the corridor is narrow compared with today's range | 1,834 | 53.49% | +0.1233 | +226.1 | +0.0306 | No |
| the price is at the top of its 30-day range | 7,505 | 53.72% | +0.1282 | +962.2 | +0.0583 | No |
| the corridor has often failed on this coin in the last 24 hours | 6,922 | 54.02% | +0.1343 | +929.9 | +0.1350 | No |
| this coin has just moved far from the rest of the market | 11,235 | 54.24% | +0.1391 | +1562.4 | +0.1363 | No |
| this coin has made a big move in the last day | 8,675 | 54.40% | +0.1424 | +1234.9 | +0.1224 | No |
| the price is far from its 200-day average | 24,716 | 54.83% | +0.1514 | +3741.1 | +0.0549 | No |
| the whole market has just made a big move | 11,626 | 55.07% | +0.1566 | +1820.3 | +0.1605 | No |
| the corridor has often failed on this coin in the last 7 days | 2,730 | 56.23% | +0.1808 | +493.5 | +0.1492 | No |
| the whole market has just turned jumpier than usual | 20,439 | 56.40% | +0.1844 | +3769.8 | +0.1880 | No |
| the corridor is unusually narrow | 7,657 | 57.84% | +0.2147 | +1643.9 | +0.2366 | No |

## Why trades win

| Cause | Test wins | Share |
|---|---:|---:|
| InZone: the price stayed inside the corridor for the whole trade. | 15,427 | 39.3% |
| InZone: the price left the corridor during the trade, then came back before the end. | 23,823 | 60.7% |

## Conditions that won most

The opposite of each warning sign, on the earlier periods. For comparison, all trades: 55.00% won, +0.1551 per trade, +9070.4 total. Report only: see the top of intel/run_loss_causes.py.

| Opposite of | Trades | Won | Per trade | Total |
|---|---:|---:|---:|---:|
| the corridor has often failed on this coin in the last 7 days | 11,710 | 59.02% | +0.2394 | +2803.1 |
| the corridor is narrow compared with today's range | 11,699 | 58.59% | +0.2303 | +2694.4 |
| the corridor has often failed on this coin in the last 24 hours | 11,704 | 58.12% | +0.2205 | +2580.2 |
| coins are moving very differently from each other | 11,699 | 56.71% | +0.1908 | +2232.4 |
| the price is far from its 200-day average | 11,699 | 56.14% | +0.1790 | +2093.8 |
| this coin has made a big move in the last day | 11,699 | 56.12% | +0.1784 | +2087.5 |
| the corridor is unusually narrow | 11,699 | 55.78% | +0.1714 | +2005.6 |
| the whole market has just made a big move | 11,700 | 55.63% | +0.1683 | +1968.9 |
| this coin has just moved far from the rest of the market | 11,699 | 55.41% | +0.1637 | +1915.3 |
| the price is at the top of its 30-day range | 11,699 | 55.13% | +0.1578 | +1846.0 |
| this coin has been jumpy all week | 11,701 | 54.47% | +0.1438 | +1682.3 |
| the whole market has just turned jumpier than usual | 11,699 | 53.63% | +0.1262 | +1476.4 |
