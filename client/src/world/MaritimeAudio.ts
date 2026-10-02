import type { BoatSimulationState } from "@naval/shared";
import { GULL_CALL_VARIANTS, GullCallScheduler, fillSynthesizedGullCall, sampleSeabirdSpatial } from "./seabirdAudio";
import type { AudioVector3, BirdAudioSnapshot, SeabirdSpatialSample } from "./seabirdAudio";

export type SoundStatus = "off" | "on" | "muted" | "blocked" | "unavailable";

interface GullVoice {
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  readonly panner: PannerNode;
  source?: AudioBufferSourceNode;
  birdId: number;
  basePlaybackRate: number;
}

/** Small procedural soundscape. Audio resources are created only after a user gesture. */
export class MaritimeAudio {
  status: SoundStatus = "off";
  shipControlsEnabled = true;
  private context?: AudioContext;
  private master?: GainNode;
  private seaGain?: GainNode;
  private engineGain?: GainNode;
  private engineTone?: OscillatorNode;
  private engineHarmonic?: OscillatorNode;
  private readonly sources: (AudioBufferSourceNode | OscillatorNode)[] = [];
  private readonly calls = new Set<OscillatorNode>();
  private readonly gunshots = new Set<AudioBufferSourceNode>();
  // Fetch early so the first spacebar discharge can play without network delay.
  private readonly gunshotData = fetch(`${import.meta.env.BASE_URL}audio/mk45-dewey-report.wav`)
    .then(response => response.ok ? response.arrayBuffer() : undefined)
    .catch(() => undefined);
  private gunshotBuffer?: AudioBuffer;
  private gunshotReady?: Promise<void>;
  private readonly gullData = fetch(`${import.meta.env.BASE_URL}audio/herring-gull-flight-calls.wav`)
    .then(response => response.ok ? response.arrayBuffer() : undefined)
    .catch(() => undefined);
  private gullBuffer?: AudioBuffer;
  private gullReady?: Promise<void>;
  private readonly gullVoices: GullVoice[] = [];
  private readonly gullScheduler = new GullCallScheduler();
  private readonly listenerPosition = { x: 0, y: 0, z: 0 };
  private readonly listenerForward = { x: 0, y: 0, z: 1 };
  private readonly listenerVelocity = { x: 0, y: 0, z: 0 };
  private readonly gullSpatial: SeabirdSpatialSample = { distance: 0, gain: 0, pan: 0, doppler: 1 };
  private previousListenerTime = -1;
  private previousListenerX = 0;
  private previousListenerY = 0;
  private previousListenerZ = 0;
  private volume = .75;
  private enabled = false;
  private activationVersion = 0;
  private turbineGain?: GainNode;
  private turbineTone?: OscillatorNode;
  private propellerGain?: GainNode;
  private hornUntil = 0;
  private disposed = false;

  constructor() {
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pointerdown", this.onFirstInteraction);
    window.addEventListener("keydown", this.onKeyDown);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return;
    this.enabled = enabled;
    const version = ++this.activationVersion;
    try {
      if (!this.context && enabled) this.initialize();
      if (this.context && enabled) await this.context.resume();
      if (this.disposed || version !== this.activationVersion) return;
      this.status = enabled ? (this.context?.state === "running" ? "on" : "blocked") : "muted";
      this.applyVolume();
    } catch {
      this.status = "unavailable";
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  update(state: BoatSimulationState, birds: readonly BirdAudioSnapshot[], listenerPosition?: AudioVector3, listenerForward?: AudioVector3): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.status !== "on") return;
    const clock = context.currentTime;
    const speed = Math.min(1, state.speed / 15.95);
    const throttle = Math.abs(state.throttle);
    const wash = .38 + .10 * Math.sin(state.elapsedTime * .35) + speed * .40;
    this.seaGain?.gain.setTargetAtTime(wash, clock, .3);
    this.engineGain?.gain.setTargetAtTime(.075 + throttle * .10 + speed * .04, clock, .12);
    this.engineTone?.frequency.setTargetAtTime(62 + throttle * 32 + speed * 12, clock, .18);
    this.engineHarmonic?.frequency.setTargetAtTime(124 + throttle * 64 + speed * 24, clock, .18);
    this.turbineGain?.gain.setTargetAtTime(.025 + throttle * .065, clock, .8);
    this.turbineTone?.frequency.setTargetAtTime(380 + throttle * 520, clock, 1.2);
    this.propellerGain?.gain.setTargetAtTime(.02 + throttle * .17 + speed * .15, clock, .7);
    this.updateSeabirds(state, birds, clock, listenerPosition, listenerForward);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pointerdown", this.onFirstInteraction);
    window.removeEventListener("keydown", this.onKeyDown);
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    for (const call of this.calls) { call.onended = null; call.stop(); call.disconnect(); }
    this.calls.clear();
    for (const shot of this.gunshots) { shot.stop(); shot.disconnect(); }
    this.gunshots.clear();
    for (const voice of this.gullVoices) {
      if (voice.source) { voice.source.onended = null; voice.source.stop(); voice.source.disconnect(); }
      voice.gain.disconnect(); voice.filter.disconnect(); voice.panner.disconnect();
      voice.source = undefined;
    }
    this.gullVoices.length = 0;
    this.gullBuffer = undefined;
    if (this.context) this.context.onstatechange = null;
    void this.context?.close().catch(() => undefined);
  }

