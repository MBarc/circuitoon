"""Circuitoon's run-time for scripts on a simulated Raspberry Pi (firmware spec 5.2).

One scheduler for every wait (time.sleep, input, gpiozero's pause and wait_for_*, RPi.GPIO's
wait_for_edge and the waits inside our modules): due timers and queued callbacks run at yield points
(the waits and every pin read), never inside a callback, so it is not re-entrant. Time comes from the
run's clock. JS only blocks (circuitoon_hw.block) and reports what woke it.
"""
import builtins
import heapq
import linecache
import sys
import threading
import time
import traceback

import circuitoon_hw as hw

# Modules that need devices or libraries the simulator does not have (spec 5.1). The gate scans
# scripts for the same names: src/run/unsupported.ts reads this dict (one entry per line).
UNSUPPORTED = {
    'smbus': 'smbus needs I2C devices, coming in a later update',
    'smbus2': 'smbus2 needs I2C devices, coming in a later update',
    'spidev': 'spidev needs SPI devices, coming in a later update',
    'serial': 'serial (pyserial) needs a serial port, coming in a later update',
    'pigpio': 'pigpio is not simulated; use gpiozero or RPi.GPIO',
    'lgpio': 'lgpio is not simulated; use gpiozero or RPi.GPIO',
    'picamera2': 'picamera2 needs a camera, which is not simulated',
}
THREADS = "Threads aren't supported in the simulator yet; use gpiozero callbacks or a loop with time.sleep()"
NPINS = 28
# The 40-pin header: BOARD pin number to BCM GPIO number (RPi.GPIO and gpiozero both read it).
BOARD_TO_BCM = {3: 2, 5: 3, 7: 4, 8: 14, 10: 15, 11: 17, 12: 18, 13: 27, 15: 22, 16: 23, 18: 24, 19: 10,
                21: 9, 22: 25, 23: 11, 24: 8, 26: 7, 27: 0, 28: 1, 29: 5, 31: 6, 32: 12, 33: 13, 35: 19,
                36: 16, 37: 26, 38: 20, 40: 21}

_timers = []
_queue = []
_pollers = []
_seq = 0
_in_callback = False
_file = 'main.py'


class Timer:
    """A scheduled call; cancel() stops it; `period` repeats it."""
    __slots__ = ('due', 'seq', 'fn', 'period', 'alive')

    def __init__(self, due, fn, period):
        global _seq
        _seq += 1
        self.due, self.seq, self.fn, self.period, self.alive = due, _seq, fn, period, True

    def __lt__(self, other):
        return (self.due, self.seq) < (other.due, other.seq)

    def cancel(self):
        self.alive = False


def reset():
    """Forgets every timer, queued callback and poller."""
    global _in_callback
    _timers.clear()
    _queue.clear()
    _pollers.clear()
    _in_callback = False


def now():
    """Seconds of run time."""
    return hw.monotonic()


def call_later(delay, fn, period=None):
    timer = Timer(now() + max(0.0, delay), fn, period)
    heapq.heappush(_timers, timer)
    hw.pending(True)
    return timer


def queue(fn):
    """Runs fn at the next yield point, outside any callback."""
    _queue.append(fn)
    hw.pending(True)


def add_poller(fn):
    if fn not in _pollers:
        _pollers.append(fn)
    hw.pending(True)


def remove_poller(fn):
    if fn in _pollers:
        _pollers.remove(fn)


def format_error(e):
    """A traceback listing only the user's own frames (plan ruling R11)."""
    te = traceback.TracebackException.from_exception(e)
    te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename == _file])
    return ''.join(te.format())


def _run(fn):
    global _in_callback
    _in_callback = True
    try:
        fn()
    except Exception as e:  # plan ruling R10: printed, and the script goes on
        sys.stderr.write(format_error(e))
    finally:
        _in_callback = False


