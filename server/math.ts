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

type Rational = { n: bigint; d: bigint };
const abs = (n: bigint) => (n < 0n ? -n : n);
function rational(n: bigint, d = 1n): Rational {
  if (!d) throw new Error("Division by zero.");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = abs(n),
    b = d;
  while (b) [a, b] = [b, a % b];
  n /= a;
  d /= a;
  if (abs(n).toString().length > 512 || d.toString().length > 512)
    throw new Error("Exact arithmetic result exceeds 512 digits.");
  return { n, d };
}
const add = (a: Rational, b: Rational) =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);
const multiply = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const divide = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n);
const negate = (a: Rational) => ({ n: -a.n, d: a.d });
const format = (a: Rational) => (a.d === 1n ? String(a.n) : `${a.n}/${a.d}`);

/** A bounded arithmetic grammar, deliberately not JavaScript evaluation. */
function expressionValue(expression: string): Rational {
  if (!expression.trim() || expression.length > 512)
    throw new Error("Use an arithmetic expression of 1–512 characters.");
  const tokens: string[] = [];
  const tokenizer = /\s*(\d+(?:\.\d*)?|\.\d+|[()+\-*/%^])/y;
  let offset = 0;
  while (offset < expression.trimEnd().length) {
    tokenizer.lastIndex = offset;
    const match = tokenizer.exec(expression);
    if (!match)
      throw new Error(
        "Supported syntax: decimal numbers, parentheses, + - * / % and ^. Names, functions and code are not accepted.",
      );
    tokens.push(match[1]);
    offset = tokenizer.lastIndex;
    if (tokens.length > 256) throw new Error("Expression exceeds 256 tokens.");
  }
  let cursor = 0,
    depth = 0;
  function nested<T>(fn: () => T): T {
    if (++depth > 64) throw new Error("Expression nesting exceeds 64 levels.");
    try {
      return fn();
    } finally {
      depth--;
    }
  }
  function atom(): Rational {
    const token = tokens[cursor++];
    if (token === "(") {
      const value = nested(sum);
      if (tokens[cursor++] !== ")")
        throw new Error("Missing closing parenthesis.");
      return value;
    }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))
      throw new Error("Expected a number or parenthesized expression.");
    if (token.replace(".", "").length > 64)
      throw new Error("Each numeric literal is limited to 64 digits.");
    const [whole, fraction = ""] = token.split(".");
    return rational(
      BigInt((whole || "0") + fraction),
      10n ** BigInt(fraction.length),
    );
  }
  function power(): Rational {
    let value = atom();
    if (tokens[cursor] === "^") {
      cursor++;
      const exponent = nested(unary);
      if (exponent.d !== 1n || abs(exponent.n) > 64n)
        throw new Error("Exponents must be integers from -64 through 64.");
      if (!value.n && !exponent.n)
        throw new Error("0^0 is undefined in this calculator.");
      const e = abs(exponent.n);
      value =
        exponent.n < 0n
          ? rational(value.d ** e, value.n ** e)
          : rational(value.n ** e, value.d ** e);
    }
    return value;
  }
  function unary(): Rational {
    if (tokens[cursor] === "+") {
      cursor++;
      return nested(unary);
    }
    if (tokens[cursor] === "-") {
      cursor++;
      return negate(nested(unary));
    }
    return power();
  }
  function product(): Rational {
    let value = unary();
    while (["*", "/", "%"].includes(tokens[cursor])) {
      const op = tokens[cursor++],
        next = unary();
      if (op === "*") value = multiply(value, next);
      else if (op === "/") value = divide(value, next);
      else {
        if (value.d !== 1n || next.d !== 1n || !next.n)
          throw new Error("Remainder requires integers and a nonzero divisor.");
        value = rational(value.n % next.n);
      }
    }
    return value;
  }
  function sum(): Rational {
    let value = product();
    while (["+", "-"].includes(tokens[cursor])) {
      const op = tokens[cursor++],
        next = product();
      value = add(value, op === "-" ? negate(next) : next);
    }
    return value;
  }
  const value = sum();
  if (cursor !== tokens.length)
    throw new Error("Unexpected token; multiplication must use * explicitly.");
  return value;
}
export function calculate(expression: string) {
  const value = expressionValue(expression);
  const approximate = Number(value.n) / Number(value.d);
  return {
    expression,
    exact: format(value),
    approximate: Number.isFinite(approximate) ? approximate : null,
    method:
      "Exact rational arithmetic; decimal approximation is not used as proof.",
  };
}
export function solveLinear(coefficients: string[][], constants: string[]) {
  const rows = coefficients.length,
    columns = coefficients[0]?.length;
  if (
    !rows ||
    rows > 8 ||
    !columns ||
    columns > 8 ||
    constants.length !== rows ||
    coefficients.some((row) => row.length !== columns)
  )
    throw new Error(
      "Supply a rectangular 1–8 by 1–8 matrix and one constant per row.",
    );
  const source = coefficients.map((row) => row.map(expressionValue)),
    rhs = constants.map(expressionValue);
  const matrix = source.map((row, i) => [...row, rhs[i]]);
  const pivots: number[] = [];
  for (let col = 0; col < columns && pivots.length < rows; col++) {
    const row = pivots.length,
      found = matrix.findIndex((r, i) => i >= row && r[col].n !== 0n);
    if (found < 0) continue;
    [matrix[row], matrix[found]] = [matrix[found], matrix[row]];
    const divisor = matrix[row][col];
    matrix[row] = matrix[row].map((v) => divide(v, divisor));
    for (let i = 0; i < rows; i++)
      if (i !== row) {
        const scale = matrix[i][col];
        matrix[i] = matrix[i].map((v, j) =>
          add(v, negate(multiply(scale, matrix[row][j]))),
        );
      }
    pivots.push(col);
  }
  const rref = matrix.map((row) => row.map(format));
  if (
    matrix.some(
      (row) =>
        row.slice(0, columns).every((v) => !v.n) && row[columns].n !== 0n,
    )
  )
    return {
      status: "inconsistent",
      coefficients,
      constants,
      rref,
      method:
        "Exact rational Gaussian elimination; a zero coefficient row has a nonzero constant.",
    };
  const solution = Array.from({ length: columns }, () => rational(0n));
  pivots.forEach((col, i) => {
    solution[col] = matrix[i][columns];
  });
  const checks = source.map((row, i) => {
    const actual = row.reduce(
      (sum, v, j) => add(sum, multiply(v, solution[j])),
      rational(0n),
    );
    return {
      row: i + 1,
      actual: format(actual),
      expected: format(rhs[i]),
      passed: actual.n === rhs[i].n && actual.d === rhs[i].d,
    };
  });
  return {
    status: pivots.length === columns ? "unique" : "infinitely_many",
    coefficients,
    constants,
    particularSolution: solution.map(format),
    freeVariables: Array.from({ length: columns }, (_, i) => i)
      .filter((i) => !pivots.includes(i))
      .map((i) => i + 1),
    rref,
    substitutionChecks: checks,
    verified: checks.every((c) => c.passed),
    method:
      "Exact rational Gaussian elimination and substitution into every original equation. Free variables are zero in the particular solution.",
  };
}
