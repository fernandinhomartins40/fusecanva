import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeTextAndMarks } from '../src/text-merge.mjs'

test('concurrent text edits preserve underline and strike marks by property', () => {
  const baseText = 'Hello world'
  const baseMarks = [{ start: 0, end: 5, underline: true }]
  const localText = 'Hello world!'
  const localMarks = [
    { start: 0, end: 5, underline: true },
    { start: 6, end: 11, strike: true },
  ]
  const remoteText = 'Hello, world'
  const remoteMarks = [{ start: 0, end: 5, underline: true }]

  assert.deepEqual(mergeTextAndMarks(baseText, baseMarks, localText, localMarks, remoteText, remoteMarks), {
    text: 'Hello, world!',
    marks: [
      { start: 0, end: 5, underline: true },
      { start: 7, end: 12, strike: true },
    ],
  })
})

test('independent underline removal and strike addition merge by style property', () => {
  const baseText = 'Marked text'
  const baseMarks = [{ start: 0, end: 6, underline: true }]
  const localMarks = []
  const remoteMarks = [{ start: 0, end: 6, underline: true, strike: true }]
  assert.deepEqual(mergeTextAndMarks(baseText, baseMarks, baseText, localMarks, baseText, remoteMarks), {
    text: baseText,
    marks: [{ start: 0, end: 6, strike: true }],
  })
})
