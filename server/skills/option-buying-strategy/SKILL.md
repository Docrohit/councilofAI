---
name: option-buying-strategy
description: Build and compare option-buying strategies (long calls, long puts, debit call/put spreads, long straddles/strangles) for an Indian stock or index using live Kite option-chain data and the option_strategy calculator. Use when the user asks for a call or put buying strategy, a directional options trade, or a limited-risk way to play a move or event.
---

# Option buying strategy

The goal is a small set of concrete, comparable candidate trades with exact
cost, risk and breakeven, chosen from live data. Never present a single trade
as certain, and never imply Council will place it.

## Step 1: Establish the view and constraints

- Read the user's view (bullish, bearish, big move either way), horizon,
  capital or risk per trade, and any event (results, RBI policy, budget). If
  the user gave no view, derive one from data and state it as a hypothesis.
- Run the `option-chain-analysis` skill first (load it with skill_load). You
  need spot, ATM, expiry choices, ATM IV versus HV20/HV60, OI levels and the
  expected move.

## Step 2: Choose structures that fit the volatility

- **IV cheap (ATM IV at or below HV):** outright long calls/puts are
  reasonable; long straddle/strangle only when a move larger than the expected
  move is plausible.
- **IV expensive (ATM IV clearly above HV):** prefer debit spreads (buy one
  strike, sell a further OTM strike) to cut premium and vega risk; avoid long
  straddles unless an event justifies it.
- **Expiry:** buyers lose to time decay fastest in the final days. Prefer an
  expiry at least 2-3 weeks out for a multi-day view; use the nearest weekly
  expiry only for short, high-conviction moves and say theta risk is high.
- **Strike selection by delta:** ~0.5 delta (ATM) for balanced exposure;
  0.30-0.40 delta for cheaper, lower-probability trades; avoid far OTM
  (<0.15 delta) "lottery" strikes unless the user asks. Use the chain's `delta`
  values. Prefer strikes with good OI, volume and tight bid-ask.

## Step 3: Price every candidate with the calculator

For each candidate (aim for 2-4, for example ATM call, 0.35-delta call, call
debit spread, and the put equivalents if the view is bearish or two-sided),
call `option_strategy` with real chain prices:

```json
{
  "tools": [
    {
      "name": "option_strategy",
      "spot": 24850,
      "lotSize": 75,
      "daysToExpiry": 16,
      "legs": [
        {
          "type": "CE",
          "side": "buy",
          "strike": 24900,
          "premium": 182.5,
          "iv": 13.4
        },
        {
          "type": "CE",
          "side": "sell",
          "strike": 25200,
          "premium": 71.0,
          "iv": 12.8
        }
      ]
    }
  ]
}
```

Use the ask price (or mid when the spread is tight) for buys and the bid (or
mid) for sells, and say which. Pass each leg's `iv` from the chain so the
probability of profit and Greeks are meaningful. Do not hand-calculate payoff
figures; cite the tool output.

## Step 4: Compare and recommend

Present a comparison table with, for each candidate: legs and expiry, net
debit per lot, max loss, max profit, breakeven(s), breakeven distance from spot
in percent, probability of profit, reward-to-risk, delta and theta per day.
Then recommend the candidate that best fits the stated view, horizon and risk,
and explain the trade-off against the runner-up.

## Risk management to include

- Position size so the max loss is within the user's stated risk (if none
  given, suggest a small fixed fraction of capital and say it is an
  assumption).
- Exit plan: a profit target (for example 50-100% gain on debit), a stop (for
  example 40-50% premium loss or a spot level that invalidates the view), and a
  time stop several days before expiry to avoid the steepest decay.
- Event risk: IV often falls after results/events (IV crush), hurting long
  options even when direction is right.
- Costs and taxes are not included in the calculator; mention brokerage, STT,
  exchange charges, GST and stamp duty reduce returns.

## Required output checklist

1. Data snapshot and volatility read (from option-chain-analysis).
2. 2-4 priced candidates from `option_strategy` in one comparison table.
3. Recommended trade with reasons, invalidation level and exit plan.
4. Key risks, including theta, IV crush, gaps and liquidity.
5. "Educational analysis, not investment advice. Council places no orders."

Reviewers should reject any answer that lacks breakeven, max loss per lot, or
an exit plan, or that uses prices not taken from live tool output.