def dispatch():
    """Polls for edges, then runs queued callbacks and the timers due now. Inside a callback it does nothing."""
    if _in_callback:
        return
    for poll in list(_pollers):
        _run(poll)
    while _queue:
        _run(_queue.pop(0))
    t = now()
    due = []
    while _timers and (not _timers[0].alive or _timers[0].due <= t):
        timer = heapq.heappop(_timers)
        if timer.alive:
            due.append(timer)
    for timer in due:
        if timer.period is not None:
            # Behind schedule: the next run is now, never a burst of catch-up runs.
            timer.due = max(timer.due + timer.period, t)
            heapq.heappush(_timers, timer)
        if timer.alive:
            _run(timer.fn)
        while _queue:
            _run(_queue.pop(0))


def _pending():
    return bool(_queue or _pollers or any(timer.alive for timer in _timers))


def yield_point():
    """A yield point (every pin read and every wait): timers and callbacks may run here."""
    dispatch()
    hw.yielded(_pending())


def wait(seconds=None, until=None):
    """The one blocking primitive (spec 5.2): runs timers and callbacks until until() is true
    (returns True) or `seconds` have passed (returns False). None waits forever. Inside a callback it
    only waits."""
    end = None if seconds is None else now() + max(0.0, seconds)
    while True:
        yield_point()
        if until is not None and until():
            return True
        t = now()
        if end is not None and t >= end:
            return False
        nxt = end
        if not _in_callback:
            while _timers and not _timers[0].alive:
                heapq.heappop(_timers)
            if _timers and (nxt is None or _timers[0].due < nxt):
                nxt = _timers[0].due
        hw.block(-1.0 if nxt is None else nxt)


def _sleep(seconds):
    if seconds < 0:
        raise ValueError('sleep length must be non-negative')
    wait(seconds)


def _input(prompt=''):
    """input() (spec 5.3, plan ruling R12): the prompt labels the input box; callbacks run while it waits."""
    hw.input_begin(str(prompt))
    wait(until=hw.input_ready)
    return hw.input_take()


def _no_threads(*args, **kwargs):
    raise RuntimeError(THREADS)


class _Unsupported:
    """Refuses modules the simulator does not have, in plain words (spec 5.1)."""

    def find_spec(self, name, path=None, target=None):
        root = name.split('.')[0]
        if root in UNSUPPORTED:
            raise ImportError(UNSUPPORTED[root], name=name)
        return None


def install():
    """Points time, input, signal.pause and threads at the scheduler, and refuses unsupported modules."""
    import _thread
    import signal
    # gpiozero's own examples end with `from signal import pause; pause()`.
    signal.pause = lambda: wait()
    time.sleep = _sleep
    time.time = hw.epoch
    time.monotonic = hw.monotonic
    time.perf_counter = hw.monotonic
    time.time_ns = lambda: int(hw.epoch() * 1e9)
    time.monotonic_ns = lambda: int(hw.monotonic() * 1e9)
    time.perf_counter_ns = time.monotonic_ns
    builtins.input = _input
    threading.Thread.start = _no_threads
    _thread.start_new_thread = _no_threads
    sys.meta_path[:] = [f for f in sys.meta_path if type(f).__name__ != '_Unsupported']
    sys.meta_path.insert(0, _Unsupported())


def shutdown():
    """The end of a run: no timers left, every pin back to unused, so the saved states apply again."""
    reset()
    for bcm in range(NPINS):
        hw.setup(bcm, 0)


def main(source, filename):
    """Runs the user's script. Returns 'done', 'stopped' (Stop: KeyboardInterrupt) or 'error'."""
    global _file
    _file = filename
    reset()
    install()
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    g = {'__name__': '__main__', '__file__': filename, '__builtins__': builtins}
    status = 'done'
    try:
        exec(compile(source, filename, 'exec'), g)
    except KeyboardInterrupt:
        status = 'stopped'
    except SystemExit as e:
        if e.code not in (None, 0):
            status = 'error'
            if not isinstance(e.code, int):
                sys.stderr.write(f'{e.code}\n')
    except BaseException as e:
        sys.stderr.write(format_error(e))
        status = 'error'
    finally:
        shutdown()
    return status
