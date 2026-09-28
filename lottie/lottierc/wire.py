"""The RemoteCompose wire format: opcodes, paint-bundle constants, float / NaN-id encoding and the op writer."""

import struct
import zlib



# ─────────────────────────────────────────────────────────────────────────────
# Wire format
# ─────────────────────────────────────────────────────────────────────────────

def f2bits(f):
    """IEEE-754 bit pattern of a float32, as an unsigned int."""
    return struct.unpack('>I', struct.pack('>f', float(f)))[0]

def bits2f(bits):
    return struct.unpack('>f', struct.pack('>I', bits & 0xFFFFFFFF))[0]

def nan_id(i):
    """Utils.asNan(id): an id smuggled in a NaN payload (the reference uses the negative mask)."""
    return (int(i) | 0xFF800000) & 0xFFFFFFFF

def id_from_nan(bits):
    return bits & 0x3FFFFF

def is_nan_bits(bits):
    return (bits & 0x7F800000) == 0x7F800000 and (bits & 0x7FFFFF) != 0

EXPR_OFFSET = 0x310000
def op_(n):
    return nan_id(EXPR_OFFSET + n)

# system variable ids
ID_WINDOW_WIDTH, ID_WINDOW_HEIGHT, ID_ANIMATION_TIME = 5, 6, 30

# opcodes
OP_HEADER = 0
OP_CLIP_PATH = 38
OP_CLIP_RECT = 39
OP_PAINT_VALUES = 40
OP_DRAW_RECT = 42
OP_DRAW_BITMAP = 44
OP_DATA_FLOAT = 80
OP_ANIMATED_FLOAT = 81
OP_FLOAT_LIST_COMPACT_X = 100 # EXPERIMENTAL rcX: a float list as quantised int16 / int8 values
OP_KEYFRAMED_FLOATS_X = 109   # EXPERIMENTAL rcX: keys id, curves id, clock, count, float ids — D floats from one key list
OP_BITMAP_DATA = 101
OP_PATH_DATA_COMPACT_X = 119   # EXPERIMENTAL (players/cpp/docs/EXPERIMENTAL_OPS.md)
OP_PATH_DATA = 123
OP_DRAW_PATH = 124
OP_DRAW_TWEEN_PATH = 125
OP_MATRIX_SCALE = 126
OP_MATRIX_TRANSLATE = 127
OP_MATRIX_SKEW = 128
OP_MATRIX_ROTATE = 129
OP_MATRIX_SAVE = 130
OP_MATRIX_RESTORE = 131
OP_MODIFIER_WIDTH = 16
OP_MODIFIER_HEIGHT = 67
OP_LAYOUT_ROOT = 200
OP_LAYOUT_CONTENT = 201
OP_LAYOUT_CANVAS = 205
OP_COMPONENT_VALUE = 150
CV_WIDTH, CV_HEIGHT = 0, 1
CANVAS_CONTENT_ID = -4
DIM_FILL = 1
BARE_FILL = 0x7FC00000   # canonical NaN: "fill the parent", as the reference writer emits it
OP_COLOR_EXPRESSION = 134
OP_FLOAT_LIST = 147
OP_CONDITIONAL = 178
OP_CONTAINER_END = 214
OP_PATH_TWEEN = 158           # out, p1, p2 ids, tween: a path id interpolated between two paths
OP_PATH_COMBINE = 175         # out, p1, p2 ids, op byte: path boolean (0 diff, 1 intersect, 3 union, 4 xor)
OP_LOOP = 215                 # LoopOperation: index id, from, step, until; children; CONTAINER_END

COND_EQ, COND_NEQ, COND_LT, COND_LTE, COND_GT, COND_GTE = 0, 1, 2, 3, 4, 5

# path verbs (NaN-encoded short ids)
P_MOVE, P_LINE, P_CUBIC, P_CLOSE, P_DONE = nan_id(10), nan_id(11), nan_id(14), nan_id(15), nan_id(16)

# PaintBundle commands
PB_COLOR = 4
PB_STROKE_WIDTH = 5
PB_STROKE_MITER = 6
PB_STROKE_CAP = 7
PB_STYLE = 8
PB_SHADER = 9
PB_GRADIENT = 11
PB_ALPHA = 12
PB_COLOR_FILTER = 13          # upper = PorterDuff mode, then an ARGB int
PB_COLOR_FILTER_ID = 20       # upper = mode, then a colour id
PB_CLEAR_COLOR_FILTER = 21
PB_BLUR_X = 27                # EXPERIMENTAL rcX: Gaussian blur of the draw, sigma px
BLEND_SRC_IN, BLEND_SRC_ATOP = 5, 9
PB_STROKE_JOIN = 15
PB_BLEND_MODE = 18
PB_COLOR_ID = 19
PB_PATH_EFFECT = 25
PPE_DASH = 1
GRAD_LINEAR, GRAD_RADIAL = 0, 1
GRAD_FOCAL_RADIAL_X = 3       # EXPERIMENTAL rcX: radial with a focal point: cx, cy, r, fx, fy, tileMode
STYLE_FILL, STYLE_STROKE, STYLE_FILL_AND_STROKE = 0, 1, 2
BLEND_SRC_OVER = 3

