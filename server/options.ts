/**
 * Deterministic option maths shared by the Kite tools and the option_strategy
 * agent tool. Everything here is a model estimate (Black-Scholes, lognormal
 * prices, no dividends), never market data.
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function erf(x: number) {
  // Abramowitz and Stegun 7.1.26, absolute error below 1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

export const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const normPdf = (x: number) => Math.exp(-(x * x) / 2) / SQRT_2PI;

export function blackScholes(
  type: "CE" | "PE",
  spot: number,
  strike: number,
  years: number,
  rate: number,
  sigma: number,
) {
  const sqrtT = Math.sqrt(years);
  const sq = sigma * sqrtT;
  const d1 =
    (Math.log(spot / strike) + (rate + (sigma * sigma) / 2) * years) / sq;
  const d2 = d1 - sq;
  const discounted = strike * Math.exp(-rate * years);
  const gamma = normPdf(d1) / (spot * sq);
  const vega = (spot * normPdf(d1) * sqrtT) / 100;
  const decay = -(spot * normPdf(d1) * sigma) / (2 * sqrtT);
  return type === "CE"
    ? {
        price: spot * normCdf(d1) - discounted * normCdf(d2),
        delta: normCdf(d1),
        gamma,
        vega,
        thetaPerDay: (decay - rate * discounted * normCdf(d2)) / 365,
      }
    : {
        price: discounted * normCdf(-d2) - spot * normCdf(-d1),
        delta: normCdf(d1) - 1,
        gamma,
        vega,
        thetaPerDay: (decay + rate * discounted * normCdf(-d2)) / 365,
      };
}

export function impliedVolatility(
  type: "CE" | "PE",
  price: number,
  spot: number,
  strike: number,
  years: number,
  rate: number,
) {
  if (!(price > 0 && spot > 0 && strike > 0 && years > 0)) return undefined;
  let lo = 1e-4,
    hi = 5;
  if (
    price < blackScholes(type, spot, strike, years, rate, lo).price ||
    price > blackScholes(type, spot, strike, years, rate, hi).price
  )
    return undefined;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (blackScholes(type, spot, strike, years, rate, mid).price > price)
      hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface StrategyLeg {
  type: "CE" | "PE" | "FUT";
  side: "buy" | "sell";
  /** Required for CE/PE. */
  strike?: number;
  /** Option premium per unit, or futures entry price. */
  premium: number;
  lots?: number;
  /** Annualised implied volatility in percent for this leg. */
  iv?: number;
}

