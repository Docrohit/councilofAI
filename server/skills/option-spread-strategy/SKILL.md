---
name: option-spread-strategy
description: Design and compare defined-risk option spreads (bull/bear call and put verticals, credit spreads, iron condors, iron butterflies) on Indian indices and F&O stocks using live Kite chain data and the option_strategy calculator. Use when the user asks for a spread, a premium-selling or range-bound strategy, a hedged position, or an income strategy.
---

# Option spread strategy

Spreads trade some upside for defined risk. Every recommendation must show
exact max profit, max loss, breakevens and probability from the calculator,
with real chain prices.

## Step 1: Context first

- Run the `option-chain-analysis` skill (load it with skill_load): spot, ATM,
  expiries, ATM IV versus HV20/HV60, OI support/resistance, PCR and the
  expected move.
- Clarify the view: directional (bullish/bearish) or range-bound, horizon, and
  maximum loss the user accepts.

## Step 2: Pick the structure

| View           | Higher IV (IV > HV)           | Lower IV (IV <= HV)            |
| -------------- | ----------------------------- | ------------------------------ |
| Mildly bullish | Bull put credit spread        | Bull call debit spread         |
| Mildly bearish | Bear call credit spread       | Bear put debit spread          |
| Range-bound    | Iron condor or iron butterfly | Narrow iron butterfly, or wait |

- **Short strikes:** for credit spreads and condors, place short strikes near
  0.15-0.30 delta and ideally beyond the expected move or behind a large OI
  wall (highest call OI above spot, highest put OI below spot).
- **Width:** the distance between short and long strikes sets max loss; choose
  it from the user's risk budget and the strike interval of the chain.
- **Credit quality:** for credit spreads, a credit of roughly one third of the
  width or more is usually needed for acceptable reward-to-risk; flag thinner
  credits.
- **Expiry:** credit structures benefit from time decay; 1-4 weeks is typical.
  Note gamma risk rises sharply in expiry week.
- All legs must share one expiry for the calculator (it models payoff at a
  single expiry). For calendars or diagonals, say the calculator does not cover
  them.

## Step 3: Price candidates with the calculator

Build 2-4 variants (for example two different short strikes or widths) and
call `option_strategy` for each with chain prices and per-leg `iv`:

```json
{
  "tools": [
    {
      "name": "option_strategy",
      "spot": 24850,
      "lotSize": 75,
      "daysToExpiry": 9,
      "legs": [
        {
          "type": "PE",
          "side": "sell",
          "strike": 24500,
          "premium": 62.0,
          "iv": 13.9
        },
        {
          "type": "PE",
          "side": "buy",
          "strike": 24300,
          "premium": 36.5,
          "iv": 14.6
        },
        {
          "type": "CE",
          "side": "sell",
          "strike": 25200,
          "premium": 48.0,
          "iv": 12.6
        },
        {
          "type": "CE",
          "side": "buy",
          "strike": 25400,
          "premium": 24.0,
          "iv": 12.4
        }
      ]
    }
  ]
}
```

Use bids for sold legs and asks for bought legs (or mids when spreads are
tight) and say which. Cite the tool output; do not hand-calculate.

## Step 4: Compare, recommend and manage

- Comparison table: legs and expiry, net credit/debit per lot, max profit, max
  loss, breakevens, breakeven distance from spot, probability of profit,
  reward-to-risk, net delta, theta per day and vega.
- Recommend one variant and explain why it suits the view, IV and risk budget.
- Management plan: take profit at about 50% of max profit for credit spreads;
  exit or adjust if spot breaches a short strike or the loss reaches about 1.5-2
  times the credit received; close before expiry-day gamma risk.
- Margin: selling options needs margin that can be much larger than max loss
  shown; tell the user to check margin with their broker. Costs and taxes are
  not included in the calculator.

## Required output checklist

1. Data snapshot and volatility/positioning read.
2. 2-4 priced variants in one comparison table from `option_strategy`.
3. Recommended spread, why, and its invalidation level.
4. Management plan (profit target, stop/adjustment, exit timing).
5. Risks: gap moves through both strikes, assignment/expiry settlement, margin,
   liquidity, costs.
6. "Educational analysis, not investment advice. Council places no orders."

Reviewers should reject an answer whose max loss, breakevens or probability did
not come from `option_strategy`, or that omits margin and gap risk for sold
options.