  private initialize(): void {
    const context = new AudioContext();
    this.context = context;
    this.gunshotReady = this.gunshotData.then(async data => {
      if (!data || this.disposed) return;
      try { this.gunshotBuffer = await context.decodeAudioData(data); }
      catch { /* Procedural report remains available if decoding fails. */ }
    });
    context.onstatechange = () => {
      if (this.disposed || !this.enabled) return;
      this.status = context.state === "running" ? "on" : "blocked";
      this.applyVolume();
    };
    this.master = context.createGain();
    this.master.gain.value = 0;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 5;
    this.master.connect(limiter).connect(context.destination);
    this.initializeSeabirds(context);

    // Six seconds of decorrelated filtered noise, generated once and looped.
    const noise = context.createBuffer(2, context.sampleRate * 6, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = noise.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const white = Math.random() * 2 - 1;
        low = low * .97 + white * .03;
        samples[i] = low * 2.8 + white * .09;
      }
    }
    const sea = context.createBufferSource();
    sea.buffer = noise;
    sea.loop = true;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1900;
    this.seaGain = context.createGain();
    this.seaGain.gain.value = .38;
    sea.connect(lowpass).connect(this.seaGain).connect(this.master);
    sea.start();
    this.sources.push(sea);

    const wind = context.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    wind.playbackRate.value = .65;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 430;
    windFilter.Q.value = .5;
    const windGain = context.createGain();
    windGain.gain.value = .28;
    wind.connect(windFilter).connect(windGain).connect(this.master);
    wind.start(0, 2.1);
    this.sources.push(wind);

