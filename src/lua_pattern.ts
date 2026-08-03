/**
 * A from-scratch implementation of the subset of Lua 5.4 pattern matching
 * (https://www.lua.org/manual/5.4/manual.html#6.4.1) needed by this port:
 * literals, `.`, character classes (`%a %d %l %s %u %w %x %p %c %g` and
 * their uppercase negations), `[set]`/`[^set]` with ranges, quantifiers
 * `* + - ?`, anchors `^` `$`, and captures `(...)`.
 *
 * Not supported (unused by anything ported so far): back-references
 * (`%1`-`%9`), `%b` balanced match, `%f` frontier pattern. Extend here if a
 * later ticket needs one of these.
 *
 * No JS library implements Lua patterns: they are not regular expressions
 * and have different, incompatible syntax. This is a small hand port of the
 * classic backtracking algorithm in Lua's own `lstrlib.c`.
 */

interface Capture {
  start: number;
  len: number;
}

const CAP_UNFINISHED = -1;
const CAP_POSITION = -2;
const MAX_CALLS = 200;

class MatchState {
  readonly src: string;
  readonly pat: string;
  captures: Capture[] = [];
  calls = 0;

  constructor(src: string, pat: string) {
    this.src = src;
    this.pat = pat;
  }
}

/** Returns the pattern index just past the single pattern item starting at `p`. */
function classEnd(ms: MatchState, pIn: number): number {
  let p = pIn;
  const c = ms.pat[p++];

  if (c === "%") {
    if (p >= ms.pat.length) {
      throw new Error("malformed pattern (ends with '%')");
    }
    return p + 1;
  }

  if (c === "[") {
    if (ms.pat[p] === "^") p++;
    do {
      if (p >= ms.pat.length) {
        throw new Error("malformed pattern (missing ']')");
      }
      const cc = ms.pat[p++];
      if (cc === "%" && p < ms.pat.length) p++;
    } while (ms.pat[p] !== "]");
    return p + 1;
  }

  return p;
}