export interface StrategyInput {
  legs: StrategyLeg[];
  lotSize: number;
  spot: number;
  daysToExpiry?: number;
  /** Annualised implied volatility in percent used when a leg has none. */
  iv?: number;
  riskFreeRate?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Expiry payoff, breakevens, probability of profit and Greeks. */
export function analyzeStrategy(input: StrategyInput) {
  const { legs, lotSize, spot } = input;
  if (!legs.length || legs.length > 8)
    throw new Error("Provide between 1 and 8 legs.");
  if (!(lotSize >= 1) || !(spot > 0))
    throw new Error("lotSize and spot must be positive.");
  for (const leg of legs) {
    if (leg.type !== "FUT" && !(Number(leg.strike) > 0))
      throw new Error("Every CE/PE leg needs a positive strike.");
    if (!(leg.premium >= 0)) throw new Error("Premiums cannot be negative.");
    if (
      leg.lots !== undefined &&
      !(Number.isInteger(leg.lots) && leg.lots >= 1)
    )
      throw new Error("lots must be a positive whole number.");
  }
  const qty = (leg: StrategyLeg) => (leg.lots ?? 1) * lotSize;
  const sign = (leg: StrategyLeg) => (leg.side === "buy" ? 1 : -1);
  const pnlAt = (price: number) =>
    legs.reduce((total, leg) => {
      const value =
        leg.type === "CE"
          ? Math.max(0, price - leg.strike!)
          : leg.type === "PE"
            ? Math.max(0, leg.strike! - price)
            : price;
      return total + sign(leg) * (value - leg.premium) * qty(leg);
    }, 0);
  // Payoff is piecewise linear with kinks only at strikes.
  const kinks = [
    ...new Set(legs.filter((l) => l.type !== "FUT").map((l) => l.strike!)),
  ].sort((a, b) => a - b);
  const slopeAbove = legs.reduce(
    (s, leg) => s + (leg.type === "PE" ? 0 : sign(leg) * qty(leg)),
    0,
  );
  const points = [0, ...kinks];
  const last = points[points.length - 1];
  const values = points.map(pnlAt);
  const maxPoint = Math.max(...values);
  const minPoint = Math.min(...values);
  const maxProfit = slopeAbove > 0 ? "unlimited" : r2(maxPoint);
  const maxLoss = slopeAbove < 0 ? "unlimited" : r2(minPoint);
  const pLast = values[values.length - 1];
  const eps = 1e-9 * Math.max(1, ...values.map(Math.abs));
  const clean = (p: number) => (Math.abs(p) <= eps ? 0 : p);
  // Price intervals where dir × P&L is strictly positive, merged. dir = 1 gives
  // profit regions, -1 loss regions; zero plateaus belong to neither.
  const regions = (dir: 1 | -1) => {
    const out: [number, number][] = [];
    const add = (a: number, b: number) => {
      if (!(b > a)) return;
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev[1] - a) <= 1e-9 * Math.max(1, a)) prev[1] = b;
      else out.push([a, b]);
    };
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const pa = dir * clean(values[i]);
      const pb = dir * clean(values[i + 1]);
      if (pa > 0 && pb > 0) add(a, b);
      else if (pa > 0) add(a, pb === 0 ? b : a + ((b - a) * pa) / (pa - pb));
      else if (pb > 0) add(pa === 0 ? a : a + ((b - a) * -pa) / (pb - pa), b);
    }
    const pl = dir * clean(pLast);
    const slope = dir * slopeAbove;
    if (pl > 0) add(last, slope >= 0 ? Infinity : last + pl / -slope);
    else if (slope > 0) add(pl === 0 ? last : last + -pl / slope, Infinity);
    return out;
  };
  const profitRegions = regions(1);
  const uniqueBreakevens = [
    ...new Set(
      [...profitRegions, ...regions(-1)]
        .flat()
        .filter((x) => x > 0 && Number.isFinite(x))
        .map(r2),
    ),
  ].sort((a, b) => a - b);
  const netPremium = legs.reduce(
    (total, leg) =>
      leg.type === "FUT" ? total : total + sign(leg) * leg.premium * qty(leg),
    0,
  );
  const years =
    input.daysToExpiry && input.daysToExpiry > 0
      ? input.daysToExpiry / 365
      : undefined;
  const rate = input.riskFreeRate ?? 0.065;
  const legSigma = (leg: StrategyLeg) => {
    const pct = leg.iv ?? input.iv;
    return pct && pct > 0 ? pct / 100 : undefined;
  };
  const atmSigma =
    input.iv && input.iv > 0
      ? input.iv / 100
      : (() => {
          const ivs = legs.map(legSigma).filter((s): s is number => !!s);
          return ivs.length
            ? ivs.reduce((a, b) => a + b, 0) / ivs.length
            : undefined;
        })();
  let probabilityOfProfit: number | undefined;
  let expectedMove: { oneSdLow: number; oneSdHigh: number } | undefined;
  if (years && atmSigma) {
    const mu = Math.log(spot) + (rate - (atmSigma * atmSigma) / 2) * years;
    const sd = atmSigma * Math.sqrt(years);
    const cdf = (x: number) => (x <= 0 ? 0 : normCdf((Math.log(x) - mu) / sd));
    const probability = profitRegions.reduce(
      (sum, [a, b]) => sum + (b === Infinity ? 1 : cdf(b)) - cdf(a),
      0,
    );
    probabilityOfProfit = Math.round(probability * 1000) / 10;
    expectedMove = {
      oneSdLow: r2(spot * Math.exp(-sd)),
      oneSdHigh: r2(spot * Math.exp(sd)),
    };
  }
  let greeks:
    | {
        delta: number;
        gamma: number;
        thetaPerDay: number;
        vegaPerVolPoint: number;
      }
    | undefined;
  if (years) {
    const total = { delta: 0, gamma: 0, thetaPerDay: 0, vegaPerVolPoint: 0 };
    let complete = true;
    for (const leg of legs) {
      if (leg.type === "FUT") {
        total.delta += sign(leg) * qty(leg);
        continue;
      }
      const sigma = legSigma(leg);
      if (!sigma) {
        complete = false;
        break;
      }
      const g = blackScholes(leg.type, spot, leg.strike!, years, rate, sigma);
      total.delta += sign(leg) * g.delta * qty(leg);
      total.gamma += sign(leg) * g.gamma * qty(leg);
      total.thetaPerDay += sign(leg) * g.thetaPerDay * qty(leg);
      total.vegaPerVolPoint += sign(leg) * g.vega * qty(leg);
    }
    if (complete)
      greeks = {
        delta: r2(total.delta),
        gamma: Math.round(total.gamma * 1e4) / 1e4,
        thetaPerDay: r2(total.thetaPerDay),
        vegaPerVolPoint: r2(total.vegaPerVolPoint),
      };
  }
  const grid = [
    ...new Set(
      [
        spot * 0.85,
        spot * 0.9,
        spot * 0.95,
        spot,
        spot * 1.05,
        spot * 1.1,
        spot * 1.15,
        ...kinks,
        ...uniqueBreakevens,
      ].map(r2),
    ),
  ]
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  return {
    netPremium: r2(netPremium),
    entry:
      netPremium > 0
        ? `Net debit ₹${r2(netPremium)}`
        : netPremium < 0
          ? `Net credit ₹${r2(-netPremium)}`
          : "No net premium",
    maxProfit,
    maxLoss,
    rewardToRisk:
      typeof maxProfit === "number" &&
      typeof maxLoss === "number" &&
      maxLoss < 0
        ? r2(maxProfit / -maxLoss)
        : undefined,
    breakevens: uniqueBreakevens,
    probabilityOfProfitPct: probabilityOfProfit,
    expectedMoveAtExpiry: expectedMove,
    greeks,
    payoffAtExpiry: grid.map((price) => ({ price, pnl: r2(pnlAt(price)) })),
    units:
      "Rupee amounts are for the whole position (premium × lots × lotSize). netPremium > 0 is paid, < 0 is received. greeks.delta is in underlying units.",
    assumptions: `Computed by Council at expiry, before brokerage, STT, exchange charges, GST and stamp duty. Probability of profit and Greeks are Black-Scholes/lognormal estimates using ${atmSigma ? `${r2(atmSigma * 100)}% volatility` : "no volatility (omitted)"}, ${r2(rate * 100)}% risk-free rate and no dividends; they ignore volatility skew between strikes, early exits and margin.`,
  };
}