    const motorFilter = context.createBiquadFilter();
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = 700;
    this.engineGain = context.createGain();
    this.engineGain.gain.value = .075;
    motorFilter.connect(this.engineGain).connect(this.master);
    this.engineTone = context.createOscillator();
    this.engineTone.type = "sawtooth";
    this.engineTone.frequency.value = 62;
    this.engineTone.connect(motorFilter);
    this.engineHarmonic = context.createOscillator();
    this.engineHarmonic.type = "sine";
    this.engineHarmonic.frequency.value = 124;
    this.engineHarmonic.connect(motorFilter);
    this.engineTone.start();
    this.engineHarmonic.start();
    this.sources.push(this.engineTone, this.engineHarmonic);
    this.turbineGain = context.createGain();
    this.turbineGain.gain.value = .025;
    this.turbineGain.connect(this.master);
    this.turbineTone = context.createOscillator();
    this.turbineTone.type = "sine";
    this.turbineTone.frequency.value = 380;
    this.turbineTone.connect(this.turbineGain);
    this.turbineTone.start();
    this.sources.push(this.turbineTone);
    const propeller = context.createBufferSource();
    propeller.buffer = noise;
    propeller.loop = true;
    const propellerFilter = context.createBiquadFilter();
    propellerFilter.type = "lowpass";
    propellerFilter.frequency.value = 650;
    this.propellerGain = context.createGain();
    this.propellerGain.gain.value = .02;
    propeller.connect(propellerFilter).connect(this.propellerGain).connect(this.master);
    propeller.start(0, 1.3);
    this.sources.push(propeller);
  }

  private initializeSeabirds(context: AudioContext): void {
    for (let index = 0; index < 2; index++) {
      const gain = context.createGain(), filter = context.createBiquadFilter(), panner = context.createPanner();
      gain.gain.value = 0;
      filter.type = "lowpass";
      filter.frequency.value = 9000;
      panner.panningModel = "HRTF";
      // Distance is smoothed explicitly so unseen/far birds become truly silent.
      panner.rolloffFactor = 0;
      filter.connect(gain).connect(panner).connect(this.master!);
      this.gullVoices.push({ gain, filter, panner, birdId: -1, basePlaybackRate: 1 });
    }
    this.gullReady = this.gullData.then(async data => {
      if (this.disposed) return;
      if (data) {
        try {
          const decoded = await context.decodeAudioData(data);
          if (!this.disposed) this.gullBuffer = decoded;
        }
        catch { /* Keep a cached, richer flight-call fallback for unavailable assets. */ }
      }
      if (!this.gullBuffer && !this.disposed) {
        const duration = GULL_CALL_VARIANTS.reduce((sum, call) => sum + call.duration, 0);
        const buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let index = 0; index < GULL_CALL_VARIANTS.length; index++) {
          const call = GULL_CALL_VARIANTS[index];
          fillSynthesizedGullCall(samples.subarray(Math.round(call.offset * context.sampleRate),
            Math.round((call.offset + call.duration) * context.sampleRate)), context.sampleRate, index);
        }
        this.gullBuffer = buffer;
      }
    });
  }

  private updateSeabirds(state: BoatSimulationState, birds: readonly BirdAudioSnapshot[], clock: number,
    position?: AudioVector3, forward?: AudioVector3): void {
    const context = this.context!;
    const listener = this.listenerPosition;
    listener.x = position?.x ?? state.positionX;
    listener.y = position?.y ?? state.positionY + 12;
    listener.z = position?.z ?? state.positionZ;
    this.listenerForward.x = forward?.x ?? Math.sin(state.heading);
    this.listenerForward.y = forward?.y ?? 0;
    this.listenerForward.z = forward?.z ?? Math.cos(state.heading);
    const dt = clock - this.previousListenerTime;
    const velocity = this.listenerVelocity;
    velocity.x = velocity.y = velocity.z = 0;
    if (this.previousListenerTime >= 0 && dt > .0001 && dt < .5) {
      velocity.x = (listener.x - this.previousListenerX) / dt;
      velocity.y = (listener.y - this.previousListenerY) / dt;
      velocity.z = (listener.z - this.previousListenerZ) / dt;
      // Camera mode changes are teleports, not physical Doppler velocities.
      if (Math.hypot(velocity.x, velocity.y, velocity.z) > 100) velocity.x = velocity.y = velocity.z = 0;
    }
    this.previousListenerTime = clock;
    this.previousListenerX = listener.x; this.previousListenerY = listener.y; this.previousListenerZ = listener.z;
    const audioListener = context.listener;
    // Babylon's scene is left-handed. Mirroring Z preserves correct headphone sides.
    if (audioListener.positionX) {
      audioListener.positionX.setTargetAtTime(listener.x, clock, .025);
      audioListener.positionY.setTargetAtTime(listener.y, clock, .025);
      audioListener.positionZ.setTargetAtTime(-listener.z, clock, .025);
      audioListener.forwardX.setTargetAtTime(this.listenerForward.x, clock, .025);
      audioListener.forwardY.setTargetAtTime(this.listenerForward.y, clock, .025);
      audioListener.forwardZ.setTargetAtTime(-this.listenerForward.z, clock, .025);
      audioListener.upX.setTargetAtTime(0, clock, .025);
      audioListener.upY.setTargetAtTime(1, clock, .025);
      audioListener.upZ.setTargetAtTime(0, clock, .025);
    } else {
      audioListener.setPosition(listener.x, listener.y, -listener.z);
      audioListener.setOrientation(this.listenerForward.x, this.listenerForward.y, -this.listenerForward.z, 0, 1, 0);
    }
    for (const voice of this.gullVoices) {
      if (!voice.source) continue;
      let bird: BirdAudioSnapshot | undefined;
      for (let index = 0; index < birds.length; index++) {
        if (birds[index].id === voice.birdId) { bird = birds[index]; break; }
      }
      if (bird) this.positionGullVoice(voice, bird, clock);
      else voice.gain.gain.setTargetAtTime(0, clock, .04);
    }
    if (!this.gullReady || !this.gullBuffer || document.hidden || this.volume <= 0) return;
    let available: GullVoice | undefined;
    for (const voice of this.gullVoices) if (!voice.source) { available = voice; break; }
    if (!available) return;
    const bird = this.gullScheduler.select(birds, listener, clock,
      this.gullVoices[0].source ? this.gullVoices[0].birdId : -1,
      this.gullVoices[1].source ? this.gullVoices[1].birdId : -1);
    if (!bird) return;
    const sequence = this.gullScheduler.started(bird.id, clock);
    const call = GULL_CALL_VARIANTS[(sequence + bird.id) % GULL_CALL_VARIANTS.length];
    const source = context.createBufferSource();
    source.buffer = this.gullBuffer;
    available.birdId = bird.id;
    available.basePlaybackRate = .96 + ((bird.id * 7 + sequence * 11) % 9) * .01;
    available.source = source;
    source.connect(available.filter);
    this.positionGullVoice(available, bird, clock);
    source.onended = () => {
      source.disconnect();
      if (available.source === source) { available.source = undefined; available.birdId = -1; }
    };
    source.start(clock, call.offset, call.duration);
  }

  private positionGullVoice(voice: GullVoice, bird: BirdAudioSnapshot, clock: number): void {
    const sample = sampleSeabirdSpatial(bird, this.listenerPosition, this.listenerForward, this.listenerVelocity, this.gullSpatial);
    voice.gain.gain.setTargetAtTime(sample.gain * .45, clock, .04);
    if (!Number.isFinite(sample.distance)) return;
    voice.filter.frequency.setTargetAtTime(9000 - Math.min(1, sample.distance / 220) * 4700, clock, .08);
    voice.source?.playbackRate.setTargetAtTime(voice.basePlaybackRate * sample.doppler, clock, .035);
    if (voice.panner.positionX) {
      voice.panner.positionX.setTargetAtTime(bird.x, clock, .025);
      voice.panner.positionY.setTargetAtTime(bird.y, clock, .025);
      voice.panner.positionZ.setTargetAtTime(-bird.z, clock, .025);
    } else voice.panner.setPosition(bird.x, bird.y, -bird.z);
  }

  /** A short two-tone ship whistle; also useful for checking the speaker mix. */
  soundHorn(): void {
    const context = this.context;
    if (!context || !this.master || this.status !== "on" || context.currentTime < this.hornUntil) return;
    const start = context.currentTime;
    this.hornUntil = start + 2.6;
    for (const frequency of [145, 193]) {
      const tone = context.createOscillator();
      tone.type = "sawtooth";
      tone.frequency.value = frequency;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 800;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.16, start + .18);
      gain.gain.setValueAtTime(.16, start + 1.8);
      gain.gain.linearRampToValueAtTime(0, start + 2.5);
      tone.connect(filter).connect(gain).connect(this.master);
      this.calls.add(tone);
      tone.onended = () => { tone.disconnect(); filter.disconnect(); gain.disconnect(); this.calls.delete(tone); };
      tone.start(); tone.stop(start + 2.6);
    }
  }

  /** Recorded Mk 45 report: bore crack, pressure blast and its natural decay. */
  soundGunfire(): void {
    if (this.disposed || this.status === "muted" || this.status === "unavailable") return;
    if (this.status === "off" || this.status === "blocked") {
      void this.setEnabled(true).then(() => {
        if (this.status === "on") this.soundGunfire();
      });
      return;
    }
    void this.gunshotReady?.then(() => {
      const context = this.context;
      if (this.disposed || !context || context.state !== "running" ||
        !this.master || this.status !== "on") return;
      if (!this.gunshotBuffer) {
        this.soundSynthesizedGunfire();
        return;
      }
      const shot = context.createBufferSource();
      shot.buffer = this.gunshotBuffer;
      const gain = context.createGain();
      gain.gain.value = 1.25;
      shot.connect(gain).connect(this.master);
      this.gunshots.add(shot);
      shot.onended = () => {
        shot.disconnect();
        gain.disconnect();
        this.gunshots.delete(shot);
      };
      shot.start();
    });
  }

  /** Procedural ignition thump and receding rocket roar for the VLS sea trial. */
  soundMissileLaunch(): void {
    if (this.disposed || this.status === "muted" || this.status === "unavailable") return;
    if (this.status === "off" || this.status === "blocked") {
      void this.setEnabled(true).then(() => {
        if (this.status === "on") this.soundMissileLaunch();
      });
      return;
    }
    const context = this.context;
    if (!context || !this.master || context.state !== "running") return;
    const duration = 3.3, start = context.currentTime;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    let low = 0;
    for (let index = 0; index < samples.length; index++) {
      const time = index / context.sampleRate;
      const noise = Math.random() * 2 - 1;
      low = low * .94 + noise * .06;
      const thump = Math.sin(time * Math.PI * 2 * (62 - Math.min(1, time) * 28)) * Math.exp(-time * 5);
      const flutter = .84 + .16 * Math.sin(time * 91);
      samples[index] = (noise * .27 + low * 1.7) * flutter + thump * .28;
    }
    const roar = context.createBufferSource();
    roar.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(750, start);
    filter.frequency.exponentialRampToValueAtTime(2_600, start + .18);
    filter.frequency.exponentialRampToValueAtTime(260, start + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(.001, start);
    gain.gain.exponentialRampToValueAtTime(1.1, start + .055);
    gain.gain.exponentialRampToValueAtTime(.55, start + .7);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    roar.connect(filter).connect(gain).connect(this.master);
    this.gunshots.add(roar);
    roar.onended = () => { roar.disconnect(); filter.disconnect(); gain.disconnect(); this.gunshots.delete(roar); };
    roar.start(start);
  }

  private soundSynthesizedGunfire(): void {
    const context = this.context;
    if (!context || !this.master || this.status !== "on") return;

    const start = context.currentTime;
    const duration = .9;
    const noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const time = i / context.sampleRate;
      const crack = Math.exp(-time * 42);
      const rumble = Math.exp(-time * 3.5);
      samples[i] = (Math.random() * 2 - 1) * Math.max(crack * .8, rumble * .48);
    }

    const crack = context.createBufferSource();
    crack.buffer = noiseBuffer;
    const crackFilter = context.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.setValueAtTime(500, start);
    crackFilter.frequency.exponentialRampToValueAtTime(2_800, start + .035);
    const crackGain = context.createGain();
    crackGain.gain.setValueAtTime(2.1, start);
    crackGain.gain.exponentialRampToValueAtTime(.0001, start + .14);
    crack.connect(crackFilter).connect(crackGain).connect(this.master);
    crack.onended = () => { crack.disconnect(); crackFilter.disconnect(); crackGain.disconnect(); };
    crack.start(start);
    crack.stop(start + .15);

    const blast = context.createBufferSource();
    blast.buffer = noiseBuffer;
    const blastFilter = context.createBiquadFilter();
    blastFilter.type = "lowpass";
    blastFilter.frequency.setValueAtTime(1_400, start);
    blastFilter.frequency.exponentialRampToValueAtTime(130, start + .82);
    const blastGain = context.createGain();
    blastGain.gain.setValueAtTime(1.15, start);
    blastGain.gain.exponentialRampToValueAtTime(.0001, start + .88);
    blast.connect(blastFilter).connect(blastGain).connect(this.master);
    blast.onended = () => { blast.disconnect(); blastFilter.disconnect(); blastGain.disconnect(); };
    blast.start(start);
    blast.stop(start + duration);

    const thump = context.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(78, start);
    thump.frequency.exponentialRampToValueAtTime(27, start + .72);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(.92, start);
    thumpGain.gain.exponentialRampToValueAtTime(.0001, start + .76);
    thump.connect(thumpGain).connect(this.master);
    this.calls.add(thump);
    thump.onended = () => { thump.disconnect(); thumpGain.disconnect(); this.calls.delete(thump); };
    thump.start(start);
    thump.stop(start + .78);

    const echo = context.createBufferSource();
    echo.buffer = noiseBuffer;
    const echoFilter = context.createBiquadFilter();
    echoFilter.type = "lowpass";
    echoFilter.frequency.setValueAtTime(720, start + .18);
    echoFilter.frequency.exponentialRampToValueAtTime(170, start + 1.15);
    const echoGain = context.createGain();
    echoGain.gain.setValueAtTime(.54, start + .18);
    echoGain.gain.exponentialRampToValueAtTime(.0001, start + 1.18);
    const echoPan = context.createStereoPanner();
    echoPan.pan.value = .12;
    echo.connect(echoFilter).connect(echoGain).connect(echoPan).connect(this.master);
    echo.onended = () => { echo.disconnect(); echoFilter.disconnect(); echoGain.disconnect(); echoPan.disconnect(); };
    echo.start(start + .18);
    echo.stop(start + 1.2);
  }

  private readonly onFirstInteraction = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest("button, input, select")) return;
    if (this.status === "off" || this.status === "blocked") void this.setEnabled(true);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof Element && event.target.closest("input, select, textarea, button, [contenteditable]")) return;
    if (!["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright", "h", "r", "t"].includes(event.key.toLowerCase())) return;
    this.onFirstInteraction(event);
    if (this.shipControlsEnabled && event.key.toLowerCase() === "h" && !event.repeat) {
      if (this.enabled) void this.setEnabled(true).then(() => this.soundHorn());
    }
  };

  private applyVolume(): void {
    if (!this.context || !this.master) return;
    const level = this.status === "on" && !document.hidden ? this.volume : 0;
    this.master.gain.setTargetAtTime(level, this.context.currentTime, .12);
  }

  private readonly onVisibilityChange = (): void => {
    this.applyVolume();
    if (document.hidden) void this.context?.suspend().catch(() => undefined);
    else if (this.enabled) void this.setEnabled(true);
  };
}