function matchClassSingle(c: string, cl: string): boolean {
  let res: boolean;
  const lower = cl.toLowerCase();

  switch (lower) {
    case "a":
      res = /[a-zA-Z]/.test(c);
      break;
    case "d":
      res = /[0-9]/.test(c);
      break;
    case "l":
      res = /[a-z]/.test(c);
      break;
    case "s":
      res = /[ \t\n\v\f\r]/.test(c);
      break;
    case "u":
      res = /[A-Z]/.test(c);
      break;
    case "w":
      res = /[a-zA-Z0-9]/.test(c);
      break;
    case "x":
      res = /[0-9a-fA-F]/.test(c);
      break;
    case "p": {
      const code = c.charCodeAt(0);
      res = (code >= 33 && code <= 47) || (code >= 58 && code <= 64) ||
        (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
      break;
    }
    case "c": {
      const code = c.charCodeAt(0);
      res = code < 32 || code === 127;
      break;
    }
    case "g": {
      const code = c.charCodeAt(0);
      res = code > 32 && code < 127;
      break;
    }
    default:
      // Not a recognized class letter: an escaped magic character, matched
      // literally (e.g. `%.` matches a literal dot).
      return cl === c;
  }

  return cl === lower ? res : !res;
}

function matchSet(
  ms: MatchState,
  c: string,
  pIn: number,
  pEnd: number,
): boolean {
  let p = pIn + 1;
  let negate = false;

  if (ms.pat[p] === "^") {
    negate = true;
    p++;
  }

  let found = false;
  const setEnd = pEnd - 1;

  while (p < setEnd) {
    if (ms.pat[p] === "%") {
      p++;
      if (matchClassSingle(c, ms.pat[p])) found = true;
      p++;
    } else if (ms.pat[p + 1] === "-" && p + 2 < setEnd) {
      if (ms.pat[p] <= c && c <= ms.pat[p + 2]) found = true;
      p += 3;
    } else {
      if (ms.pat[p] === c) found = true;
      p++;
    }
  }

  return negate ? !found : found;
}

function singleMatch(
  ms: MatchState,
  s: number,
  p: number,
  ep: number,
): boolean {
  if (s >= ms.src.length) return false;
  const c = ms.src[s];
  const pc = ms.pat[p];

  if (pc === ".") return true;
  if (pc === "%") return matchClassSingle(c, ms.pat[p + 1]);
  if (pc === "[") return matchSet(ms, c, p, ep);
  return pc === c;
}

function doMatch(ms: MatchState, sIn: number, pIn: number): number | null {
  if (ms.calls++ > MAX_CALLS) {
    throw new Error("pattern too complex");
  }

  try {
    let s = sIn;
    let p = pIn;

    while (true) {
      if (p >= ms.pat.length) return s;

      const pc = ms.pat[p];

      if (pc === "(") {
        return ms.pat[p + 1] === ")"
          ? startCapturePosition(ms, s, p + 2)
          : startCapture(ms, s, p + 1);
      }

      if (pc === ")") {
        return endCapture(ms, s, p + 1);
      }

      if (pc === "$" && p + 1 === ms.pat.length) {
        return s === ms.src.length ? s : null;
      }

      if (pc === "%") {
        const nc = ms.pat[p + 1];
        if (nc === "b" || nc === "f" || (nc >= "0" && nc <= "9")) {
          throw new Error(
            `Lua pattern feature '%${nc}' is not supported by this port`,
          );
        }
      }

      const ep = classEnd(ms, p);
      const quant = ms.pat[ep];

      if (quant === "?") {
        if (singleMatch(ms, s, p, ep)) {
          const res = doMatch(ms, s + 1, ep + 1);
          if (res !== null) return res;
        }
        p = ep + 1;
        continue;
      }

      if (quant === "+") {
        return singleMatch(ms, s, p, ep) ? maxExpand(ms, s + 1, p, ep) : null;
      }

      if (quant === "*") {
        return maxExpand(ms, s, p, ep);
      }

      if (quant === "-") {
        return minExpand(ms, s, p, ep);
      }

      if (!singleMatch(ms, s, p, ep)) return null;
      s++;
      p = ep;
    }
  } finally {
    ms.calls--;
  }
}

function maxExpand(
  ms: MatchState,
  s: number,
  p: number,
  ep: number,
): number | null {
  let i = 0;
  while (singleMatch(ms, s + i, p, ep)) i++;

  while (i >= 0) {
    const res = doMatch(ms, s + i, ep + 1);
    if (res !== null) return res;
    i--;
  }

  return null;
}

function minExpand(
  ms: MatchState,
  sIn: number,
  p: number,
  ep: number,
): number | null {
  let s = sIn;

  while (true) {
    const res = doMatch(ms, s, ep + 1);
    if (res !== null) return res;
    if (singleMatch(ms, s, p, ep)) s++;
    else return null;
  }
}

function startCapture(ms: MatchState, s: number, p: number): number | null {
  ms.captures.push({ start: s, len: CAP_UNFINISHED });
  const res = doMatch(ms, s, p);
  if (res === null) ms.captures.pop();
  return res;
}

/** A `()` capture with nothing between the parens: records the 1-based match position, not a substring. */
function startCapturePosition(
  ms: MatchState,
  s: number,
  p: number,
): number | null {
  ms.captures.push({ start: s, len: CAP_POSITION });
  const res = doMatch(ms, s, p);
  if (res === null) ms.captures.pop();
  return res;
}

function endCapture(ms: MatchState, s: number, p: number): number | null {
  let l = -1;
  for (let i = ms.captures.length - 1; i >= 0; i--) {
    if (ms.captures[i].len === CAP_UNFINISHED) {
      l = i;
      break;
    }
  }
  if (l < 0) throw new Error("invalid pattern capture");

  ms.captures[l].len = s - ms.captures[l].start;
  const res = doMatch(ms, s, p);
  if (res === null) ms.captures[l].len = CAP_UNFINISHED;
  return res;
}

/**
 * Raw captures for a match; empty if the pattern had no explicit `(...)`
 * groups. A `()` position capture yields the 1-based match position as a
 * number, matching `string.find`'s own behavior, instead of a substring.
 */
function getCaptures(ms: MatchState): (string | number)[] {
  return ms.captures.map((cap) =>
    cap.len === CAP_POSITION
      ? cap.start + 1
      : ms.src.slice(cap.start, cap.start + cap.len)
  );
}

export interface LuaFindResult {
  /** 0-based, inclusive. */
  start: number;
  /** 0-based, exclusive. */
  end: number;
  /** Raw captures; empty if the pattern had no explicit `(...)` groups (matches `string.find`'s behavior of not returning extra values in that case). */
  captures: (string | number)[];
}

/**
 * Lua-pattern equivalent of `string.find(s, pattern, init)`. Does not
 * support the `plain` argument (always pattern mode); nothing ported so far
 * needs plain-text find.
 */
export function luaFind(
  s: string,
  pattern: string,
  init = 0,
): LuaFindResult | undefined {
  let pat = pattern;
  let start = init;
  const anchored = pat[0] === "^";
  if (anchored) pat = pat.slice(1);

  do {
    const ms = new MatchState(s, pat);
    const e = doMatch(ms, start, 0);
    if (e !== null) {
      return { start, end: e, captures: getCaptures(ms) };
    }
    start++;
  } while (!anchored && start <= s.length);

  return undefined;
}

/**
 * Lua-pattern equivalent of `string.gmatch(s, pattern)`. Note: unlike
 * `find`/`match`, a leading `^` has no anchoring meaning here (matches Lua's
 * own restriction, since gmatch searches repeatedly).
 */
export function* luaGmatch(
  s: string,
  pattern: string,
): Generator<string | number | (string | number)[]> {
  let pos = 0;

  while (pos <= s.length) {
    const ms = new MatchState(s, pattern);
    const e = doMatch(ms, pos, 0);

    if (e === null) {
      pos++;
      continue;
    }

    const raw = getCaptures(ms);
    const result: string | number | (string | number)[] = raw.length === 0
      ? s.slice(pos, e)
      : raw.length === 1
      ? raw[0]
      : raw;
    yield result;
    pos = e > pos ? e : pos + 1;
  }
}
