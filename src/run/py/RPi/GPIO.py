"""RPi.GPIO for Circuitoon's simulated Raspberry Pi (firmware spec 5.1).

The RPi.GPIO 0.7 calls on the board's simulated pins: outputs read their own latch, inputs read the
level the simulation solved, edges come from the editor's edge counters and their callbacks run at
yield points (Circuitoon's scheduler, not a thread). PWM declares its duty and frequency; nothing
toggles the pin to fake it.
"""
import sys
import warnings

import _circuitoon as _rt
import circuitoon_hw as _hw
from _circuitoon import BOARD_TO_BCM as _BOARD_TO_BCM

VERSION = '0.7.1'
RPI_REVISION = 3
BOARD = 10
BCM = 11
OUT = 0
IN = 1
LOW = 0
HIGH = 1
PUD_OFF = 20
PUD_DOWN = 21
PUD_UP = 22
RISING = 31
FALLING = 32
BOTH = 33
UNKNOWN = -1
SERIAL = 40
SPI = 41
I2C = 42
HARD_PWM = 43

_INFO = {
    'pi4': {'TYPE': 'Pi 4 Model B', 'PROCESSOR': 'BCM2711'},
    'pi5': {'TYPE': 'Pi 5', 'PROCESSOR': 'BCM2712'},
    'zero2w': {'TYPE': 'Zero 2 W', 'PROCESSOR': 'BCM2710A1'},
}
_board = _hw.board()
# Revision, maker and RAM depend on the unit, which the simulator does not know.
RPI_INFO = dict(P1_REVISION=3, REVISION='unknown', MANUFACTURER='unknown', RAM='unknown', **_INFO[_board])
if _board == 'pi5':
    sys.stderr.write('RPi.GPIO does not work on a real Pi 5; use gpiozero, or install rpi-lgpio\n')

_PULL_MODE = {PUD_OFF: 1, PUD_UP: 2, PUD_DOWN: 3}
_mode = None
_warn = True
_dir = {}
_pwm = {}
_detect = {}


def _bcm(channel):
    if _mode is None:
        raise RuntimeError('Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)')
    if not isinstance(channel, int) or isinstance(channel, bool):
        raise ValueError('Channel must be an integer or list/tuple of integers')
    if _mode == BOARD:
        if channel not in _BOARD_TO_BCM:
            raise ValueError('The channel sent is invalid on a Raspberry Pi')
        bcm = _BOARD_TO_BCM[channel]
    else:
        bcm = channel
    if bcm in (0, 1):
        raise ValueError(f'GPIO{bcm} is reserved for the HAT ID EEPROM and is not simulated')
    if not 2 <= bcm <= 27:
        raise ValueError('The channel sent is invalid on a Raspberry Pi')
    return bcm


def _channels(channel):
    return list(channel) if isinstance(channel, (list, tuple)) else [channel]


def setmode(mode):
    global _mode
    if mode not in (BOARD, BCM):
        raise ValueError('An invalid mode was passed to setmode()')
    if _mode is not None and mode != _mode:
        raise ValueError('A different mode has already been set!')
    _mode = mode


def getmode():
    return _mode


def setwarnings(flag):
    global _warn
    _warn = bool(flag)


def setup(channel, direction, pull_up_down=PUD_OFF, initial=-1):
    if direction not in (IN, OUT):
        raise ValueError('An invalid direction was passed to setup()')
    if pull_up_down not in _PULL_MODE:
        raise ValueError('Invalid value for pull_up_down - should be either PUD_OFF, PUD_UP or PUD_DOWN')
    if direction == OUT and pull_up_down != PUD_OFF:
        raise ValueError('pull_up_down parameter is not valid for outputs')
    if direction == IN and initial != -1:
        raise ValueError('initial parameter is not valid for inputs')
    for ch in _channels(channel):
        bcm = _bcm(ch)
        if _warn and bcm in _dir:
            warnings.warn('This channel is already in use, continuing anyway.  Use GPIO.setwarnings(False) to disable warnings.', RuntimeWarning, stacklevel=2)
        if direction == OUT:
            _hw.setup(bcm, 4)
            if initial != -1:
                _hw.output(bcm, 1 if initial else 0)
        else:
            _hw.setup(bcm, _PULL_MODE[pull_up_down])
        _dir[bcm] = direction


def output(channel, value):
    chans = _channels(channel)
    values = list(value) if isinstance(value, (list, tuple)) else [value] * len(chans)
    if len(values) != len(chans):
        raise RuntimeError('Number of channels != number of values')
    for ch, v in zip(chans, values):
        bcm = _bcm(ch)
        if _dir.get(bcm) != OUT:
            raise RuntimeError('The GPIO channel has not been set up as an OUTPUT')
        _hw.output(bcm, 1 if v else 0)


def input(channel):
    bcm = _bcm(channel)
    if bcm not in _dir:
        raise RuntimeError('You must setup() the GPIO channel first')
    _rt.yield_point()
    return _hw.read(bcm)


