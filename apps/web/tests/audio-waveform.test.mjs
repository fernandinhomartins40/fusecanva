import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

test('audio waveform peaks preserve transients and combine channels by peak', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getAudioWaveformPeaks } = await vite.ssrLoadModule('/src/audio-waveform.ts')
    assert.deepEqual(getAudioWaveformPeaks([Float32Array.from([0, 0.1, -0.9, 0, 0.2, 0])], 3), [0.1, 0.9, 0.2])
    assert.deepEqual(getAudioWaveformPeaks([[-0.2, 0.1, 0], [0.3, 0.8, -0.4]], 3), [0.3, 0.8, 0.4], 'stereo channels contribute the strongest absolute peak in each interval')
    assert.deepEqual(getAudioWaveformPeaks([[0.1, 0.2]], 4), [0.1, 0.1, 0.2, 0.2], 'more display bars than source samples remain deterministic')
  } finally { await vite.close() }
})

test('audio waveform peaks bound malformed samples and invalid requests', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getAudioWaveformPeaks } = await vite.ssrLoadModule('/src/audio-waveform.ts')
    assert.deepEqual(getAudioWaveformPeaks([], 3), [0, 0, 0])
    assert.deepEqual(getAudioWaveformPeaks([[Number.NaN, Number.POSITIVE_INFINITY, -3]], 3), [0, 0, 1], 'non-finite values are ignored and over-range amplitudes are clamped')
    assert.throws(() => getAudioWaveformPeaks([], 0), RangeError)
    assert.throws(() => getAudioWaveformPeaks([], 1.5), RangeError)
    assert.throws(() => getAudioWaveformPeaks([], 16_385), RangeError)
  } finally { await vite.close() }
})

test('audio timeline waveform samples only the clip source trim range', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getAudioWaveformRangePeaks } = await vite.ssrLoadModule('/src/audio-waveform.ts')
    const samples = Float32Array.from([0.1, 0.1, 0.9, 0.9, 0.2, 0.2, 0.7, 0.7])
    assert.deepEqual(getAudioWaveformRangePeaks([samples], 1000, 2, 4, 2), [0.9, 0.2], 'the trim start and clip duration select the corresponding PCM window')
    assert.deepEqual(getAudioWaveformRangePeaks([samples], 1000, 7, 20, 2), [0.7, 0.7], 'a range extending past decoded media is safely clamped')
    assert.throws(() => getAudioWaveformRangePeaks([samples], 0, 0, 1, 2), RangeError)
    assert.throws(() => getAudioWaveformRangePeaks([samples], 1000, -1, 1, 2), RangeError)
  } finally { await vite.close() }
})

test('audio rhythm markers are deterministic, normalized envelope peaks with minimum spacing', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getAudioBeatMarkers } = await vite.ssrLoadModule('/src/audio-waveform.ts')
    assert.deepEqual(getAudioBeatMarkers([0, 0, 0, 0]), [], 'silence has no rhythm markers')
    const impulses = [0, 0.2, 0, 0, 0.9, 0, 0.5, 0, 0.1]
    assert.deepEqual(getAudioBeatMarkers(impulses, { minDistance: 2, threshold: 0.4 }), [4, 6], 'isolated impulses above the normalized threshold are returned')
    assert.deepEqual(getAudioBeatMarkers(impulses.map(value => value * 0.1), { minDistance: 2, threshold: 0.4 }), [4, 6], 'peak-relative normalization is amplitude-scale invariant')
    assert.deepEqual(getAudioBeatMarkers([0, 1, 0, 0, 0.8, 0], { minDistance: 4, threshold: 0.5 }), [1], 'minimum distance suppresses a weaker nearby impulse')
    assert.deepEqual(getAudioBeatMarkers([0, 1, 0, 0, 1, 0], { minDistance: 3, threshold: 0.5 }), [1, 4], 'markers exactly minDistance apart are retained')
  } finally { await vite.close() }
})

test('audio rhythm markers map from the trimmed source window onto the current timeline clip', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { mapAudioBeatMarkersToTimeline } = await vite.ssrLoadModule('/src/audio-waveform.ts')
    const clip = { sourceStartMs: 250, sourceDurationMs: 10_000, startMs: 5_000, durationMs: 4_000 }
    assert.deepEqual(mapAudioBeatMarkersToTimeline([0, 3, -1, 4], 4, clip), [
      { sourceTimeMs: 750, timelineTimeMs: 5_500, clipProgress: 0.125 },
      { sourceTimeMs: 3_750, timelineTimeMs: 8_500, clipProgress: 0.875 },
    ], 'source trim and timeline position/duration map each bucket center to the matching times')

    const movedAndTrimmed = mapAudioBeatMarkersToTimeline([1], 4, { ...clip, sourceStartMs: 1_000, startMs: 2_000, durationMs: 2_000 })
    assert.deepEqual(movedAndTrimmed, [{ sourceTimeMs: 1_750, timelineTimeMs: 2_750, clipProgress: 0.375 }], 'moving the clip and changing its trim/duration reprojects the same bucket')
    assert.throws(() => mapAudioBeatMarkersToTimeline([0], 4, { ...clip, sourceStartMs: 8_000 }), RangeError, 'a source trim that exceeds media duration is rejected')
  } finally { await vite.close() }
})

test('audio rhythm marker limits are explicit and malformed envelope values are ignored', async () => {
  const vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { getAudioBeatMarkers } = await vite.ssrLoadModule('/src/audio-waveform.ts')
    assert.deepEqual(getAudioBeatMarkers([Number.NaN, 0.1, Number.POSITIVE_INFINITY, -0.5], { threshold: 0.9 }), [3], 'non-finite buckets are silent and signed values use magnitude')
    assert.throws(() => getAudioBeatMarkers([0], { minDistance: 0 }), RangeError)
    assert.throws(() => getAudioBeatMarkers([0], { minDistance: 1.5 }), RangeError)
    assert.throws(() => getAudioBeatMarkers([0], { threshold: -0.1 }), RangeError)
    assert.throws(() => getAudioBeatMarkers([0], { threshold: 1.1 }), RangeError)
    assert.throws(() => getAudioBeatMarkers(Array(16_385).fill(0)), RangeError)
  } finally { await vite.close() }
})
