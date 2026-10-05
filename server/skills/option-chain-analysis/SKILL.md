---
name: option-chain-analysis
description: Read a live Indian option chain (NSE/BSE index or F&O stock) from Kite and summarise spot, ATM, implied volatility versus historical volatility, skew, open-interest levels, put-call ratio, max pain and the expected move. Use for any question about what an option chain says, support/resistance from OI, or as the first step before choosing an options strategy.
---

# Option chain analysis

Use this skill before any options view or strategy. It turns raw chain data
into a short, evidence-backed picture. It is analysis, not a trade instruction.

## Data to collect (cite every number's source and timestamp)

1. **Chain:** `kite_option_chain` with `underlying` (for example NIFTY,
   BANKNIFTY, SENSEX or an F&O stock symbol such as RELIANCE). Use the nearest
   expiry unless the user names one; check `upcomingExpiries` and pull a
   second expiry when the question spans more than one week. Use
   `maxStrikes` 15-25 so both sides of spot are covered.
2. **Spot and day context:** `kite_quote` on the spot instrument returned by
   the chain (for example `NSE:NIFTY 50`, `NSE:RELIANCE`).
3. **Realised volatility:** `kite_historical` with `interval` `day` over about
   the last 120 calendar days for the spot instrument. Use
   `summary.historicalVolatility20Pct` and `historicalVolatility60Pct`.
4. If Kite tools are unavailable, stop and tell the user to connect Kite in
   Connections. Never invent prices, OI or volatility.

## What to compute and report

- **Spot, ATM strike, lot size, expiry and days to expiry.**
- **Implied volatility:** ATM IV (average of the ATM CE and PE `iv`). Compare it
  with HV20 and HV60: IV well above HV means options are relatively expensive
  (favours selling premium or spreads); IV near or below HV means relatively
  cheap (favours buying). Kite does not give IV history, so do not claim an IV
  rank or percentile unless the user supplies that data.
- **Skew:** compare IV of equidistant OTM puts and calls (for example 2-3
  strikes each side). Higher put IV is normal for indices; note anything
  unusual.
- **Open interest levels:** `highestCallOiStrike` often acts as resistance and
  `highestPutOiStrike` as support. Mention the next-largest levels too. OI
  shows positioning, not direction; say so.
- **Put-call OI ratio:** above about 1.2 is often read as put writing/support,
  below about 0.8 as call writing/pressure. It covers only the returned
  strikes; say which strikes.
- **Max pain:** report it with the caveat that it is a weak, expiry-week
  tendency, not a target.
- **Expected move:** the one-standard-deviation move to expiry is about
  `spot × ATM IV × sqrt(days/365)` (IV as a decimal). The ATM straddle price
  (ATM CE + PE premium) is roughly 0.8 times that move, so straddle × 1.25 is
  a quick cross-check. Report the range spot ± one standard deviation and say
  it covers about two thirds of outcomes under the model.
- **Liquidity:** flag strikes with wide bid-ask spreads or low volume/OI; avoid
  recommending them.

## Required output checklist

The answer must include, in this order:

1. Data snapshot: underlying, spot, timestamp, expiry, days to expiry, lot size.
2. Volatility: ATM IV, HV20, HV60 and the expensive/cheap conclusion.
3. Positioning: top OI support and resistance strikes, PCR (with scope), max
   pain (with caveat), notable skew.
4. Expected move range to expiry.
5. A balanced read: what the chain suggests, what would invalidate it, and the
   key risks (event dates, gap risk, low liquidity).
6. A one-line reminder that this is educational analysis, not investment
   advice, and Council places no trades.

Reviewers should reject an answer that gives a directional call without the
volatility comparison, or quotes OI/PCR without saying which strikes it covers.
