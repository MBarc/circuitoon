"""gpiozero for Circuitoon's simulated Raspberry Pi (firmware spec 5.1).

A subset with gpiozero's names and signatures. Callbacks, blink and pulse run from Circuitoon's
scheduler (_circuitoon) at yield points: they are not threads, so a callback that sleeps holds
everything else until it returns (About the simulator says so). Input devices are not smoothed.
"""
import inspect

import _circuitoon as _rt
import circuitoon_hw as _hw
from _circuitoon import BOARD_TO_BCM as _BOARD_TO_BCM

# `from gpiozero import *` takes exactly these.
__all__ = ['GPIOZeroError', 'DeviceClosed', 'GPIOPinInUse', 'PinInvalidPin', 'PinInvalidState', 'OutputDeviceBadValue',
           'Device', 'OutputDevice', 'DigitalOutputDevice', 'LED', 'Buzzer', 'InputDevice', 'DigitalInputDevice', 'Button',
           'LineSensor', 'MotionSensor', 'PWMOutputDevice', 'PWMLED', 'RGBLED', 'Servo', 'AngularServo', 'Motor', 'pause']

# Names gpiozero has that need devices not simulated yet (spec 5.1); one entry per line, read by
# src/run/unsupported.ts for the gate's static scan.
UNSUPPORTED_NAMES = {
    'MCP3001': 'needs SPI devices, coming in a later update',
    'MCP3002': 'needs SPI devices, coming in a later update',
    'MCP3004': 'needs SPI devices, coming in a later update',
    'MCP3008': 'needs SPI devices, coming in a later update',
    'MCP3201': 'needs SPI devices, coming in a later update',
    'MCP3202': 'needs SPI devices, coming in a later update',
    'MCP3204': 'needs SPI devices, coming in a later update',
    'MCP3208': 'needs SPI devices, coming in a later update',
    'MCP3301': 'needs SPI devices, coming in a later update',
    'MCP3302': 'needs SPI devices, coming in a later update',
    'MCP3304': 'needs SPI devices, coming in a later update',
}
_M32 = 0xFFFFFFFF
_FPS = 25
_used = {}


def __getattr__(name):
    if name in UNSUPPORTED_NAMES:
        raise NotImplementedError(f'gpiozero.{name} {UNSUPPORTED_NAMES[name]}')
    if name.startswith('__'):
        raise AttributeError(name)
    raise NotImplementedError(f'gpiozero.{name} is not in the simulator yet')


class GPIOZeroError(Exception):
    pass


class DeviceClosed(GPIOZeroError):
    pass


class GPIOPinInUse(GPIOZeroError):
    pass


class PinInvalidPin(GPIOZeroError, ValueError):
    pass


class PinInvalidState(GPIOZeroError, ValueError):
    pass


class OutputDeviceBadValue(GPIOZeroError, ValueError):
    pass


def _bcm_of(spec):
    """A pin as gpiozero names it: 17, '17', 'GPIO17', 'BCM17', 'BOARD11' or 'J8:11'."""
    bcm = -1
    if isinstance(spec, int) and not isinstance(spec, bool):
        bcm = spec
    elif isinstance(spec, str):
        s = spec.strip().upper()
        for prefix, board in (('GPIO', False), ('BCM', False), ('BOARD', True), ('J8:', True), ('', False)):
            if s.startswith(prefix) and s[len(prefix):].isdigit():
                n = int(s[len(prefix):])
                bcm = _BOARD_TO_BCM.get(n, -1) if board else n
                break
    if bcm in (0, 1):
        raise PinInvalidPin(f'GPIO{bcm} is reserved for the HAT ID EEPROM and is not simulated')
    if not 2 <= bcm <= 27:
        raise PinInvalidPin(f'{spec!r} is not a valid pin on a Raspberry Pi header')
    return bcm


