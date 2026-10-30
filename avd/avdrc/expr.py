"""Float expressions: a small AST with constant folding, infix printing for the JSON, RPN
length (Android evaluates at most 32 tokens per FloatExpression) and a pool that turns
expressions into named `variable` commands, shared and split to fit."""

import math

PREC = {'+': 1, '-': 1, '*': 2, '/': 2, '%': 2}


class E:
    __slots__ = ('kind', 'v', 'args')

    def __init__(self, kind, v=None, args=()):
        self.kind = kind        # num | var | op | fn | neg
        self.v = v
        self.args = tuple(args)

    # -- construction ------------------------------------------------------------------
    def __add__(self, o): return add(self, o)
    def __radd__(self, o): return add(o, self)
    def __sub__(self, o): return sub(self, o)
    def __rsub__(self, o): return sub(o, self)
    def __mul__(self, o): return mul(self, o)
    def __rmul__(self, o): return mul(o, self)
    def __truediv__(self, o): return div(self, o)
    def __rtruediv__(self, o): return div(o, self)
    def __neg__(self): return sub(0, self)

    @property
    def is_num(self):
        return self.kind == 'num'

    def size(self):
        if self.kind in ('num', 'var'):
            return 1
        return sum(a.size() for a in self.args) + 1

    def infix(self, parent_prec=0, right=False):
        k = self.kind
        if k == 'num':
            return fmt(self.v)
        if k == 'var':
            return self.v
        if k == 'fn':
            return '%s(%s)' % (self.v, ', '.join(a.infix() for a in self.args))
        if k == 'neg':
            return '-(%s)' % self.args[0].infix()
        p = PREC[self.v]
        s = '%s %s %s' % (self.args[0].infix(p, False), self.v, self.args[1].infix(p, True))
        if p < parent_prec or (p == parent_prec and right):
            s = '(%s)' % s
        return s

    def __repr__(self):
        return 'E<%s>' % self.infix()

    def key(self):
        return self.infix()


def fmt(v):
    if v == int(v) and abs(v) < 1e9:
        return str(int(v))
    s = '%.6g' % v
    if 'e' in s:
        s = ('%.9f' % v).rstrip('0').rstrip('.')
    return s


def _jnum(v):
    r = float(fmt(v))
    return int(r) if r == int(r) else r


def N(v):
    return v if isinstance(v, E) else E('num', float(v))


def V(name):
    return E('var', name if name.startswith('@') or name.endswith(')') else '@' + name)


SYSVAR = {'animationTime()', 'componentWidth()', 'componentHeight()'}


def sysvar(name):
    return E('var', name)


def _fold(kind, v, args):
    if all(a.is_num for a in args):
        x = [a.v for a in args]
        try:
            r = PY_FUNCS[v](*x)
            if r is not None and math.isfinite(r):
                return N(r)
        except (ZeroDivisionError, ValueError, OverflowError):
            pass
    return E(kind, v, args)


def add(a, b):
    a, b = N(a), N(b)
    if a.is_num and a.v == 0:
        return b
    if b.is_num and b.v == 0:
        return a
    if b.is_num and b.v < 0 and not a.is_num:
        return sub(a, N(-b.v))
    if b.kind == 'op' and b.v == '*' and b.args[0].is_num and b.args[0].v < 0 and not a.is_num:
        return sub(a, mul(N(-b.args[0].v), b.args[1]))
    return _fold('op', '+', (a, b))


def sub(a, b):
    a, b = N(a), N(b)
    if b.is_num and b.v == 0:
        return a
    if a.key() == b.key():
        return N(0)
    return _fold('op', '-', (a, b))


def mul(a, b):
    a, b = N(a), N(b)
    if (a.is_num and a.v == 0) or (b.is_num and b.v == 0):
        return N(0)
    if a.is_num and a.v == 1:
        return b
    if b.is_num and b.v == 1:
        return a
    return _fold('op', '*', (a, b))


def div(a, b):
    a, b = N(a), N(b)
    if b.is_num and b.v == 1:
        return a
    if a.is_num and a.v == 0:
        return N(0)
    return _fold('op', '/', (a, b))


def mod(a, b):
    return _fold('op', '%', (N(a), N(b)))


def fn(name, *args):
    return _fold('fn', name, tuple(N(a) for a in args))


def clamp01(x):
    """min(max(x, 0), 1) as one CLAMP op (RemoteCompose clamp(a, b, c) = min(max(a, c), b))."""
    return fn('clamp', x, 1, 0)


def clamp(x, lo, hi):
    return fn('clamp', x, hi, lo)


def if_gt0(cond, then, other):
    """cond > 0 ? then : other  (RemoteCompose ifElse(a, b, c) = c > 0 ? b : a)."""
    cond, then, other = N(cond), N(then), N(other)
    if then.key() == other.key():
        return then
    return fn('ifElse', other, then, cond)


def _java_mod(a, b):
    return math.fmod(a, b)


def _ifelse(a, b, c):
    return b if c > 0 else a


PY_FUNCS = {
    '+': lambda a, b: a + b, '-': lambda a, b: a - b, '*': lambda a, b: a * b,
    '/': lambda a, b: a / b, '%': _java_mod,
    'min': min, 'max': max, 'abs': abs, 'sin': math.sin, 'cos': math.cos, 'sqrt': math.sqrt,
    'pow': lambda a, b: a ** b, 'floor': math.floor, 'ceil': math.ceil,
    'clamp': lambda a, b, c: min(max(a, c), b), 'ifElse': _ifelse,
    'step': lambda a, b: 1.0 if a > b else 0.0,
    'fract': lambda a: a - int(a), 'ping_pong': lambda a, m: (lambda t: t if t < m else 2 * m - t)(math.fmod(a, 2 * m)),
    'spline': lambda *a: None, 'lerp': lambda a, b, t: a + (b - a) * t,
    'atan2': math.atan2, 'hypot': math.hypot,
}