def cleanup(channel=None):
    global _mode
    chans = list(_dir) if channel is None else [_bcm(c) for c in _channels(channel)]
    for bcm in chans:
        if bcm in _detect:
            _detect.pop(bcm).close()
        if bcm in _pwm:
            _pwm[bcm].stop()
        _hw.setup(bcm, 0)
        _dir.pop(bcm, None)
    if channel is None:
        _mode = None


def gpio_function(channel):
    return _dir.get(_bcm(channel), IN)


def _counts(bcm):
    return _hw.rising(bcm) & 0xFFFFFFFF, _hw.falling(bcm) & 0xFFFFFFFF


class _Detect:
    """Edge detection on an input (spec 4.4): the editor's edge counters, polled at yield points."""

    def __init__(self, bcm, channel, edge, bouncetime):
        self.bcm, self.channel, self.edge = bcm, channel, edge
        self.bounce = (bouncetime or 0) / 1000.0
        self.callbacks = []
        self.flag = False
        self.seen = _counts(bcm)
        self.last = None

    def edges(self):
        r, f = _counts(self.bcm)
        n = 0
        if self.edge in (RISING, BOTH):
            n += (r - self.seen[0]) & 0xFFFFFFFF
        if self.edge in (FALLING, BOTH):
            n += (f - self.seen[1]) & 0xFFFFFFFF
        self.seen = (r, f)
        return n

    def poll(self):
        n = self.edges()
        if not n:
            return
        t = _rt.now()
        if self.bounce and self.last is not None and t - self.last < self.bounce:
            return
        self.last = t
        self.flag = True
        for _ in range(n):
            for cb in list(self.callbacks):
                _rt.queue(lambda cb=cb: cb(self.channel))

    def close(self):
        _rt.remove_poller(self.poll)


def add_event_detect(channel, edge, callback=None, bouncetime=None):
    bcm = _bcm(channel)
    if _dir.get(bcm) != IN:
        raise RuntimeError('You must setup() the GPIO channel as an input first')
    if edge not in (RISING, FALLING, BOTH):
        raise ValueError('The edge must be set to RISING, FALLING or BOTH')
    if bcm in _detect:
        raise RuntimeError('Conflicting edge detection already enabled for this GPIO channel')
    d = _detect[bcm] = _Detect(bcm, channel, edge, bouncetime)
    if callback is not None:
        d.callbacks.append(callback)
    _rt.add_poller(d.poll)


def add_event_callback(channel, callback):
    bcm = _bcm(channel)
    if bcm not in _detect:
        raise RuntimeError('Add event detection using add_event_detect first before adding a callback')
    _detect[bcm].callbacks.append(callback)


def remove_event_detect(channel):
    bcm = _bcm(channel)
    if bcm in _detect:
        _detect.pop(bcm).close()


def event_detected(channel):
    d = _detect.get(_bcm(channel))
    if d is None:
        return False
    _rt.yield_point()
    hit, d.flag = d.flag, False
    return hit


def wait_for_edge(channel, edge, bouncetime=None, timeout=None):
    bcm = _bcm(channel)
    if _dir.get(bcm) != IN:
        raise RuntimeError('You must setup() the GPIO channel as an input first')
    if bcm in _detect:
        raise RuntimeError('Conflicting edge detection events already exist for this GPIO channel')
    if edge not in (RISING, FALLING, BOTH):
        raise ValueError('The edge must be set to RISING, FALLING or BOTH')
    d = _Detect(bcm, channel, edge, bouncetime)
    got = _rt.wait(None if timeout is None else timeout / 1000.0, until=lambda: d.edges() > 0)
    return channel if got else None


class PWM:
    """Software PWM as RPi.GPIO 0.7 offers it; here it declares duty and frequency (spec 2.2)."""

    def __init__(self, channel, frequency):
        bcm = _bcm(channel)
        if _dir.get(bcm) != OUT:
            raise RuntimeError('You must setup() the GPIO channel as an output first')
        if bcm in _pwm:
            raise RuntimeError('A PWM object already exists for this GPIO channel')
        if frequency <= 0.0:
            raise ValueError('frequency must be greater than 0.0')
        self._bcm, self._freq, self._dc, self._running = bcm, float(frequency), 0.0, False
        _pwm[bcm] = self

    def _write(self):
        _hw.pwm(self._bcm, self._running, self._dc / 100.0, self._freq)

    @staticmethod
    def _check(dutycycle):
        if not 0.0 <= dutycycle <= 100.0:
            raise ValueError('dutycycle must have a value from 0.0 to 100.0')

    def start(self, dutycycle):
        self._check(dutycycle)
        self._dc, self._running = float(dutycycle), True
        self._write()

    def ChangeDutyCycle(self, dutycycle):
        self._check(dutycycle)
        self._dc = float(dutycycle)
        self._write()

    def ChangeFrequency(self, frequency):
        if frequency <= 0.0:
            raise ValueError('frequency must be greater than 0.0')
        self._freq = float(frequency)
        self._write()

    def stop(self):
        self._running = False
        self._write()
        _pwm.pop(self._bcm, None)