# Lottie `bm` -> PaintBundle blend mode
LOTTIE_BLEND = {1: 24, 2: 14, 3: 15, 4: 16, 5: 17, 6: 18, 7: 19, 8: 20, 9: 21,
                10: 22, 11: 23, 12: 25, 13: 26, 14: 27, 15: 28}

# ColorExpression modes
CE_ARGB, CE_IDARGB = 5, 6

# Pivot for rotate/scale. The reference writer emits a canonical NaN (0x7FC00000) for "no pivot";
# the C++ player reads that as 0 but the TypeScript player resolves it as variable id 0x400000 and
# rotates about whatever that yields. An explicit 0.0 pivot behaves identically everywhere.
NO_PIVOT = 0x00000000

MAGIC_NUMBER = 0x048C0000
TAG_WIDTH, TAG_HEIGHT, TAG_FPS, TAG_DESC = 5, 6, 8, 9
DATA_TYPE_INT, DATA_TYPE_STRING = 0, 3


class Wire:
    def __init__(self):
        self.b = bytearray()

    def byte(self, v):
        self.b.append(v & 0xFF)

    def short(self, v):
        self.b += struct.pack('>H', v & 0xFFFF)

    def int(self, v):
        self.b += struct.pack('>I', v & 0xFFFFFFFF)

    def float(self, f):
        self.b += struct.pack('>f', float(f))

    def __len__(self):
        return len(self.b)