def _call(fn, device):
    """Calls a gpiozero callback: with the device when it takes one argument, else with none."""
    try:
        params = [p for p in inspect.signature(fn).parameters.values() if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    except (TypeError, ValueError):
        params = []
    if params:
        fn(device)
    else:
        fn()


class _Pin:
    def __init__(self, bcm):
        self.number = bcm

    def __repr__(self):
        return f'GPIO{self.number}'

    __str__ = __repr__


class Device:
    """A device on one or more pins; close() frees them (back to unused)."""

    def __init__(self, *pins, pin_factory=None):
        bcms = [_bcm_of(p) for p in pins]
        for b in bcms:
            if b in _used:
                raise GPIOPinInUse(f'pin GPIO{b} is already in use by {_used[b]!r}')
        self._pins = bcms
        self._closed = False
        for b in bcms:
            _used[b] = self

    def _release(self):
        """Stops what the device runs on its own (timers, pollers)."""

    def close(self):
        if self._closed:
            return
        self._closed = True
        self._release()
        for b in self._pins:
            _used.pop(b, None)
            _hw.setup(b, 0)

    @property
    def closed(self):
        return self._closed

    def _check(self):
        if self._closed:
            raise DeviceClosed(f'{type(self).__name__} is closed or uninitialized')

    @property
    def pin(self):
        return _Pin(self._pins[0]) if self._pins else None

    @property
    def is_active(self):
        return bool(self.value)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __repr__(self):
        where = f' on pin GPIO{self._pins[0]}' if len(self._pins) == 1 else ''
        return f'<gpiozero.{type(self).__name__} object{where}{", closed" if self._closed else ""}>'


class _Sequence:
    """Steps a device through (value, seconds) pairs, n times or forever, from timers (blink, pulse)."""

    def __init__(self, device, steps, n, after):
        self.device, self.steps, self.left, self.after = device, steps, n, after
        self.i = 0
        self.done = False
        self.timer = None
        if not any(secs > 0 for _, secs in steps):
            self._finish()
        else:
            self._step()

    def _finish(self):
        self.done = True
        self.device._write(self.after)

    def _step(self):
        while not self.done:
            if self.i == len(self.steps):
                self.i = 0
                if self.left is not None:
                    self.left -= 1
                    if self.left <= 0:
                        return self._finish()
            value, secs = self.steps[self.i]
            self.i += 1
            self.device._write(value)
            if secs > 0:
                self.timer = _rt.call_later(secs, self._step)
                return

    def cancel(self):
        self.done = True
        if self.timer is not None:
            self.timer.cancel()


def _mix(a, b, t):
    if isinstance(a, tuple):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return a + (b - a) * t


def _fade_steps(on_time, off_time, fade_in, fade_out, lo, hi):
    """gpiozero's blink sequence: fade in at 25 steps a second, on, fade out, off."""
    steps = []
    if fade_in > 0:
        k = int(_FPS * fade_in)
        steps += [(_mix(lo, hi, i / k), 1 / _FPS) for i in range(k)]
    steps.append((hi, on_time))
    if fade_out > 0:
        k = int(_FPS * fade_out)
        steps += [(_mix(hi, lo, i / k), 1 / _FPS) for i in range(k)]
    steps.append((lo, off_time))
    return steps


class OutputDevice(Device):
    def __init__(self, pin=None, *, active_high=True, initial_value=False, pin_factory=None):
        super().__init__(pin)
        self._bcm = self._pins[0]
        self.active_high = active_high
        self._seq = None
        _hw.setup(self._bcm, 4)
        if initial_value is not None:
            self._write(1 if initial_value else 0)

    def _write(self, value):
        self._check()
        _hw.output(self._bcm, 1 if bool(value) == self.active_high else 0)

    def _stop_seq(self):
        if self._seq is not None:
            self._seq.cancel()
            self._seq = None

    def _release(self):
        self._stop_seq()

    def _run_seq(self, steps, n, background, after):
        self._stop_seq()
        seq = self._seq = _Sequence(self, steps, n, after)
        if not background:
            _rt.wait(until=lambda: seq.done)

    def on(self):
        self._stop_seq()
        self._write(1)

    def off(self):
        self._stop_seq()
        self._write(0)

    def toggle(self):
        self._stop_seq()
        self._write(0 if self.value else 1)

    @property
    def value(self):
        self._check()
        _rt.yield_point()
        return 1 if _hw.read(self._bcm) == (1 if self.active_high else 0) else 0

    @value.setter
    def value(self, v):
        self._stop_seq()
        self._write(v)


class DigitalOutputDevice(OutputDevice):
    def blink(self, on_time=1, off_time=1, n=None, background=True):
        self._run_seq([(1, on_time), (0, off_time)], n, background, 0)


class LED(DigitalOutputDevice):
    is_lit = Device.is_active


class Buzzer(DigitalOutputDevice):
    def beep(self, on_time=1, off_time=1, n=None, background=True):
        self.blink(on_time, off_time, n, background)


class InputDevice(Device):
    def __init__(self, pin=None, *, pull_up=False, active_state=None, pin_factory=None):
        super().__init__(pin)
        self._bcm = self._pins[0]
        if pull_up is None:
            if active_state is None:
                raise PinInvalidState(f'Pin GPIO{self._bcm} is defined as floating, but "active_state" is not defined')
            self._active_high, mode = bool(active_state), 1
        else:
            if active_state is not None:
                raise PinInvalidState(f'Pin GPIO{self._bcm} is not floating, but "active_state" is not None')
            self._active_high, mode = not pull_up, (2 if pull_up else 3)
        self.pull_up = pull_up
        _hw.setup(self._bcm, mode)

    @property
    def value(self):
        self._check()
        _rt.yield_point()
        return 1 if _hw.read(self._bcm) == (1 if self._active_high else 0) else 0


class DigitalInputDevice(InputDevice):
    """Activation and deactivation from the editor's edge counters (spec 4.4), so a press that
    happens while the code sleeps still fires."""

    def __init__(self, pin=None, *, pull_up=False, active_state=None, bounce_time=None, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state)
        self._bounce = bounce_time or 0
        self._seen = (_hw.rising(self._bcm) & _M32, _hw.falling(self._bcm) & _M32)
        self._last = None
        self._active_since = None
        self._hold = None
        self.when_activated = None
        self.when_deactivated = None
        _rt.add_poller(self._poll)

    def _release(self):
        _rt.remove_poller(self._poll)
        if self._hold is not None:
            self._hold.cancel()

    def _poll(self):
        r, f = _hw.rising(self._bcm) & _M32, _hw.falling(self._bcm) & _M32
        ups, downs = (r - self._seen[0]) & _M32, (f - self._seen[1]) & _M32
        self._seen = (r, f)
        if not ups and not downs:
            return
        t = _rt.now()
        if self._bounce and self._last is not None and t - self._last < self._bounce:
            return
        self._last = t
        acts, deacts = (ups, downs) if self._active_high else (downs, ups)
        level_now = _hw.read(self._bcm) == (1 if self._active_high else 0)
        # Alternate the events so the last one matches the level now.
        events = []
        for _ in range(acts + deacts):
            events.append(not events[-1] if events else None)
        if events:
            events[-1] = level_now
            for i in range(len(events) - 2, -1, -1):
                events[i] = not events[i + 1]
        for active in events:
            _rt.queue(lambda active=active: self._edge(active))

    def _edge(self, active):
        if active:
            self._active_since = _rt.now()
            self._activated()
            if self.when_activated:
                _call(self.when_activated, self)
        else:
            self._active_since = None
            self._deactivated()
            if self.when_deactivated:
                _call(self.when_deactivated, self)

    def _activated(self):
        pass

    def _deactivated(self):
        pass

    @property
    def active_time(self):
        return None if self._active_since is None else _rt.now() - self._active_since

    def wait_for_active(self, timeout=None):
        return _rt.wait(timeout, until=lambda: self.is_active)

    def wait_for_inactive(self, timeout=None):
        return _rt.wait(timeout, until=lambda: not self.is_active)


class Button(DigitalInputDevice):
    def __init__(self, pin=None, *, pull_up=True, active_state=None, bounce_time=None, hold_time=1, hold_repeat=False, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state, bounce_time=bounce_time)
        self.hold_time = hold_time
        self.hold_repeat = hold_repeat
        self.when_held = None
        self._held = False

    def _activated(self):
        self._held = False
        self._hold = _rt.call_later(self.hold_time, self._held_now, self.hold_time if self.hold_repeat else None)

    def _deactivated(self):
        self._held = False
        if self._hold is not None:
            self._hold.cancel()
            self._hold = None

    def _held_now(self):
        if not self.is_active:
            return
        self._held = True
        if self.when_held:
            _call(self.when_held, self)

    @property
    def is_held(self):
        return self._held

    @property
    def held_time(self):
        return self.active_time if self._held else None

    is_pressed = Device.is_active
    when_pressed = property(lambda self: self.when_activated, lambda self, fn: setattr(self, 'when_activated', fn))
    when_released = property(lambda self: self.when_deactivated, lambda self, fn: setattr(self, 'when_deactivated', fn))
    wait_for_press = DigitalInputDevice.wait_for_active
    wait_for_release = DigitalInputDevice.wait_for_inactive


class LineSensor(DigitalInputDevice):
    """As gpiozero 2.0: the line is detected while the input is inactive."""

    @property
    def line_detected(self):
        return not self.is_active

    when_line = property(lambda self: self.when_deactivated, lambda self, fn: setattr(self, 'when_deactivated', fn))
    when_no_line = property(lambda self: self.when_activated, lambda self, fn: setattr(self, 'when_activated', fn))
    wait_for_line = DigitalInputDevice.wait_for_inactive
    wait_for_no_line = DigitalInputDevice.wait_for_active


class MotionSensor(DigitalInputDevice):
    @property
    def motion_detected(self):
        return self.is_active

    when_motion = property(lambda self: self.when_activated, lambda self, fn: setattr(self, 'when_activated', fn))
    when_no_motion = property(lambda self: self.when_deactivated, lambda self, fn: setattr(self, 'when_deactivated', fn))
    wait_for_motion = DigitalInputDevice.wait_for_active
    wait_for_no_motion = DigitalInputDevice.wait_for_inactive


class PWMOutputDevice(OutputDevice):
    """Declares duty and frequency (spec 2.2); value is the duty, 0 to 1."""

    def __init__(self, pin=None, *, active_high=True, initial_value=0, frequency=100, pin_factory=None):
        if not 0 <= float(initial_value) <= 1:
            raise OutputDeviceBadValue('PWM value must be between 0 and 1')
        self._duty = 0.0
        self._freq = float(frequency)
        super().__init__(pin, active_high=active_high, initial_value=None)
        self._write(initial_value)

    def _write(self, value):
        self._check()
        v = float(value)
        if not 0 <= v <= 1:
            raise OutputDeviceBadValue('PWM value must be between 0 and 1')
        self._duty = v
        _hw.pwm(self._bcm, True, v if self.active_high else 1 - v, self._freq)

    @property
    def value(self):
        self._check()
        return self._duty

    @value.setter
    def value(self, v):
        self._stop_seq()
        self._write(v)

    def toggle(self):
        self._stop_seq()
        self._write(1 - self._duty)

    @property
    def frequency(self):
        return self._freq

    @frequency.setter
    def frequency(self, f):
        self._freq = float(f)
        self._write(self._duty)

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, n=None, background=True):
        self._run_seq(_fade_steps(on_time, off_time, fade_in_time, fade_out_time, 0, 1), n, background, 0)

    def pulse(self, fade_in_time=1, fade_out_time=1, n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, n, background)


