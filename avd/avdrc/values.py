"""Built-in values: framework resources and the public Material 3 motion tokens.

The corpus holds drawables, animators and interpolators but no `values/` files, so the
handful of `@integer/`, `@dimen/` and `@string/` references that are documented design tokens
are listed here. Anything else is reported as unresolved (pass `--values FILE.xml` to supply
a values file).
"""

# Material 3 motion tokens (m3_sys_motion_*), as published in material-components-android
_M3_DURATIONS = {
    'short1': 50, 'short2': 100, 'short3': 150, 'short4': 200,
    'medium1': 250, 'medium2': 300, 'medium3': 350, 'medium4': 400,
    'long1': 450, 'long2': 500, 'long3': 550, 'long4': 600,
    'extra_long1': 700, 'extra_long2': 800, 'extra_long3': 900, 'extra_long4': 1000,
}

EMPHASIZED_PATH = 'M 0,0 C 0.05, 0, 0.133333, 0.06, 0.166666, 0.4 C 0.208333, 0.82, 0.25, 1, 1, 1'

VALUES = {}
for _k, _v in _M3_DURATIONS.items():
    VALUES[('integer', 'm3_sys_motion_duration_' + _k)] = str(_v)
VALUES.update({
    ('dimen', 'm3_sys_motion_easing_standard_control_x1'): '0.2',
    ('dimen', 'm3_sys_motion_easing_standard_control_y1'): '0',
    ('dimen', 'm3_sys_motion_easing_standard_control_x2'): '0',
    ('dimen', 'm3_sys_motion_easing_standard_control_y2'): '1',
    ('string', 'm3_sys_motion_easing_emphasized_path_data'): EMPHASIZED_PATH,
})

ANDROID_VALUES = {
    ('integer', 'config_shortAnimTime'): '200',
    ('integer', 'config_mediumAnimTime'): '400',
    ('integer', 'config_longAnimTime'): '500',
    ('integer', 'config_activityShortDur'): '150',
    ('integer', 'config_activityDefaultDur'): '220',
}

#: non-colour theme attributes (colours are in colors.THEME_ATTRS)
THEME_ATTR_VALUES = {
    'disabledAlpha': '0.38',
    'motionDurationShort': '150', 'motionDurationMedium': '300', 'motionDurationLong': '450',
    'motionEasingLinearInterpolator': '@builtin:interpolator/linear',
    'motionEasingStandardInterpolator': '@builtin:interpolator/m3_standard',
    'motionEasingStandardDecelerateInterpolator': '@builtin:interpolator/m3_standard_decelerate',
    'motionEasingStandardAccelerateInterpolator': '@builtin:interpolator/m3_standard_accelerate',
    'motionEasingEmphasizedInterpolator': '@builtin:interpolator/m3_emphasized',
    'motionEasingEmphasizedDecelerateInterpolator': '@builtin:interpolator/m3_emphasized_decelerate',
    'motionEasingEmphasizedAccelerateInterpolator': '@builtin:interpolator/m3_emphasized_accelerate',
}
for _k, _v in _M3_DURATIONS.items():
    _name = 'motionDuration' + ''.join(p.capitalize() for p in _k.replace('extra_long', 'extraLong').split('_'))
    THEME_ATTR_VALUES[_name.replace('Extralong', 'ExtraLong')] = str(_v)
