import test from 'node:test';
import assert from 'node:assert/strict';
import { OCEAN_WAVES, sampleOceanHeight, sampleOceanSurface } from '../dist/index.js';

const surface = () => ({ height: 0, slopeX: 0, slopeZ: 0, verticalVelocity: 0 });
const near = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be within ${tolerance} of ${expected}`);
};

test('wave directions and frequencies obey deep-water gravity-wave dispersion', () => {
  assert.equal(OCEAN_WAVES.length, 6);
  let previousPhaseSpeed = Infinity;
  for (const wave of OCEAN_WAVES) {
    near(Math.hypot(wave.directionX, wave.directionZ), 1, 1e-12);
    near(wave.waveNumber * wave.wavelength, Math.PI * 2, 1e-12);
    near(wave.angularFrequency ** 2 / wave.waveNumber, 9.81, 1e-12);
    assert.ok(wave.waveNumber * wave.amplitude < .055, 'Stokes steepness remains small');
    assert.ok(wave.angularFrequency / wave.waveNumber < previousPhaseSpeed, 'long swell travels faster than short chop');
    previousPhaseSpeed = wave.angularFrequency / wave.waveNumber;
    assert.ok(Object.isFrozen(wave));
  }
  assert.ok(Object.isFrozen(OCEAN_WAVES));
});

test('analytic slopes and water velocity agree with independent finite differences', () => {
  const epsilon = 1e-4;
  const sample = surface();
  for (const [x, z, time] of [[0, 0, 0], [134.2, -271.4, 18.6], [-814.3, 1412.1, 735.8]]) {
    assert.equal(sampleOceanSurface(x, z, time, sample), sample, 'the supplied object is reused');
    near(sample.height, sampleOceanHeight(x, z, time), 1e-12);
    near(sample.slopeX, (sampleOceanHeight(x + epsilon, z, time) - sampleOceanHeight(x - epsilon, z, time)) / (2 * epsilon));
    near(sample.slopeZ, (sampleOceanHeight(x, z + epsilon, time) - sampleOceanHeight(x, z - epsilon, time)) / (2 * epsilon));
    near(sample.verticalVelocity, (sampleOceanHeight(x, z, time + epsilon) - sampleOceanHeight(x, z, time - epsilon)) / (2 * epsilon));
  }
});

test('encounter velocity includes the query moving through the wave slopes', () => {
  const epsilon = 1e-5;
  const x = 240, z = -370, time = 52, velocityX = 9.3, velocityZ = -6.4;
  const stationary = sampleOceanSurface(x, z, time, surface());
  const moving = sampleOceanSurface(x, z, time, surface(), velocityX, velocityZ);
  near(moving.verticalVelocity, stationary.verticalVelocity + stationary.slopeX * velocityX + stationary.slopeZ * velocityZ, 1e-12);
  near(moving.verticalVelocity,
    (sampleOceanHeight(x + velocityX * epsilon, z + velocityZ * epsilon, time + epsilon) -
      sampleOceanHeight(x - velocityX * epsilon, z - velocityZ * epsilon, time - epsilon)) / (2 * epsilon));
});

test('the deterministic wave field remains bounded and conserves its statistical energy', () => {
  const heightBound = OCEAN_WAVES.reduce((total, wave) => total + wave.amplitude + wave.harmonicAmplitude, 0);
  const slopeBound = OCEAN_WAVES.reduce((total, wave) => total + wave.waveNumber * (wave.amplitude + 2 * wave.harmonicAmplitude), 0);
  const velocityBound = OCEAN_WAVES.reduce((total, wave) => total + wave.angularFrequency * (wave.amplitude + 2 * wave.harmonicAmplitude), 0);
  const expectedVariance = OCEAN_WAVES.reduce((total, wave) => total + (wave.amplitude ** 2 + wave.harmonicAmplitude ** 2) / 2, 0);
  const sample = surface();
  for (const startTime of [0, 100_000]) {
    let sum = 0, sumSquared = 0;
    const count = 8192;
    for (let index = 0; index < count; index++) {
      sampleOceanSurface(index * 13.71, index * -7.31, startTime + index * .19, sample);
      assert.ok(Math.abs(sample.height) <= heightBound);
      assert.ok(Math.hypot(sample.slopeX, sample.slopeZ) <= slopeBound);
      assert.ok(Math.abs(sample.verticalVelocity) <= velocityBound);
      sum += sample.height;
      sumSquared += sample.height ** 2;
    }
    assert.ok(Math.abs(sum / count) < .02, 'there is no accumulating mean water-level drift');
    near(sumSquared / count - (sum / count) ** 2, expectedVariance, .015);
  }
});