class PWMLED(PWMOutputDevice):
    is_lit = Device.is_active


class RGBLED(Device):
    def __init__(self, red=None, green=None, blue=None, *, active_high=True, initial_value=(0, 0, 0), pwm=True, pin_factory=None):
        cls = PWMLED if pwm else LED
        self._leds = []
        try:
            for p in (red, green, blue):
                self._leds.append(cls(p, active_high=active_high))
        except BaseException:
            for led in self._leds:
                led.close()
            raise
        super().__init__()
        self._pwm = pwm
        self._seq = None
        self._write(initial_value)

    def _write(self, color):
        self._check()
        if len(color) != 3:
            raise OutputDeviceBadValue('RGBLED color must be a 3-tuple')
        for led, v in zip(self._leds, color):
            if not self._pwm and v not in (0, 1):
                raise OutputDeviceBadValue('RGBLED with pwm=False takes only 0 or 1 per channel')
            led._write(v)

    def _stop_seq(self):
        if self._seq is not None:
            self._seq.cancel()
            self._seq = None

    def _release(self):
        self._stop_seq()
        for led in self._leds:
            led.close()

    @property
    def value(self):
        self._check()
        return tuple(float(led._duty) if self._pwm else float(led.value) for led in self._leds)

    @value.setter
    def value(self, color):
        self._stop_seq()
        self._write(color)

    color = value

    red = property(lambda self: self.value[0], lambda self, v: setattr(self, 'value', (v,) + self.value[1:]))
    green = property(lambda self: self.value[1], lambda self, v: setattr(self, 'value', self.value[:1] + (v,) + self.value[2:]))
    blue = property(lambda self: self.value[2], lambda self, v: setattr(self, 'value', self.value[:2] + (v,)))

    @property
    def is_active(self):
        return self.value != (0, 0, 0)

    is_lit = is_active

    def on(self):
        self.value = (1, 1, 1)

    def off(self):
        self.value = (0, 0, 0)

    def toggle(self):
        self.value = tuple(1 - v for v in self.value)

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, on_color=(1, 1, 1), off_color=(0, 0, 0), n=None, background=True):
        self._stop_seq()
        seq = self._seq = _Sequence(self, _fade_steps(on_time, off_time, fade_in_time, fade_out_time, tuple(off_color), tuple(on_color)), n, tuple(off_color))
        if not background:
            _rt.wait(until=lambda: seq.done)

    def pulse(self, fade_in_time=1, fade_out_time=1, on_color=(1, 1, 1), off_color=(0, 0, 0), n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, on_color, off_color, n, background)


