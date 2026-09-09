import { describe, expect, it } from 'vitest'
import { parseRichText, toPlainText } from './richtext'
import { docToText, textToDoc } from './richTextDoc'

/**
 * The stored format and the TipTap document have to agree exactly.
 *
 * MentionEditor fires `onUpdate` for its *initial* content as well as for real
 * edits, so `docToText(textToDoc(x))` runs against every prose field the moment
 * it is opened, and whatever comes out is what gets saved. Any disagreement
 * between the two directions is therefore not a cosmetic difference: it is the
 * editor quietly rewriting the author's text on open, once per open, for ever.
 */
const roundTrip = (text: string) => docToText(textToDoc(text))

/** Stable = a second pass changes nothing. That is the property that matters. */
function expectConverges(text: string) {
  const once = roundTrip(text)
  expect(roundTrip(once), 'round trip must converge').toBe(once)
  return once
}

describe('round trip: text -> TipTap doc -> text', () => {
  it('leaves a single paragraph alone', () => {
    expect(roundTrip('Une phrase simple.')).toBe('Une phrase simple.')
  })

  it('keeps paragraphs separate — the paste bug', () => {
    // Pasting three paragraphs used to store them joined by single newlines,
    // so the next load fused them into one paragraph with line breaks in it.
    const text = 'Premier paragraphe.\n\nDeuxieme paragraphe.\n\nTroisieme.'
    expect(roundTrip(text)).toBe(text)
    expect(parseRichText(text)).toHaveLength(3)
  })

  it('keeps a soft line break inside a paragraph as one paragraph', () => {
    expect(roundTrip('Ligne un\nLigne deux')).toBe('Ligne un\nLigne deux')
    expect(parseRichText('Ligne un\nLigne deux')).toHaveLength(1)
  })

  it('keeps a bullet list attached to its intro line', () => {
    const text = 'Les joueurs doivent monter un plan:\n- Quand ?\n- Quelle securite ?'
    expect(roundTrip(text)).toBe(text)
  })

  it('preserves the exact shape of a real scene description', () => {
    // Straight out of production, blank runs and all.
    const text = [
      'Les joueurs doivent monter un plan:',
      '- Quand est ce que la cargaison est accessible ?',
      '- Quelle securite est en place ?',
      '',
      '',
      '',
      'La @[Cargo](artefact:475d91c3-c2f0-448a-818d-1c109f553ffc) est une caisse hermetique.',
    ].join('\n')
    expect(roundTrip(text)).toBe(text)
  })

  it('preserves bold, italic and mentions', () => {
    const text = '**Gras** et *italique* et @[Rache](3f2a) ensemble.'
    expect(roundTrip(text)).toBe(text)
  })

  it('preserves empty paragraphs between text', () => {
    const text = 'Avant\n\n\n\nApres'
    expect(roundTrip(text)).toBe(text)
  })

  it('leaves an empty value empty', () => {
    expect(roundTrip('')).toBe('')
  })

  it('never grows the text on repeated opens', () => {
    // The failure mode this guards is compounding: one extra blank line per
    // load/edit/save cycle, until the field is mostly whitespace.
    for (const text of [
      'A\n\nB',
      'Intro:\n- un\n- deux',
      'A\nB\n\nC',
      '- seul',
      'Fin\n\n- liste\n\nApres',
    ]) {
      const once = expectConverges(text)
      expect(once.length, `"${text}" must not grow unboundedly`).toBeLessThanOrEqual(text.length + 1)
    }
  })

  it('normalises a paragraph glued to a list, then holds still', () => {
    // TipTap cannot attach a paragraph to a list, so this one legitimately
    // gains the blank line the editor already shows. It must then be stable.
    expect(expectConverges('- un\n- deux\nApres')).toBe('- un\n- deux\n\nApres')
  })
})

describe('toPlainText', () => {
  it('drops markers, bullets and mention refs', () => {
    expect(toPlainText('**Gras** et *ita* et @[Rache](3f2a)\n- item'))
      .toBe('Gras et ita et @Rache\nitem')
  })
})
