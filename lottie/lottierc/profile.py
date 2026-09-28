"""How to convert, as one object: playback, fitting, and which encodings and experimental
operations the output may use. `mainline` is what every RemoteCompose player reads today;
`rcx` uses the experimental operations of the players in this repository."""


class Profile:
    __slots__ = ('fps', 'loop', 'fit', 'interp', 'bg', 'keyframes', 'max_tokens',
                 'compact_paths', 'compact_delta', 'quantum', 'rcz',
                 'bezier_op', 'keyframe_op', 'blur_op', 'focal_op', 'quantize')

    #: named presets: the flags each one turns on over the defaults
    PRESETS = {
        'mainline': {},
        'rcx': dict(compact_paths=True, compact_delta=True, keyframe_op=True, blur_op=True, focal_op=True, quantize=0.0625, rcz=True),
    }

    def __init__(self, **kw):
        self.fps = None          # sampling rate; None = the composition's frame rate
        self.loop = True         # loop the animation (else hold the last frame)
        self.fit = True          # scale the composition to the window
        self.interp = True       # interpolate sampled values between frames
        self.bg = None           # ARGB background to paint first
        self.keyframes = True    # keyframe expressions (False: one float per frame, --sampled)
        self.max_tokens = 32     # longest FloatExpression to emit (Android's evaluator: 32; 0 = unlimited)
        self.compact_paths = False   # PATH_DATA_COMPACT_X
        self.compact_delta = False   # ... its delta form (implies compact_paths)
        self.quantum = 0.0625        # px per unit of a compact path coordinate
        self.rcz = False             # RCZ1 zlib container
        self.bezier_op = False       # BEZIER_EASE_X for easing
        self.keyframe_op = False     # KEYFRAMES_X / KEYFRAMED_FLOATS_X for keyframed properties
        self.blur_op = False         # BLUR_X for soft shadows and Gaussian blur effects
        self.focal_op = False        # FOCAL_RADIAL_GRADIENT_X for radial gradients with a highlight
        self.quantize = None         # FLOAT_LIST_COMPACT_X grid for keyframe lists, in property units
        for k, v in kw.items():
            if k not in self.__slots__:
                raise TypeError('Profile: unknown option %r' % k)
            setattr(self, k, v)
        if self.compact_delta:
            self.compact_paths = True

    @classmethod
    def preset(cls, name, **overrides):
        kw = dict(cls.PRESETS[name]); kw.update(overrides)
        return cls(**kw)

    @classmethod
    def from_args(cls, args):
        """The CLI's profile: the --profile preset, then every flag that was given on top."""
        p = cls.preset(getattr(args, 'profile', None) or 'mainline')
        if args.fps is not None: p.fps = float(args.fps)
        if args.no_loop: p.loop = False
        if args.no_fit: p.fit = False
        if args.no_interp: p.interp = False
        if args.sampled: p.keyframes = False
        if args.max_tokens is not None: p.max_tokens = args.max_tokens
        for flag in ('compact_paths', 'compact_delta', 'rcz', 'bezier_op', 'keyframe_op', 'blur_op', 'focal_op'):
            if getattr(args, flag): setattr(p, flag, True)
        if args.quantum is not None: p.quantum = args.quantum
        if args.quantize is not None: p.quantize = args.quantize
        if p.compact_delta: p.compact_paths = True
        return p

    def __repr__(self):
        return 'Profile(%s)' % ', '.join('%s=%r' % (k, getattr(self, k)) for k in self.__slots__)