class Servo(Device):
    """value -1 to 1 maps to min_pulse_width to max_pulse_width in a frame (spec 5.1); None detaches."""

    def __init__(self, pin=None, *, initial_value=0.0, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
        if min_pulse_width >= max_pulse_width:
            raise ValueError('min_pulse_width must be less than max_pulse_width')
        if max_pulse_width >= frame_width:
            raise ValueError('max_pulse_width must be less than frame_width')
        if initial_value is not None and not -1 <= float(initial_value) <= 1:
            raise OutputDeviceBadValue('Servo value must be between -1 and 1, or None')
        super().__init__(pin)
        self._bcm = self._pins[0]
        self._min_pw, self._max_pw, self._frame = min_pulse_width, max_pulse_width, frame_width
        self._value = None
        _hw.setup(self._bcm, 4)
        self.value = initial_value

    @property
    def frame_width(self):
        return self._frame

    @property
    def min_pulse_width(self):
        return self._min_pw

    @property
    def max_pulse_width(self):
        return self._max_pw

    @property
    def pulse_width(self):
        return None if self._value is None else self._min_pw + (self._value + 1) / 2 * (self._max_pw - self._min_pw)

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._check()
        if v is None:
            self._value = None
            _hw.pwm(self._bcm, False, 0, 1 / self._frame)
            return
        v = float(v)
        if not -1 <= v <= 1:
            raise OutputDeviceBadValue('Servo value must be between -1 and 1, or None')
        self._value = v
        _hw.pwm(self._bcm, True, self.pulse_width / self._frame, 1 / self._frame)

    @property
    def is_active(self):
        return self._value is not None

    def min(self):
        self.value = -1

    def mid(self):
        self.value = 0

    def max(self):
        self.value = 1

    def detach(self):
        self.value = None


class AngularServo(Servo):
    def __init__(self, pin=None, *, initial_angle=0.0, min_angle=-90, max_angle=90, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
        self._min_angle, self._max_angle = min_angle, max_angle
        super().__init__(pin, initial_value=None if initial_angle is None else self._to_value(initial_angle), min_pulse_width=min_pulse_width, max_pulse_width=max_pulse_width, frame_width=frame_width)

    def _to_value(self, angle):
        return (angle - self._min_angle) / (self._max_angle - self._min_angle) * 2 - 1

    @property
    def min_angle(self):
        return self._min_angle

    @property
    def max_angle(self):
        return self._max_angle

    @property
    def angle(self):
        v = self.value
        return None if v is None else self._min_angle + (v + 1) / 2 * (self._max_angle - self._min_angle)

    @angle.setter
    def angle(self, a):
        self.value = None if a is None else self._to_value(a)


class Motor(Device):
    """A motor on two pins (spec 5.1): forward on one, backward on the other."""

    def __init__(self, forward=None, backward=None, *, enable=None, pwm=True, pin_factory=None):
        if enable is not None:
            raise NotImplementedError("Motor's enable pin is not simulated yet; wire it high and leave enable out")
        cls = PWMOutputDevice if pwm else DigitalOutputDevice
        self._fwd = cls(forward)
        try:
            self._bwd = cls(backward)
        except BaseException:
            self._fwd.close()
            raise
        super().__init__()
        self._pwm = pwm

    def _set(self, dev, speed):
        if not 0 <= speed <= 1:
            raise ValueError('speed must be between 0 and 1')
        if self._pwm:
            dev.value = speed
        elif speed in (0, 1):
            dev.value = speed
        else:
            raise ValueError('a Motor with pwm=False runs only at speed 0 or 1')

    def forward(self, speed=1):
        self._set(self._bwd, 0)
        self._set(self._fwd, speed)

    def backward(self, speed=1):
        self._set(self._fwd, 0)
        self._set(self._bwd, speed)

    def stop(self):
        self._set(self._fwd, 0)
        self._set(self._bwd, 0)

    def reverse(self):
        self.value = -self.value

    @property
    def value(self):
        return float(self._fwd.value) - float(self._bwd.value)

    @value.setter
    def value(self, v):
        if v > 0:
            self.forward(v)
        elif v < 0:
            self.backward(-v)
        else:
            self.stop()

    @property
    def is_active(self):
        return self.value != 0

    def _release(self):
        self._fwd.close()
        self._bwd.close()


def pause():
    """Waits forever, running callbacks (spec 5.2)."""
    _rt.wait()