class RcWriter:
    """Op encoders. Data ops (arrays, expressions, paths, bitmaps, colours) go to a separate
    buffer that is placed ahead of the draw ops, so nothing an expression depends on sits
    inside a conditional container."""

    def __init__(self):
        self.header = Wire()
        self.data = Wire()
        self.draw = Wire()
        # > 0 while writing a loop body: expressions and colour expressions go into the draw
        # stream, as children of the loop, so the players re-evaluate them every iteration
        self.inline = 0
        self.next_data_id = 42
        self.next_array_id = (2 << 20) + 42          # NanMap.START_ARRAY
        self.counts = {}

    def _count(self, name):
        self.counts[name] = self.counts.get(name, 0) + 1

    def alloc_id(self):
        i = self.next_data_id
        self.next_data_id += 1
        return i

    # header ------------------------------------------------------------
    def write_header(self, width, height, fps=None, description=None):
        tags = [(TAG_WIDTH, int(width)), (TAG_HEIGHT, int(height))]
        if fps:
            tags.append((TAG_FPS, int(round(fps))))
        if description:
            tags.append((TAG_DESC, description))
        tags.sort(key=lambda t: t[0])
        w = self.header
        w.byte(OP_HEADER)
        w.int(1 | MAGIC_NUMBER)
        w.int(1)
        w.int(0)
        w.int(len(tags))
        for tag, value in tags:
            if isinstance(value, str):
                w.short(tag | (DATA_TYPE_STRING << 10))
                d = value.encode('utf-8')
                w.short(len(d) + 4)
                w.int(len(d))
                w.b += d
            else:
                w.short(tag | (DATA_TYPE_INT << 10))
                w.short(4)
                w.int(value)

    # data ops ----------------------------------------------------------
    def float_list(self, values):
        aid = self.next_array_id
        self.next_array_id += 1
        w = self.data
        w.byte(OP_FLOAT_LIST)
        w.int(aid)
        w.int(len(values))
        for v in values:
            w.float(v)
        self._count('FLOAT_LIST')
        return aid

    def float_list_compact(self, raw, quanta, body, tail):
        """FLOAT_LIST_COMPACT_X: `raw` float32 values, then int16 `body` values (value i scaled by
        quanta[i % len(quanta)]), then int8 `tail` values. Returns the array id."""
        aid = self.next_array_id
        self.next_array_id += 1
        w = self.data
        w.byte(OP_FLOAT_LIST_COMPACT_X)
        w.int(aid)
        w.int(len(raw) + len(body) + len(tail))
        w.byte(len(raw))
        for v in raw:
            w.float(v)
        w.byte(len(quanta))
        for q in quanta:
            w.float(q)
        w.int(len(body))
        for v in body:
            w.short(int(v))
        for v in tail:
            w.byte(int(v) & 0xFF)
        self._count('FLOAT_LIST_COMPACT_X')
        return aid

    @staticmethod
    def compact_size(raw, quanta, body, tail):
        return 1 + 4 + 4 + 1 + 4 * len(raw) + 1 + 4 * len(quanta) + 4 + 2 * len(body) + len(tail)

    def alloc_array_id(self):
        aid = self.next_array_id
        self.next_array_id += 1
        return aid

    def float_list_at(self, aid, values):
        w = self.data
        w.byte(OP_FLOAT_LIST)
        w.int(aid)
        w.int(len(values))
        for v in values:
            w.float(v)
        self._count('FLOAT_LIST')

    def expression(self, tokens):
        """tokens are raw 32-bit patterns; returns the NaN-id bits of the new float."""
        did = self.alloc_id()
        w = self.draw if self.inline else self.data
        w.byte(OP_ANIMATED_FLOAT)
        w.int(did)
        w.int(len(tokens))
        for t in tokens:
            w.int(t)
        self._count('ANIMATED_FLOAT')
        return nan_id(did)

    def keyframed_floats(self, keys_id, curves_id, clock_bits, ids):
        """KEYFRAMED_FLOATS_X: float ids[k] = KEYFRAMES_X(curves, keys, k, clock) for every k."""
        w = self.draw if self.inline else self.data
        w.byte(OP_KEYFRAMED_FLOATS_X)
        w.int(keys_id)
        w.int(curves_id)
        w.int(clock_bits)
        w.byte(len(ids))
        for i in ids:
            w.int(i)
        self._count('KEYFRAMED_FLOATS_X')

    def color_expression(self, mode, alpha_field, r_bits, g_bits, b_bits):
        """ColorExpression (134): id, mode | alpha<<16, r, g, b. Returns the colour id."""
        cid = self.alloc_id()
        w = self.draw if self.inline else self.data
        w.byte(OP_COLOR_EXPRESSION)
        w.int(cid)
        w.int((mode & 0xFF) | ((alpha_field & 0xFFFF) << 16))
        w.int(r_bits)
        w.int(g_bits)
        w.int(b_bits)
        self._count('COLOR_EXPRESSION')
        return cid

    def path_data(self, floats, winding=0):
        """floats: list of raw bit patterns (verbs already NaN-encoded)."""
        pid = self.alloc_id()
        w = self.data
        w.byte(OP_PATH_DATA)
        w.int((pid & 0xFFFFFF) | ((winding & 0xFF) << 24))
        w.int(len(floats))
        for v in floats:
            w.int(v)
        self._count('PATH_DATA')
        return pid

    def path_data_compact(self, floats, winding, quantum, delta=False):
        """PATH_DATA_COMPACT_X (119): verbs as a byte run, no repeated current point, int16 x
        quantum coordinates when they fit (float32 otherwise). Same id space as PATH_DATA."""
        verbs, coords = [], []
        i, n = 0, len(floats)
        while i < n:
            tok = floats[i]
            verb = id_from_nan(tok) if is_nan_bits(tok) else None
            if verb == 10:       # MOVE x y
                verbs.append(10); coords += [bits2f(floats[i + 1]), bits2f(floats[i + 2])]; i += 3
            elif verb == 11:     # LINE sx sy x y
                verbs.append(11); coords += [bits2f(floats[i + 3]), bits2f(floats[i + 4])]; i += 5
            elif verb == 12:     # QUAD sx sy cx cy x y
                verbs.append(12); coords += [bits2f(v) for v in floats[i + 3:i + 7]]; i += 7
            elif verb == 14:     # CUBIC sx sy c1 c2 x y
                verbs.append(14); coords += [bits2f(v) for v in floats[i + 3:i + 9]]; i += 9
            elif verb == 15:
                verbs.append(15); i += 1
            elif verb == 16:
                i += 1
            else:
                return self.path_data(floats, winding)   # conic / variable coordinate: standard form
        int16 = all(abs(c / quantum) <= 32767 for c in coords)
        pid = self.alloc_id()
        w = self.data
        w.byte(OP_PATH_DATA_COMPACT_X)
        w.int((pid & 0xFFFFFF) | ((winding & 0xFF) << 24))
        if int16 and delta:
            # v2: quantise every coordinate to an int first, then write each point as the
            # difference from the previous point (chaining through a segment's own control
            # points; CLOSE returns to the contour start), one signed byte per axis, or the
            # escape byte 0x80 followed by an int16 when the difference does not fit.
            q = [int(round(c / quantum)) for c in coords]
            body = bytearray()
            ci = 0
            cx = cy = sx = sy = 0
            for v in verbs:
                nc = {10: 2, 11: 2, 12: 4, 14: 6}.get(v, 0)
                px, py = cx, cy
                for k in range(0, nc, 2):
                    x, y = q[ci + k], q[ci + k + 1]
                    for dv in (x - px, y - py):
                        if -127 <= dv <= 127:
                            body += struct.pack('>b', dv)
                        elif -32768 <= dv <= 32767:
                            body += struct.pack('>bh', -128, dv)
                        else:
                            return self.path_data(floats, winding)   # off the int16 range: standard form
                    px, py = x, y
                if v == 10:
                    cx = sx = q[ci]; cy = sy = q[ci + 1]
                elif nc:
                    cx, cy = q[ci + nc - 2], q[ci + nc - 1]
                elif v == 15:
                    cx, cy = sx, sy
                ci += nc
            w.int(3)
            w.float(quantum)
            w.int(len(verbs))
            for v in verbs:
                w.byte(v)
            w.b += body
            self._count('PATH_DATA_COMPACT_X')
            return pid
        w.int(1 if int16 else 0)
        w.float(quantum)
        w.int(len(verbs))
        for v in verbs:
            w.byte(v)
        for c in coords:
            if int16:
                w.short(int(round(c / quantum)))
            else:
                w.float(c)
        self._count('PATH_DATA_COMPACT_X')
        return pid

    def bitmap_data(self, width, height, png_bytes):
        bid = self.alloc_id()
        w = self.data
        w.byte(OP_BITMAP_DATA)
        w.int(bid)
        w.int(int(width) & 0xFFFF)     # type PNG_8888 (0) in the high half
        w.int(int(height) & 0xFFFF)    # encoding INLINE (0) in the high half
        w.int(len(png_bytes))
        w.b += png_bytes
        self._count('BITMAP_DATA')
        return bid

    # draw ops ----------------------------------------------------------
    def paint(self, ints):
        w = self.draw
        w.byte(OP_PAINT_VALUES)
        w.int(len(ints))
        for v in ints:
            w.int(v)
        self._count('PAINT_VALUES')

    def draw_path(self, pid):
        self.draw.byte(OP_DRAW_PATH)
        self.draw.int(pid)
        self._count('DRAW_PATH')

    def draw_tween_path(self, p1, p2, tween_bits, start_bits, stop_bits):
        w = self.draw
        w.byte(OP_DRAW_TWEEN_PATH)
        w.int(p1)
        w.int(p2)
        w.int(tween_bits)
        w.int(start_bits)
        w.int(stop_bits)
        self._count('DRAW_TWEEN_PATH')

    def draw_rect(self, l, t, r, b):
        w = self.draw
        w.byte(OP_DRAW_RECT)
        for v in (l, t, r, b):
            w.int(v)

    def draw_bitmap(self, bid, l, t, r, b):
        w = self.draw
        w.byte(OP_DRAW_BITMAP)
        w.int(bid)
        for v in (l, t, r, b):
            w.int(v)
        w.int(0)   # content description text id
        self._count('DRAW_BITMAP')

    def clip_rect(self, l, t, r, b):
        w = self.draw
        w.byte(OP_CLIP_RECT)
        for v in (l, t, r, b):
            w.int(v)
        self._count('CLIP_RECT')

    def clip_path(self, pid):
        self.draw.byte(OP_CLIP_PATH)
        self.draw.int(pid & 0xFFFFFF)
        self._count('CLIP_PATH')

    def save(self):
        self.draw.byte(OP_MATRIX_SAVE)

    def restore(self):
        self.draw.byte(OP_MATRIX_RESTORE)

    def translate(self, dx, dy):
        w = self.draw
        w.byte(OP_MATRIX_TRANSLATE)
        w.int(dx)
        w.int(dy)
        self._count('MATRIX')

    def rotate(self, angle, px=NO_PIVOT, py=NO_PIVOT):
        w = self.draw
        w.byte(OP_MATRIX_ROTATE)
        w.int(angle)
        w.int(px)
        w.int(py)
        self._count('MATRIX')

    def scale(self, sx, sy, px=NO_PIVOT, py=NO_PIVOT):
        w = self.draw
        w.byte(OP_MATRIX_SCALE)
        w.int(sx)
        w.int(sy)
        w.int(px)
        w.int(py)
        self._count('MATRIX')

    def skew(self, kx, ky):
        w = self.draw
        w.byte(OP_MATRIX_SKEW)
        w.int(kx)
        w.int(ky)
        self._count('MATRIX')

    def cond_begin(self, ctype, a_bits, b_bits):
        w = self.draw
        w.byte(OP_CONDITIONAL)
        w.byte(ctype)
        w.int(a_bits)
        w.int(b_bits)
        self._count('CONDITIONAL')

    def cond_end(self):
        self.draw.byte(OP_CONTAINER_END)

    def loop_begin(self, index_id, from_bits, step_bits, until_bits):
        """LoopOperation (215): the children run for index = from; index < until; index += step,
        with the index published as float `index_id` before each pass."""
        w = self.draw
        w.byte(OP_LOOP)
        w.int(index_id)
        w.int(from_bits)
        w.int(step_bits)
        w.int(until_bits)
        self._count('LOOP')

    def loop_end(self):
        self.draw.byte(OP_CONTAINER_END)

    def path_tween(self, out, p1, p2, tween_bits):
        w = self.draw
        w.byte(OP_PATH_TWEEN)
        w.int(out)
        w.int(p1)
        w.int(p2)
        w.int(tween_bits)
        self._count('PATH_TWEEN')

    def path_combine(self, out, p1, p2, op):
        w = self.draw
        w.byte(OP_PATH_COMBINE)
        w.int(out)
        w.int(p1)
        w.int(p2)
        w.byte(op)
        self._count('PATH_COMBINE')

    def component_value(self, value_type, component_id):
        """COMPONENT_VALUE inside the draw stream: a float id tracking a component's width or
        height. Used for the fit transform instead of windowWidth/windowHeight, whose meaning
        differs between players once a document declares a size in its header."""
        did = self.alloc_id()
        w = self.draw
        w.byte(OP_COMPONENT_VALUE)
        w.int(value_type)
        w.int(component_id)
        w.int(did)
        self._count('COMPONENT_VALUE')
        return nan_id(did)

    def expression_in_draw(self, tokens):
        """A FloatExpression placed in the draw stream (evaluated in paint order, after the
        component values it depends on)."""
        did = self.alloc_id()
        w = self.draw
        w.byte(OP_ANIMATED_FLOAT)
        w.int(did)
        w.int(len(tokens))
        for t in tokens:
            w.int(t)
        self._count('ANIMATED_FLOAT')
        return nan_id(did)

    def layout_open(self):
        """LAYOUT_ROOT > LAYOUT_CANVAS(fillMaxSize) > content. The draw ops live inside the
        canvas. A root-less document (draw ops straight after the header) also plays, but the
        TypeScript player's pre-paint pass then applies every dirty op that carries variables —
        including CONDITIONAL_OPERATIONS — outside the paint sequence, so a layer's transforms
        leak out of their save/restore the moment it becomes visible. The pass stops at the root
        layout component, hence the wrapper."""
        w = Wire()
        w.byte(OP_LAYOUT_ROOT); w.int(-2)
        w.byte(OP_LAYOUT_CANVAS); w.int(-3); w.int(-1)
        w.byte(OP_MODIFIER_WIDTH); w.int(DIM_FILL); w.int(BARE_FILL)
        w.byte(OP_MODIFIER_HEIGHT); w.int(DIM_FILL); w.int(BARE_FILL)
        w.byte(OP_LAYOUT_CONTENT); w.int(CANVAS_CONTENT_ID)
        return w.b

    def layout_close(self):
        return bytes([OP_CONTAINER_END, OP_CONTAINER_END, OP_CONTAINER_END])   # content, canvas, root

    def to_bytes(self, rcz=False):
        doc = bytes(self.header.b + self.data.b + self.layout_open() + self.draw.b + self.layout_close())
        if rcz:
            # EXPERIMENTAL RCZ1 container: magic, inflated length, zlib stream of the document
            return b'RCZ1' + struct.pack('>I', len(doc)) + zlib.compress(doc, 9)
        return doc


def rgb_to_argb(c):
    r, g, b = c[0], c[1], c[2]
    a = c[3] if len(c) > 3 else 1.0
    # Lottie colours are 0..1 floats (a few exporters write 0..255)
    if max(r, g, b) > 1.0:
        r, g, b = r / 255.0, g / 255.0, b / 255.0
    q = lambda x: max(0, min(255, int(round(x * 255))))
    return (q(a) << 24) | (q(r) << 16) | (q(g) << 8) | q(b)


def parse_hex_color(s):
    s = str(s).lstrip('#')
    if len(s) == 6:
        return (0xFF << 24) | int(s, 16)
    if len(s) == 8:
        return int(s, 16)
    return 0xFF000000
