import type { BoatSimulationState } from "@naval/shared";

export type SoundStatus = "off" | "on" | "muted" | "blocked" | "unavailable";

/** Small procedural soundscape. Audio resources are created only after a user gesture. */
export class MaritimeAudio {
  status: SoundStatus = "off";
  private context?: AudioContext;
  private master?: GainNode;
  private seaGain?: GainNode;
  private engineGain?: GainNode;
  private engineTone?: OscillatorNode;
  private engineHarmonic?: OscillatorNode;
  private readonly sources: (AudioBufferSourceNode | OscillatorNode)[] = [];
  private readonly calls = new Set<OscillatorNode>();
  private volume = .75;
  private enabled = false;
  private activationVersion = 0;
  private turbineGain?: GainNode;
  private turbineTone?: OscillatorNode;
  private propellerGain?: GainNode;
  private hornUntil = 0;
  private nextGullTime = 3;
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

  update(state: BoatSimulationState, birdsVisible: boolean): void {
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
    if (birdsVisible && state.elapsedTime >= this.nextGullTime) {
      this.callGull(Math.sin(state.elapsedTime * .3) * .7);
      this.nextGullTime = state.elapsedTime + 7 + Math.random() * 7;
    }
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pointerdown", this.onFirstInteraction);
    window.removeEventListener("keydown", this.onKeyDown);
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    for (const call of this.calls) { call.onended = null; call.stop(); call.disconnect(); }
    this.calls.clear();
    void this.context?.close().catch(() => undefined);
  }

  private initialize(): void {
    const context = new AudioContext();
    this.context = context;
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

  private callGull(pan: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    for (let syllable = 0; syllable < 3; syllable += 1) {
      const start = context.currentTime + syllable * .28;
      const tone = context.createOscillator();
      tone.type = "triangle";
      const pitch = 850 + Math.random() * 180;
      tone.frequency.setValueAtTime(pitch, start);
      tone.frequency.exponentialRampToValueAtTime(pitch * 1.6, start + .065);
      tone.frequency.exponentialRampToValueAtTime(pitch * .72, start + .24);
      const gain = context.createGain();
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.021 / (syllable + 1), start + .05);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .27);
      const stereo = context.createStereoPanner();
      stereo.pan.value = pan;
      tone.connect(gain).connect(stereo).connect(this.master);
      this.calls.add(tone);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); stereo.disconnect(); this.calls.delete(tone); };
      tone.start(start);
      tone.stop(start + .28);
    }
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

  private readonly onFirstInteraction = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest("button, input, select")) return;
    if (this.status === "off" || this.status === "blocked") void this.setEnabled(true);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof Element && event.target.closest("input, select, textarea, button, [contenteditable]")) return;
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "h"].includes(event.key.toLowerCase())) return;
    this.onFirstInteraction(event);
    if (event.key.toLowerCase() === "h" && !event.repeat) {
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
