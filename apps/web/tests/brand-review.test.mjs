import assert from 'node:assert/strict'
import test from 'node:test'
import { applyBrandReviewFixes, reviewBrandElements } from '../src/brand-review.mjs'

test('brand review lists single font and mapped-color fixes, then applies one correction without side effects', () => {
  const elements = [
    { id: 'heading', type: 'text', name: 'Heading', text: 'Keep this title', x: 8, y: 12, width: 240, height: 40, rotation: 4, fontSize: 28, fontFamily: 'Georgia', color: '#75511c', bold: true },
    { id: 'logo', type: 'image', name: 'Logo', src: 'data:image/png;base64,AA==', x: 1, y: 2, width: 30, height: 20, rotation: 0 },
  ]
  const issues = reviewBrandElements(elements)
  assert.deepEqual(issues.map(issue => issue.key), ['font:heading', 'color:heading:color'])

  const fixed = applyBrandReviewFixes(elements, ['font:heading'])
  assert.deepEqual(fixed[0], { ...elements[0], fontFamily: 'Arial' })
  assert.equal(fixed[0].color, '#75511c', 'single font fix changes only the font family')
  assert.deepEqual(fixed[1], elements[1])
  assert.equal(elements[0].fontFamily, 'Georgia', 'source data remains unchanged')
  assert.deepEqual(reviewBrandElements(fixed).map(issue => issue.key), ['color:heading:color'])
})

test('selected batch fixes apply only supported font and palette mappings and are idempotent', () => {
  const elements = [
    { id: 'a', type: 'text', name: 'A', text: 'A', x: 1, y: 2, width: 80, height: 24, rotation: 0, fontSize: 16, fontFamily: 'Georgia', color: '#b29365', bold: false },
    { id: 'b', type: 'text', name: 'B', text: 'B', x: 2, y: 3, width: 90, height: 26, rotation: 0, fontSize: 20, fontFamily: 'Verdana', color: '#000000', bold: true },
    { id: 'shape', type: 'shape', name: 'Shape', x: 4, y: 5, width: 20, height: 20, rotation: 0, fill: '#75511c', cornerRadius: 0 },
  ]
  const issues = reviewBrandElements(elements)
  assert.deepEqual(issues.map(issue => issue.key), ['font:a', 'color:a:color', 'font:b', 'color:shape:fill'])
  const fixed = applyBrandReviewFixes(elements, issues.map(issue => issue.key))
  assert.deepEqual(fixed.map(element => element.id), elements.map(element => element.id))
  assert.deepEqual(fixed[0], { ...elements[0], fontFamily: 'Arial', color: '#2d4a6f' })
  assert.deepEqual(fixed[1], { ...elements[1], fontFamily: 'Arial' })
  assert.deepEqual(fixed[2], { ...elements[2], fill: '#123456' })
  assert.deepEqual(reviewBrandElements(fixed), [])
  assert.equal(applyBrandReviewFixes(fixed, issues.map(issue => issue.key)), fixed)
})

test('review does not invent color corrections for unmapped values or inspect images as typography', () => {
  const elements = [
    { id: 'text', type: 'text', name: 'Text', text: 'Copy', fontFamily: 'Arial', color: '#ff00ff' },
    { id: 'image', type: 'image', name: 'Image', src: 'data:image/png;base64,AA==', fontFamily: 'Decorative', x: 0, y: 0, width: 20, height: 20, rotation: 0 },
  ]
  assert.deepEqual(reviewBrandElements(elements), [])
})

test('brand review checks both sticky-note fill and foreground color without changing unrelated fields', () => {
  const sticky = { id: 'note', type: 'sticky-note', name: 'Note', text: 'Keep this note', x: 11, y: 17, width: 220, height: 140, rotation: 3, fill: '#b29365', color: '#75511c', fontSize: 18 }
  const issues = reviewBrandElements([sticky])
  assert.deepEqual(issues.map(issue => issue.key), ['color:note:fill', 'color:note:color'])

  const fixedFill = applyBrandReviewFixes([sticky], ['color:note:fill'])
  assert.deepEqual(fixedFill[0], { ...sticky, fill: '#2d4a6f' }, 'individual fill correction preserves foreground and note content')
  const fixedBoth = applyBrandReviewFixes([sticky], issues.map(issue => issue.key))
  assert.deepEqual(fixedBoth[0], { ...sticky, fill: '#2d4a6f', color: '#123456' }, 'batch correction applies both explicit palette mappings')
  assert.deepEqual(reviewBrandElements(fixedBoth), [])
  assert.equal(sticky.color, '#75511c', 'the source note is not mutated')
})
