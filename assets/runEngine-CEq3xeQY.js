import{I as e,L as t,g as n,l as r,o as i}from"./index-DXQDbhey.js";var a={"rpi-4-model-b":`pi4`,"rpi-5":`pi5`,"rpi-zero-2-w":`zero2w`},o=e=>e&&Object.hasOwn(a,e.id)?a[e.id]:null,s=e=>`GPIO${e}`,c={version:`314.0.7`,python:`3.14.2`,source:`https://github.com/pyodide/pyodide/releases/tag/314.0.7`,files:[{name:`pyodide.mjs`,sha256:`6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109`,bytes:17931},{name:`pyodide.asm.mjs`,sha256:`f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635`,bytes:1250344},{name:`pyodide.asm.wasm`,sha256:`cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6`,bytes:9598218},{name:`python_stdlib.zip`,sha256:`fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a`,bytes:2545637},{name:`pyodide-lock.json`,sha256:`5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010`,bytes:119077}]},l=()=>new URL(`/circuitoon/py/${c.version}/`,location.href).href,u=e=>[...new Uint8Array(e)].map(e=>e.toString(16).padStart(2,`0`)).join(``),d=null;function f(e,t=fetch,n=l()){return d??=(async()=>{let r=c.files.reduce((e,t)=>e+t.bytes,0),i=0,a=``;for(let o of c.files){let s=await t(n+o.name);if(!s.ok||!s.body)throw Error(`could not load ${o.name} (HTTP ${s.status})`);let c=[],l=s.body.getReader();for(;;){let{done:t,value:n}=await l.read();if(t)break;c.push(n),i+=n.length,e(Math.min(i,r),r)}let d=new Uint8Array(c.reduce((e,t)=>e+t.length,0)),f=0;for(let e of c)d.set(e,f),f+=e.length;if(u(await crypto.subtle.digest(`SHA-256`,d))!==o.sha256)throw Error(`${o.name} is not the file this version expects; reload the page`);o.name===`pyodide-lock.json`&&(a=new TextDecoder().decode(d))}return{indexURL:n,lock:a}})(),d.catch(()=>d=null),d}function p(t){let n=e(t),r=n?.gpio,i=n?.power?.domains.find(e=>e.name===r?.domain)?.nominal??3.3;return{low:r?.inputLow?.value??.3*i,high:r?.inputHigh?.value??.7*i}}function m(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function h(e){let t=2166136261;for(let n=0;n<e.length;n++)t=Math.imul(t^e.charCodeAt(n),16777619);return t>>>0}var g=class{rows=new Map;since=new Map;warned=new Set;rand;seed;constructor(e){this.seed=e,this.rand=m(h(e))}update(e,t,n,r){let i=this.rows.get(e),a=i?.level??0,o=`value`,s=NaN,c=null;!t||t.kind===`floating`?(o=`floating`,a=this.rand()<.5?0:1,this.since.delete(e),this.warned.has(`f|${e}`)||(this.warned.add(`f|${e}`),c=`floating-read`)):t.kind===`undefined`?(o=`undefined`,this.since.delete(e)):(s=t.value,s>=n.high?a=1:s<=n.low&&(a=0),s>n.low&&s<n.high?this.since.has(e)||this.since.set(e,r):this.since.delete(e));let l={level:a,status:o,volts:s,rising:(i?.rising??0)+(i&&a===1&&i.level===0?1:0),falling:(i?.falling??0)+(i&&a===0&&i.level===1?1:0)};return this.rows.set(e,l),{row:l,finding:c}}check(e){let t=[];for(let[n,r]of this.since)e-r>100&&!this.warned.has(`u|${n}`)&&(this.warned.add(`u|${n}`),t.push(n));return t}get(e){return this.rows.get(e)}reset(){this.rows.clear(),this.since.clear(),this.warned.clear(),this.rand=m(h(this.seed))}},_={unused:0,input:1,pullup:2,pulldown:3,output:4},v={none:0,value:1,floating:2,undefined:3},y={idle:0,waiting:1,ready:2},b={wake:0,interrupt:1,outSeq:2,inSeq:3,solvedThrough:4,codeSeq:5,inputState:6,inputLen:7,pending:8,grant:9},x={clockMs:8,horizonMs:9,lastYieldMs:10,startMs:11},S=32,ee=8,te=128,C=512,w=4,T=320,E=4096,D=4096,O=8192;Object.keys(v);function k(e=new SharedArrayBuffer(O)){return{sab:e,i32:new Int32Array(e),f64:new Float64Array(e),line:new Uint8Array(e,E,D)}}function A(e,t,n){Atomics.add(e.i32,t,1);try{n()}finally{Atomics.add(e.i32,t,1)}}function ne(e,t,n){for(;;){let r=Atomics.load(e.i32,t);if(r&1)continue;let i=n();if(Atomics.compareExchange(e.i32,t,r,r)===r)return i}}function re(e,t){let n=S+t*ee,r=te+t*2,i=e.i32;return{mode:Atomics.load(i,n),latch:+!!Atomics.load(i,n+1),pwmActive:Atomics.load(i,n+2)!==0,duty:e.f64[r],freq:e.f64[r+1],rising:Atomics.load(i,n+3)>>>0,falling:Atomics.load(i,n+4)>>>0,highUs:Atomics.load(i,n+5)>>>0,changedUs:Atomics.load(i,n+6)>>>0}}function ie(e,t,n){let r=C+t*w,i=e.i32;Atomics.store(i,r,n.level),Atomics.store(i,r+1,n.rising|0),Atomics.store(i,r+2,n.falling|0),Atomics.store(i,r+3,v[n.status]),e.f64[T+t]=n.volts}function j(e){return ne(e,b.outSeq,()=>({rows:Array.from({length:28},(t,n)=>re(e,n)),codeSeq:Atomics.load(e.i32,b.codeSeq)}))}function M(e,t,n){A(e,b.inSeq,()=>t.forEach((t,n)=>t&&ie(e,n,t))),Atomics.store(e.i32,b.solvedThrough,n),N(e)}function N(e){Atomics.add(e.i32,b.wake,1),Atomics.notify(e.i32,b.wake)}function P(e){Atomics.store(e.i32,b.interrupt,2),N(e)}function F(e,t){let n=new TextEncoder().encode(t).slice(0,D);e.line.set(n),Atomics.store(e.i32,b.inputLen,n.length),Atomics.store(e.i32,b.inputState,y.ready),N(e)}var I=4.63,L=e=>`${e} has no power: connect 5V and GND`,R=e=>`${e} lost power`,z=(e,t)=>`${e}'s 5V input is at ${Number(t.toFixed(2))} V, below the ${I} V where a real Raspberry Pi warns of under-voltage.`;function B(e,t,n){let r=t.budget.filter(e=>e.kind===`domain`&&e.part===n),i=e=>{let t=r.find(t=>t.id===`${n}.domain.${e}`)?.volts.typical;return t?.kind===`value`?t.value:null},a=e.devices.filter(e=>e.kind===`load`&&e.part===n),o=null,s=a.length>0;for(let e of a){let t=i(e.domain);t!==null&&t>=e.minVolts.value||(s=!1),(t===null?-1/0:t-e.minVolts.value)<(o?o.volts===null?-1/0:o.volts-o.minVolts:1/0)&&(o={domain:e.domain,volts:t,minVolts:e.minVolts.value})}return{powered:s,inputVolts:i(`5V`),lowest:o}}var V=e=>e.inputVolts!==null&&e.inputVolts<4.63,H=1/64,U={[_.input]:`input`,[_.pullup]:`input-pullup`,[_.pulldown]:`input-pulldown`};function W(e,t){let n=Math.round(t/H)*H;return e===null||Math.abs(t-e)>=.015625?n:e}var G=e=>e<=0?`low`:e>=1?`high`:{pwm:e},K=class{history=new Map;duty=new Map;sample(e,t){let{rows:n,codeSeq:r}=j(e),i=Math.round(t*1e3)>>>0,a={},o={};for(let e=0;e<28;e++){let r=n[e],c=s(e);if(r.mode!==_.output){this.history.delete(e),this.duty.delete(e),r.mode!==_.unused&&(o[c]={state:a[c]=U[r.mode],duty:null,freqHz:null});continue}if(r.pwmActive){this.history.delete(e);let t=W(this.duty.get(e)??null,r.duty);this.duty.set(e,t),o[c]={state:a[c]=G(t),duty:r.duty,freqHz:r.freq};continue}let l=r.highUs+(r.latch?Math.max(0,i-r.changedUs|0):0)>>>0,u=this.history.get(e)??[];for(u.push({tMs:t,rising:r.rising,falling:r.falling,highUs:l});u.length>2&&u[1].tMs<=t-100;)u.shift();this.history.set(e,u);let d=u[0].tMs<=t-100?u[0]:null,f=r.latch?`high`:`low`;if(!d){o[c]={state:a[c]=f,duty:null,freqHz:null};continue}let p=t-d.tMs,m=(r.rising-d.rising>>>0)+(r.falling-d.falling>>>0);if(m<100*p/1e3-1e-9){this.duty.delete(e),o[c]={state:a[c]=f,duty:null,freqHz:null};continue}let h=Math.min(1,Math.max(0,(l-d.highUs|0)/1e3/p)),g=W(this.duty.get(e)??null,h);this.duty.set(e,g),o[c]={state:a[c]=G(g),duty:h,freqHz:m/2/(p/1e3)}}return{pins:a,detail:o,seq:r}}reset(){this.history.clear(),this.duty.clear()}},q=[4e-4,.0026],J=[40,330];function ae(t){let n=e(t)?.servo;return n?{pulseMin:n.pulseMin.value,pulseMax:n.pulseMax.value,slewSecPer60:n.slew.value}:null}var Y=(e,t)=>Number(e.toFixed(t));function oe(e,t,n){let r=e/t;if(t<J[0]||t>J[1]||r<q[0]||r>q[1])return{why:`a ${Y(r*1e3,2)} ms pulse at ${Y(t,1)} Hz`};let i=(r-n.pulseMin)/(n.pulseMax-n.pulseMin)*180;return{angle:Math.min(180,Math.max(0,i))}}function se(e,t,n,r){let i=60/r.slewSecPer60*Math.max(0,n)/1e3;return Math.abs(t-e)<=i?t:e+Math.sign(t-e)*i}var ce=e=>`${e}'s code never pauses, so blink() and button callbacks can't run. Add time.sleep() in your loop.`,le=class{entries=new Map;last=``;servoState=new Map;warnedServos=new Set;moving=[];add(e){this.entries.set(e.uid,{b:e,sampler:new K,levels:new g(e.uid),th:p(e.module),detail:{},sampled:new Map}),this.last=``}remove(e){this.entries.delete(e),this.last=``}forgetServoWarnings(){this.warnedServos.clear()}get boards(){return[...this.entries.values()].map(e=>e.b)}sample(e){let t={},n={},r=[];for(let i of this.entries.values()){let a=e(i.b),o=i.sampler.sample(i.b.memory,a);t[i.b.uid]=o.pins,n[i.b.uid]=o.seq,i.detail=o.detail,i.sampled.set(o.seq,o.pins);for(let e of i.levels.check(a))r.push({code:`undefined-level`,severity:`warning`,parts:[i.b.uid],pins:[{part:i.b.uid,pin:e}],key:`undefined-level|${i.b.uid}|${e}`,message:`${i.b.ref} ${e} reads ${i.levels.get(e).volts.toFixed(1)} V, between the low and high thresholds`})}let i=JSON.stringify([t,this.moving]),a=i!==this.last;return this.last=i,{pins:t,seq:n,changed:a,findings:r}}apply(e,t,r,i){let a=[],o={},c=e.status===`ok`&&t!==null;for(let l of this.entries.values()){let u=r[l.b.uid],d=u===void 0?void 0:l.sampled.get(u);if(u!==void 0)for(let e of l.sampled.keys())e<u&&l.sampled.delete(e);if(!c){u!==void 0&&M(l.b.memory,[],u);continue}if(o[l.b.uid]=B(t,e.result,l.b.uid),u===void 0||!d)continue;let f=i(l.b),p=e.result.corners.typical.nets,m=Array.from({length:28},()=>null);j(l.b.memory).rows.forEach((e,r)=>{let i=s(r),o=U[e.mode];if(o===void 0||d[i]!==o)return;let c=t.pinNet[n(l.b.uid,i)],u=l.levels.update(i,c===void 0?void 0:p[c],l.th,f);m[r]=u.row,u.finding===`floating-read`&&a.push({code:`floating-read`,severity:`warning`,parts:[l.b.uid],pins:[{part:l.b.uid,pin:i}],key:`floating-read|${l.b.uid}|${i}`,message:`${l.b.ref} ${i} is read by the code but nothing drives it: it floats, so each read is random. Turn on a pull-up or pull-down in the code, or wire it to a signal.`})}),M(l.b.memory,m,u)}return{findings:a,power:o}}driverOn(e,t){for(let r of this.entries.values())for(let[i,a]of Object.entries(r.detail))if(a.duty!==null&&a.freqHz&&e.pinNet[n(r.b.uid,i)]===t)return a;return null}servos(r,i,a,o){let s={},c=[],l=[];if(!i)return{views:s,moving:c,findings:l};for(let u of r.parts){let d=r.modules[u.module],f=d&&t(d,o),p=ae(f);if(!p)continue;let m=i.pinNet[n(u.uid,e(f).servo.signal)],h=m===void 0?null:this.driverOn(i,m),g=this.servoState.get(u.uid),_=g?.target??null;if(h){let e=oe(h.duty,h.freqHz,p);`angle`in e?_=e.angle:this.warnedServos.has(u.uid)||(this.warnedServos.add(u.uid),l.push({code:`servo-signal`,severity:`warning`,parts:[u.uid],pins:[],key:`servo-signal|${u.uid}`,message:`${u.designator}'s signal is ${e.why}, which a servo does not follow (0.4 to 2.6 ms pulses at 40 to 330 Hz): it holds its last angle.`}))}if(_===null)continue;let v=g?se(g.angle,_,a-g.t,p):_;this.servoState.set(u.uid,{angle:v,target:_,t:a});let y={angle:v,target:_,moving:Math.abs(v-_)>1e-6};s[u.uid]=y,y.moving&&c.push(u.uid)}return this.moving=c,{views:s,moving:c,findings:l}}},X=Date.UTC(2026,0,1),ue=class{memory;status=`starting`;done;o;worker=null;ended;stopping=null;constructor(e){this.o=e,this.memory=k(),this.done=new Promise(e=>this.ended=e)}start(){this.memory.f64[x.startMs]=this.o.mode===`virtual`?X:performance.timeOrigin+performance.now();let e=this.worker=this.o.spawn();e.onMessage(e=>{e.type===`ready`&&(this.status=`running`),e.type===`exit`&&this.finish(e.status),e.type===`fatal`&&this.finish(`error`),this.o.on(e)}),e.onError(e=>{(this.status===`starting`||this.status===`running`)&&(this.o.on({type:`fatal`,error:e}),this.finish(`error`))}),e.post({type:`start`,sab:this.memory.sab,files:this.o.files,source:this.o.source,file:this.o.file,board:this.o.board,mode:this.o.mode,py:this.o.py})}finish(e){(this.status===`starting`||this.status===`running`)&&(this.status=e),this.worker?.terminate(),this.ended()}async stop(){if(this.stopping)return this.stopping;let e=this.worker;return e?this.status!==`starting`&&this.status!==`running`?(e.terminate(),`ended`):(this.stopping=(async()=>{P(this.memory);let t=await Promise.race([this.done.then(()=>`stopped`),new Promise(e=>setTimeout(()=>e(`terminated`),this.o.stopGraceMs??1e3))]);return e.terminate(),t===`terminated`&&this.finish(`stopped`),t})(),this.stopping):`ended`}},de=Object.fromEntries(Object.entries(Object.assign({"./py/RPi/GPIO.py":`"""RPi.GPIO for Circuitoon's simulated Raspberry Pi (firmware spec 5.1).

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
    sys.stderr.write('RPi.GPIO does not work on a real Pi 5; use gpiozero, or install rpi-lgpio\\n')

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
`,"./py/RPi/__init__.py":`"""RPi: Circuitoon's stand-in package (see GPIO.py)."""
`,"./py/_circuitoon.py":`"""Circuitoon's run-time for scripts on a simulated Raspberry Pi (firmware spec 5.2).

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
    """A scheduled call; cancel() stops it; \`period\` repeats it."""
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
    (returns True) or \`seconds\` have passed (returns False). None waits forever. Inside a callback it
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
    # gpiozero's own examples end with \`from signal import pause; pause()\`.
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
                sys.stderr.write(f'{e.code}\\n')
    except BaseException as e:
        sys.stderr.write(format_error(e))
        status = 'error'
    finally:
        shutdown()
    return status
`,"./py/gpiozero/__init__.py":`"""gpiozero for Circuitoon's simulated Raspberry Pi (firmware spec 5.1).

A subset with gpiozero's names and signatures. Callbacks, blink and pulse run from Circuitoon's
scheduler (_circuitoon) at yield points: they are not threads, so a callback that sleeps holds
everything else until it returns (About the simulator says so). Input devices are not smoothed.
"""
import inspect

import _circuitoon as _rt
import circuitoon_hw as _hw
from _circuitoon import BOARD_TO_BCM as _BOARD_TO_BCM

# \`from gpiozero import *\` takes exactly these.
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
        super().__init__()
        self._pwm = pwm
        self._seq = None
        self._leds = []
        try:
            for p in (red, green, blue):
                self._leds.append(cls(p, active_high=active_high))
            self._write(initial_value)
        except BaseException:
            for led in self._leds:
                led.close()
            raise

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
`})).map(([e,t])=>[e.slice(5),t])),fe=()=>{let e=new Worker(new URL(`/circuitoon/assets/codeWorker-DS3yjZJg.js`,``+import.meta.url),{type:`module`});return{post:t=>e.postMessage(t),onMessage:t=>e.addEventListener(`message`,e=>t(e.data)),onError:t=>e.addEventListener(`error`,e=>t(e.message||`the code worker failed`)),terminate:()=>e.terminate()}},Z=()=>performance.timeOrigin+performance.now(),pe=e=>e instanceof Error?e.message:String(e),Q=16,me=2e3,he=class{store;deps;runs=new Map;core=new le;batch=new Map;timer=null;lastSample=0;inFlight=!1;seenSim=null;seenParts=null;unsubscribe;disposed=!1;constructor(e,t={}){this.store=e,this.deps=t,this.unsubscribe=e.subscribe(()=>this.follow())}ref(e){return this.store.getState().diagram.parts.find(t=>t.uid===e)?.designator??e}nextSolve(){let{sim:e,simulate:t}=this.store.getState();return t?e?.phase===`done`&&!this.inFlight?Promise.resolve(e):new Promise(e=>{let t=this.store.subscribe(()=>{let n=this.store.getState();if(!n.simulate)return t(),e(null);n.sim?.phase===`done`&&(t(),e(n.sim))})}):Promise.resolve(null)}stillStarting(e,t){let n=this.store.getState();return this.disposed||n.run.boards[e]?.status!==`starting`?!1:n.diagram.parts.some(n=>n.uid===e&&n.module===t)?!0:(this.store.setBoardRun(e,{status:`stopped`,progress:null}),!1)}async run(e){if(this.disposed)return;let n=this.store.getState(),a=this.deps.isolated?{isolated:this.deps.isolated(),serviceWorkers:!0}:void 0,s=i(n,e,a),c=n.diagram.parts.find(t=>t.uid===e);if(s||!c?.code||this.runs.has(e)||n.run.boards[e]?.status===`starting`){s&&this.store.setBoardRun(e,{status:`idle`,message:s});return}let l=c.code,u=t(n.diagram.modules[c.module],r);this.store.setSimulate(!0),this.store.setBoardRun(e,{status:`starting`,source:l.source,file:l.file??`main.py`,serial:[],prompt:null,progress:null,message:null}),this.store.setDock({open:!0,tab:e});let d=!this.runs.size;d&&this.core.forgetServoWarnings();let p=this.store.getState().run.findings,m=p.filter(t=>!t.parts.includes(e)&&!(d&&t.code===`servo-signal`));m.length!==p.length&&this.store.setRun({findings:m});let h;try{h=await(this.deps.prefetch??f)((t,n)=>this.store.setBoardRun(e,{progress:{loaded:t,total:n}}))}catch(t){this.stillStarting(e,c.module)&&this.store.setBoardRun(e,{status:`error`,progress:null,message:`Python could not load: ${pe(t)}`});return}if(!this.stillStarting(e,c.module))return;let g=await this.nextSolve();if(!this.stillStarting(e,c.module))return;if(!g)return void this.store.setBoardRun(e,{status:`stopped`,progress:null});if(!(g?.outcome.status===`ok`&&g.circuit&&B(g.circuit,g.outcome.result,e).powered)){this.store.setBoardRun(e,{status:`idle`,progress:null,message:L(c.designator)});return}this.store.setBoardRun(e,{progress:null});let _=new ue({board:o(u),source:l.source,file:l.file??`main.py`,mode:`real`,py:h,files:de,spawn:this.deps.spawn??fe,on:t=>this.onMessage(e,t)});this.runs.set(e,{run:_,module:c.module,ref:c.designator,noted:new Set}),this.core.add({uid:e,ref:c.designator,memory:_.memory,module:u}),_.start(),this.schedule()}onMessage(e,t){t.type===`ready`?this.store.setBoardRun(e,{status:`running`}):t.type===`out`?this.serial(e,t.text,t.stream):t.type===`prompt`?this.store.setBoardRun(e,{prompt:t.text}):t.type===`exit`?this.finish(e,t.status):t.type===`fatal`&&(this.serial(e,`${t.error}\n`,`err`),this.finish(e,`error`))}serial(e,t,n){let r=t.replace(/\n$/,``).split(`
`).map(e=>({text:e,stream:n}));this.batch.set(e,[...this.batch.get(e)??[],...r])}flush(){for(let[e,t]of this.batch)this.store.appendSerial(e,t);this.batch.clear()}finish(e,t){if(!this.runs.has(e))return;this.runs.delete(e),this.core.remove(e),this.flush();let n=this.store.getState().run,{[e]:r,...i}=n.pins,{[e]:a,...o}=n.seq;(e in n.pins||e in n.seq)&&this.store.setRun({pins:i,seq:o}),!this.runs.size&&(n.moving.length||Object.keys(n.servos).length)&&this.store.setRun({moving:[],servos:{}}),n.boards[e]&&this.store.setBoardRun(e,{status:t,prompt:null})}stopping=new Set;async stop(e){let t=this.runs.get(e);if(!t){this.store.getState().run.boards[e]?.status===`starting`&&this.store.setBoardRun(e,{status:`stopped`,progress:null});return}if(!this.stopping.has(e)){this.stopping.add(e);try{await t.run.stop()!==`stopped`&&this.finish(e,`stopped`)}finally{this.stopping.delete(e)}}}async reset(e){await this.stop(e),await this.run(e)}sendLine(e,t){let n=this.runs.get(e),r=this.store.getState().run.boards[e]?.prompt;n&&r!=null&&(this.flush(),this.store.appendSerial(e,[{text:`${r}${t}`,stream:`echo`}]),this.store.setBoardRun(e,{prompt:null}),F(n.run.memory,t))}async runAll(){for(let e of this.store.getState().diagram.parts)e.code&&!this.runs.has(e.uid)&&await this.run(e.uid)}async stopAll(){await Promise.all([...this.runs.keys()].map(e=>this.stop(e)))}at=e=>Z()-e.memory.f64[x.startMs];schedule(){if(this.timer||!this.runs.size)return;let e=Math.max(0,Q-(performance.now()-this.lastSample));this.timer=setTimeout(()=>{this.timer=null,this.sample()},e)}sample(){if(!this.runs.size||this.inFlight)return;this.lastSample=performance.now();let e=this.store.getState(),t=this.core.servos(e.diagram,e.sim?.phase===`done`?e.sim.circuit:null,performance.now(),r),n=this.core.sample(this.at);this.addFindings([...n.findings,...t.findings]);for(let[e,t]of this.runs){let n=t.run.memory;Atomics.load(n.i32,b.pending)&&Z()-n.f64[x.lastYieldMs]>me&&!t.noted.has(`pauses`)&&(t.noted.add(`pauses`),this.serial(e,ce(t.ref),`note`))}this.flush();let i={};n.changed&&JSON.stringify(n.pins)!==JSON.stringify(e.run.pins)&&(i.pins=n.pins),JSON.stringify(n.seq)!==JSON.stringify(e.run.seq)&&(i.seq=n.seq),JSON.stringify(t.moving)!==JSON.stringify(e.run.moving)&&(i.moving=t.moving),this.inFlight=Object.keys(i).length>0,JSON.stringify(t.views)!==JSON.stringify(e.run.servos)&&(i.servos=t.views),Object.keys(i).length&&this.store.setRun(i),this.schedule()}addFindings(e){if(!e.length)return;let t=new Set(this.store.getState().run.findings.map(e=>e.key)),n=e.filter(e=>!t.has(e.key));n.length&&this.store.setRun({findings:[...this.store.getState().run.findings,...n]})}follow(){let e=this.store.getState();if(!e.simulate&&this.runs.size)return void this.stopAll();if(e.diagram.parts!==this.seenParts){this.seenParts=e.diagram.parts;for(let[t,n]of this.runs){let r=e.diagram.parts.find(e=>e.uid===t);(!r||r.module!==n.module)&&this.stop(t)}}for(let t of this.runs.keys())e.run.boards[t]||this.stop(t);if(e.sim!==this.seenSim&&e.sim?.phase===`done`){this.seenSim=e.sim,this.inFlight=!1;let t=this.core.apply(e.sim.outcome,e.sim.circuit,e.sim.runSeq??{},this.at);this.addFindings(t.findings);for(let[e,n]of this.runs){let r=t.power[e];r&&(r.powered?V(r)&&!n.noted.has(`volts`)&&(n.noted.add(`volts`),this.serial(e,z(n.ref,r.inputVolts),`note`)):(n.noted.has(`power`)||(n.noted.add(`power`),this.serial(e,R(n.ref),`note`),this.flush()),this.stop(e)))}performance.now()-this.lastSample>=Q?this.sample():this.schedule()}}dispose(){this.disposed=!0;for(let[e,t]of Object.entries(this.store.getState().run.boards))t.status===`starting`&&this.store.setBoardRun(e,{status:`stopped`,progress:null});this.stopAll(),this.unsubscribe(),this.timer&&clearTimeout(this.timer),$.get(this.store)===this&&$.delete(this.store)}},$=new WeakMap;function ge(e,t){let n=$.get(e);return n||$.set(e,n=new he(e,t)),n}export{ge as controllerFor};