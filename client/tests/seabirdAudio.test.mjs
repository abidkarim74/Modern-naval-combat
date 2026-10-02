import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const helperSource = await readFile(new URL('../src/world/seabirdAudio.ts', import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} }).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(compile(helperSource)).toString('base64')}`;
const { GullCallScheduler, seabirdDistanceGain, sampleSeabirdSpatial, fillSynthesizedGullCall } = await import(helperUrl);
const audioSource = await readFile(new URL('../src/world/MaritimeAudio.ts', import.meta.url), 'utf8');
const audioCode = compile(audioSource.replaceAll('import.meta.env.BASE_URL', '"/"'))
  .replace('from "./seabirdAudio"', `from ${JSON.stringify(helperUrl)}`);
const { MaritimeAudio } = await import(`data:text/javascript;base64,${Buffer.from(audioCode).toString('base64')}`);

const zero = { x: 0, y: 0, z: 0 }, forward = { x: 0, y: 0, z: 1 };
const bird = (id = 0, overrides = {}) => ({ id, visible: true, callEligible: true,
  x: 30, y: 8, z: 0, velocityX: 0, velocityY: 0, velocityZ: 0, ...overrides });
const sample = () => ({ distance: 0, gain: 0, pan: 0, doppler: 1 });

test('gull amplitude attenuates with physical distance and smoothly becomes silent outside hearing range', () => {
  assert.equal(seabirdDistanceGain(0), 1);
  assert.equal(seabirdDistanceGain(18), 1);
  assert.equal(seabirdDistanceGain(36), .5);
  assert.ok(seabirdDistanceGain(120) < seabirdDistanceGain(60));
  assert.ok(seabirdDistanceGain(219) < .0001);
  assert.equal(seabirdDistanceGain(220), 0);
  assert.equal(seabirdDistanceGain(1000), 0);
  assert.equal(seabirdDistanceGain(NaN), 0);
  assert.equal(sampleSeabirdSpatial(bird(0, { visible: false }), zero, forward, zero, sample()).gain, 0);
});

test('camera orientation controls headphone sides and passing velocity produces bounded Doppler', () => {
  const right = sampleSeabirdSpatial(bird(0, { x: 30, y: 0 }), zero, forward, zero, sample());
  const left = sampleSeabirdSpatial(bird(0, { x: -30, y: 0 }), zero, forward, zero, sample());
  assert.equal(right.pan, 1);
  assert.equal(left.pan, -1);
  assert.equal(sampleSeabirdSpatial(bird(0, { x: 30, y: 0 }), zero, { x: 0, y: 0, z: -1 }, zero, sample()).pan, -1);
  const toward = sampleSeabirdSpatial(bird(0, { x: 30, y: 0, velocityX: -16 }), zero, forward, zero, sample());
  const away = sampleSeabirdSpatial(bird(0, { x: 30, y: 0, velocityX: 16 }), zero, forward, zero, sample());
  assert.ok(toward.doppler > 1 && toward.doppler <= 1.06);
  assert.ok(away.doppler < 1 && away.doppler >= .94);
  assert.equal(sampleSeabirdSpatial(bird(0, { x: 30, y: 0, velocityX: 16 }), zero, forward,
    { x: 16, y: 0, z: 0 }, sample()).doppler, 1, 'matching motion eliminates encounter Doppler');
});

test('the call scheduler selects visible nearby callers and limits individual/global cadence', () => {
  const scheduler = new GullCallScheduler();
  const near = bird(1), other = bird(2, { x: 70 }), far = bird(3, { x: 300 });
  assert.equal(scheduler.select([far, bird(4, { visible: false }), bird(5, { callEligible: false })], zero, 0), undefined);
  assert.equal(scheduler.select([far, other, near], zero, 0), near);
  scheduler.started(near.id, 0);
  assert.equal(scheduler.select([near, other], zero, 1), undefined);
  assert.equal(scheduler.select([near, other], zero, 5), other, 'the same gull has a longer per-bird cooldown');
  assert.equal(scheduler.select([near, other], zero, 5, other.id), undefined, 'currently sounding birds cannot overlap themselves');
  assert.equal(scheduler.select([near], zero, 20), near);
});

test('cached fallback calls are finite, varied, bounded and faded at both sample boundaries', () => {
  const first = new Float32Array(22050 * .8), second = new Float32Array(first.length);
  fillSynthesizedGullCall(first, 22050, 0);
  fillSynthesizedGullCall(second, 22050, 1);
  assert.equal(first[0], 0);
  assert.ok(Math.abs(first.at(-1)) < .001);
  assert.ok(first.every(Number.isFinite));
  assert.ok(Math.max(...first.map(Math.abs)) < 1);
  const rms = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0) / first.length);
  assert.ok(rms > .05 && rms < .4);
  assert.notDeepEqual(first, second);
});

class Parameter {
  value = 0;
  setTargetAtTime(value) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
}
class Node {
  disconnected = false;
  connect(next) { return next; }
  disconnect() { this.disconnected = true; }
}
class Source extends Node {
  frequency = new Parameter();
  playbackRate = new Parameter();
  started = false;
  stopped = false;
  onended = null;
  start(...args) { this.started = true; this.startArguments = args; }
  stop() { this.stopped = true; }
  finish() { this.onended?.(); }
}
class AudioContextFixture {
  static instances = [];
  sampleRate = 4000;
  currentTime = 0;
  state = 'running';
  destination = new Node();
  sources = [];
  panners = [];
  listener = Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ']
    .map(name => [name, new Parameter()]));
  constructor() { AudioContextFixture.instances.push(this); }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  createGain() { return Object.assign(new Node(), { gain: new Parameter() }); }
  createBiquadFilter() { return Object.assign(new Node(), { frequency: new Parameter(), Q: new Parameter() }); }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: new Parameter(), ratio: new Parameter() }); }
  createPanner() {
    const panner = Object.assign(new Node(), { positionX: new Parameter(), positionY: new Parameter(), positionZ: new Parameter() });
    this.panners.push(panner);
    return panner;
  }
  createOscillator() { const source = new Source(); this.sources.push(source); return source; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, sampleRate, numberOfChannels: channels, getChannelData: index => data[index] };
  }
  async decodeAudioData() { return this.createBuffer(1, this.sampleRate * 2.5, this.sampleRate); }
}

test('audio activates on demand, tracks the real bird throughout its call, and disposes pooled voices', async t => {
  const originals = new Map();
  for (const [name, value] of Object.entries({ document: Object.assign(new EventTarget(), { hidden: false }),
    window: new EventTarget(), AudioContext: AudioContextFixture,
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  AudioContextFixture.instances.length = 0;
  const audio = new MaritimeAudio();
  assert.equal(AudioContextFixture.instances.length, 0, 'constructing does not activate audio');
  await audio.setEnabled(false);
  assert.equal(AudioContextFixture.instances.length, 0);
  await audio.setEnabled(true);
  await audio.gullReady;
  const context = AudioContextFixture.instances[0];
  const state = { speed: 0, throttle: 0, elapsedTime: 0, positionX: 0, positionY: .6, positionZ: 0, heading: 0 };
  const baseSources = context.sources.length;
  audio.update(state, [], zero, forward);
  assert.equal(context.sources.length, baseSources, 'no birds means no random gull calls');
  const gull = bird(0, { x: 30, y: 18, z: 10, velocityX: -16 });
  audio.update(state, [gull], zero, forward);
  assert.equal(context.sources.length, baseSources + 1);
  const voice = audio.gullVoices[0];
  assert.equal(voice.source.buffer, audio.gullBuffer, 'call variants reuse one decoded recording');
  assert.equal(voice.panner.positionX.value, 30);
  assert.equal(voice.panner.positionZ.value, -10, 'the Z mirror preserves left/right in Web Audio');
  assert.equal(context.listener.forwardZ.value, -1);
  const firstSource = voice.source;
  context.currentTime = .2;
  gull.x = 26.8;
  audio.update(state, [gull], zero, forward);
  assert.equal(voice.panner.positionX.value, 26.8, 'the spatial source follows the actual passing gull');
  assert.equal(context.sources.length, baseSources + 1, 'cadence prevents repeated per-frame playback');
  gull.visible = false;
  context.currentTime = .3;
  audio.update(state, [gull], zero, forward);
  assert.equal(voice.gain.gain.value, 0, 'a hidden gull becomes silent');
  firstSource.finish();
  assert.equal(voice.source, undefined);
  assert.equal(firstSource.disconnected, true);
  context.currentTime = 20;
  gull.visible = true;
  audio.update(state, [gull], zero, forward);
  const activeSource = voice.source;
  assert.ok(activeSource);
  await audio.setEnabled(false);
  assert.equal(audio.master.gain.value, 0);
  const beforeMute = context.sources.length;
  audio.update(state, [gull], zero, forward);
  assert.equal(context.sources.length, beforeMute, 'muted updates cannot allocate new calls');
  audio.dispose();
  audio.dispose();
  assert.equal(context.state, 'closed');
  assert.equal(activeSource.stopped, true);
  assert.equal(activeSource.disconnected, true);
  assert.ok(context.panners.every(panner => panner.disconnected));
  assert.equal(audio.gullVoices.length, 0);
});

test('the recorded runtime asset is compact mono PCM with three faded call variants', async () => {
  const wav = await readFile(new URL('../public/audio/herring-gull-flight-calls.wav', import.meta.url));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.ok(wav.length < 120_000);
  assert.equal(wav.readInt16LE(44), 0);
  assert.equal(wav.readInt16LE(wav.length - 2), 0);
  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)) / 32768);
  assert.ok(peak > .6 && peak <= .81, 'native calls have audible dynamics without clipping');
});
