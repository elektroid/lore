// A small, safe expression language for "formula" sheet fields — no eval().
// Grammar:
//   expr   := term (('+'|'-') term)*
//   term   := factor (('*'|'/') factor)*
//   factor := '-' factor | NUMBER | IDENT '(' expr (',' expr)* ')' | IDENT | '(' expr ')'
// IDENTs are other field keys on the same sheet. Supported functions:
// ceil, floor, round, min, max, avg, sum.

import type { SheetField, SheetSchema } from '@/types/sheetTemplate'

type Token =
  | { type: 'num'; value: number }
  | { type: 'ident'; name: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '(' | ')' | ',' }

type Node =
  | { type: 'num'; value: number }
  | { type: 'ident'; name: string }
  | { type: 'neg'; arg: Node }
  | { type: 'bin'; op: '+' | '-' | '*' | '/'; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] }

const FUNCS: Record<string, (args: number[]) => number> = {
  ceil: a => Math.ceil(a[0]),
  floor: a => Math.floor(a[0]),
  round: a => Math.round(a[0]),
  min: a => Math.min(...a),
  max: a => Math.max(...a),
  avg: a => a.reduce((s, v) => s + v, 0) / a.length,
  sum: a => a.reduce((s, v) => s + v, 0),
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) {
      let j = i + 1
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++
      const text = expr.slice(i, j)
      const value = Number(text)
      if (Number.isNaN(value)) throw new Error(`Nombre invalide "${text}"`)
      tokens.push({ type: 'num', value })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++
      tokens.push({ type: 'ident', name: expr.slice(i, j) })
      i = j
      continue
    }
    if ('+-*/(),'.includes(c)) {
      tokens.push({ type: 'op', value: c as '+' | '-' | '*' | '/' | '(' | ')' | ',' })
      i++
      continue
    }
    throw new Error(`Caractère inattendu "${c}"`)
  }
  return tokens
}

class Parser {
  private pos = 0
  private tokens: Token[]
  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek() { return this.tokens[this.pos] }
  private next() { return this.tokens[this.pos++] }

  parse(): Node {
    const node = this.expr()
    if (this.pos < this.tokens.length) {
      throw new Error(`Jeton inattendu après l'expression`)
    }
    return node
  }

  private expr(): Node {
    let node = this.term()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.next()
        node = { type: 'bin', op: t.value, left: node, right: this.term() }
      } else break
    }
    return node
  }

  private term(): Node {
    let node = this.factor()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && (t.value === '*' || t.value === '/')) {
        this.next()
        node = { type: 'bin', op: t.value, left: node, right: this.factor() }
      } else break
    }
    return node
  }

  private factor(): Node {
    const t = this.peek()
    if (!t) throw new Error('Expression incomplète')

    if (t.type === 'op' && t.value === '-') {
      this.next()
      return { type: 'neg', arg: this.factor() }
    }
    if (t.type === 'op' && t.value === '(') {
      this.next()
      const node = this.expr()
      const close = this.next()
      if (!close || close.type !== 'op' || close.value !== ')') throw new Error('Parenthèse fermante manquante')
      return node
    }
    if (t.type === 'num') {
      this.next()
      return { type: 'num', value: t.value }
    }
    if (t.type === 'ident') {
      this.next()
      const open = this.peek()
      if (open?.type === 'op' && open.value === '(') {
        this.next()
        const args: Node[] = []
        if (!(this.peek()?.type === 'op' && (this.peek() as Token & { type: 'op' }).value === ')')) {
          args.push(this.expr())
          while (this.peek()?.type === 'op' && (this.peek() as Token & { type: 'op' }).value === ',') {
            this.next()
            args.push(this.expr())
          }
        }
        const close = this.next()
        if (!close || close.type !== 'op' || close.value !== ')') throw new Error(`Parenthèse fermante manquante pour ${t.name}(…)`)
        return { type: 'call', name: t.name, args }
      }
      return { type: 'ident', name: t.name }
    }
    throw new Error('Expression incomplète')
  }
}

export function parseFormula(expression: string): { ok: true; node: Node } | { ok: false; error: string } {
  try {
    const tokens = tokenize(expression)
    const node = new Parser(tokens).parse()
    return { ok: true, node }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function evalNode(node: Node, resolve: (name: string) => number): number {
  switch (node.type) {
    case 'num': return node.value
    case 'ident': return resolve(node.name)
    case 'neg': return -evalNode(node.arg, resolve)
    case 'bin': {
      const l = evalNode(node.left, resolve)
      const r = evalNode(node.right, resolve)
      if (node.op === '+') return l + r
      if (node.op === '-') return l - r
      if (node.op === '*') return l * r
      return r === 0 ? NaN : l / r
    }
    case 'call': {
      const fn = FUNCS[node.name]
      if (!fn) throw new Error(`Fonction inconnue "${node.name}"`)
      return fn(node.args.map(a => evalNode(a, resolve)))
    }
  }
}

function flattenFields(schema: SheetSchema): Map<string, SheetField> {
  const map = new Map<string, SheetField>()
  for (const section of schema.sections) {
    for (const field of section.fields) map.set(field.key, field)
  }
  return map
}

export type FormulaResult = { value: number } | { error: string }

/** Evaluates every "formula" field in the schema against the given values. */
export function evaluateSheet(schema: SheetSchema, values: Record<string, unknown>): Record<string, FormulaResult> {
  const fields = flattenFields(schema)
  const results: Record<string, FormulaResult> = {}
  const resolving = new Set<string>()

  function resolve(key: string): number {
    const field = fields.get(key)
    if (!field) throw new Error(`Champ inconnu "${key}"`)

    if (field.type === 'number') {
      const raw = values[key]
      const n = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(n) ? n : (field.default ?? 0)
    }

    if (field.type === 'formula') {
      if (key in results) {
        const r = results[key]
        if ('error' in r) throw new Error(r.error)
        return r.value
      }
      if (resolving.has(key)) throw new Error(`Référence circulaire sur "${key}"`)
      resolving.add(key)
      const parsed = parseFormula(field.expression ?? '')
      if (!parsed.ok) {
        results[key] = { error: parsed.error }
        resolving.delete(key)
        throw new Error(parsed.error)
      }
      const value = evalNode(parsed.node, resolve)
      resolving.delete(key)
      results[key] = { value }
      return value
    }

    throw new Error(`Le champ "${key}" (${field.type}) n'est pas numérique`)
  }

  for (const field of fields.values()) {
    if (field.type !== 'formula' || field.key in results) continue
    try {
      const value = resolve(field.key)
      results[field.key] = { value }
    } catch (e) {
      results[field.key] = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  return results
}
