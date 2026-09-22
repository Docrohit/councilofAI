/** Bounded, exact integer verification. No eval, shell, network or external packages. */
export function factorInteger(input: string) {
  if (!/^[1-9][0-9]{0,12}$/.test(input) || BigInt(input) > 1_000_000_000_000n)
    throw new Error("Use an integer from 1 through 1000000000000.");
  const n = BigInt(input);
  let remaining = n;
  const factors: { prime: string; exponent: number }[] = [];
  for (let d = 2n; d * d <= remaining; d = d === 2n ? 3n : d + 2n) {
    let exponent = 0;
    while (remaining % d === 0n) {
      remaining /= d;
      exponent++;
    }
    if (exponent) factors.push({ prime: d.toString(), exponent });
  }
  if (remaining > 1n)
    factors.push({ prime: remaining.toString(), exponent: 1 });
  let product = 1n;
  let divisors = [1n];
  for (const { prime, exponent } of factors) {
    const base = [...divisors];
    let power = 1n;
    for (let i = 0; i < exponent; i++) {
      power *= BigInt(prime);
      divisors.push(...base.map((d) => d * power));
    }
    product *= power;
  }
  divisors.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    integer: input,
    prime: factors.length === 1 && factors[0].exponent === 1,
    factors,
    product: product.toString(),
    productVerified: product === n,
    divisorCount: divisors.length,
    divisors: divisors.slice(0, 256).map(String),
    divisorsTruncated: divisors.length > 256,
    method:
      "Exact integer trial division through the square root of the remaining cofactor; product independently reconstructed.",
  };
}