def evaluate(e, env):
    """Evaluate an expression in Python (variables from env: name -> float). Spline tables come
    from env['@name'] lists."""
    k = e.kind
    if k == 'num':
        return e.v
    if k == 'var':
        return env(e.v) if callable(env) else env[e.v]
    if k == 'neg':
        return -evaluate(e.args[0], env)
    if k == 'fn' and e.v == 'spline':
        table = env(e.args[0].v) if callable(env) else env[e.args[0].v]
        return monotone_spline(table, evaluate(e.args[1], env))
    if k == 'fn' and e.v == 'arrayGet':
        table = env(e.args[0].v) if callable(env) else env[e.args[0].v]
        return table[int(evaluate(e.args[1], env))]
    args = [evaluate(a, env) for a in e.args]
    return PY_FUNCS[e.v](*args)


def monotone_spline(y, x):
    """RemoteCompose's MonotonicSpline over samples at 0, 1/(n-1), ..., 1 (getPos)."""
    n = len(y)
    t = [i / (n - 1) for i in range(n)]
    slope = [(y[i + 1] - y[i]) / (t[i + 1] - t[i]) for i in range(n - 1)]
    tan = [0.0] * n
    for i in range(n - 1):
        tan[i] = slope[i] if i == 0 else (slope[i - 1] + slope[i]) * 0.5
    tan[n - 1] = slope[n - 2]
    for i in range(n - 1):
        if slope[i] == 0:
            tan[i] = 0.0
            tan[i + 1] = 0.0
        else:
            a = tan[i] / slope[i]
            b = tan[i + 1] / slope[i]
            h = math.hypot(a, b)
            if h > 9.0:
                tt = 3.0 / h
                tan[i] = tt * a * slope[i]
                tan[i + 1] = tt * b * slope[i]
    if x <= t[0]:
        return y[0] + (x - t[0]) * tan[0]
    if x >= t[-1]:
        return y[-1] + (x - t[-1]) * tan[-1]
    for i in range(n - 1):
        if x <= t[i + 1]:
            h = t[i + 1] - t[i]
            u = (x - t[i]) / h
            h00 = 2 * u ** 3 - 3 * u ** 2 + 1
            h10 = u ** 3 - 2 * u ** 2 + u
            h01 = -2 * u ** 3 + 3 * u ** 2
            h11 = u ** 3 - u ** 2
            return h00 * y[i] + h10 * h * tan[i] + h01 * y[i + 1] + h11 * h * tan[i + 1]
    return y[-1]


class Pool:
    """Named variables for the document: each distinct expression once, every one within the
    token limit (longer ones are cut into pieces that reference each other)."""

    def __init__(self, max_tokens=32, prefix='v'):
        self.max_tokens = max_tokens
        self.prefix = prefix
        self.commands = []      # JSON commands, in dependency order
        self.by_key = {}
        self.arrays = {}        # tuple(values) -> name
        self.env_arrays = {}
        self.defs = {}          # '@name' -> E
        self.float_arrays = {}  # resources.floatArrays

    def array(self, values):
        key = tuple(round(v, 6) for v in values)
        if key not in self.arrays:
            name = 'k%d' % len(self.arrays)
            self.arrays[key] = name
            self.float_arrays[name] = {'value': [_jnum(v) for v in key], 'export': False}
            self.env_arrays['@' + name] = list(key)
        return V(self.arrays[key])

    def ref(self, e, name=None):
        """A variable holding e (numbers and variables come back unchanged)."""
        e = N(e)
        if e.kind in ('num', 'var') and name is None:
            return e
        e = self.fit(e)
        key = e.key()
        if key in self.by_key and name is None:
            return self.by_key[key]
        vname = name or '%s%d' % (self.prefix, len(self.by_key))
        self.commands.append({'variable': {'name': vname, 'value': key}})
        var = V(vname)
        self.by_key[key] = var
        self.defs[var.v] = e
        return var

    def fit(self, e):
        """e with sub-expressions moved into variables until it is within the token limit."""
        if not self.max_tokens or e.size() <= self.max_tokens:
            return e
        args = [self.fit(a) for a in e.args]
        while sum(a.size() for a in args) + 1 > self.max_tokens:
            i = max(range(len(args)), key=lambda j: args[j].size())
            if args[i].size() <= 1:
                break
            args[i] = self.ref(args[i])
        return E(e.kind, e.v, args)

    def value(self, e):
        """An expression for a command field: inline if it fits, else through a variable."""
        e = N(e)
        if e.kind in ('num', 'var'):
            return e
        return self.fit(e)

    def evaluate(self, e, system):
        """Evaluate e with the pool's variables; `system` maps system variables
        ('animationTime()', ...) to values."""
        memo = {}

        def env(name):
            if name in memo:
                return memo[name]
            if name in self.env_arrays:
                return self.env_arrays[name]
            if name in self.defs:
                v = evaluate(self.defs[name], env)
            else:
                v = system[name]
            memo[name] = v
            return v
        return evaluate(N(e), env)
