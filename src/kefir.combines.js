import {Observable, Property} from "kefir"
import {arityN, identicalU, inherit, isArray, isObject} from "infestines"

//

function forEach(template, fn) {
  if (template instanceof Observable)
    fn(template)
  else if (isArray(template))
    for (let i=0, n=template.length; i<n; ++i)
      forEach(template[i], fn)
  else if (isObject(template))
    for (const k in template)
      forEach(template[k], fn)
}

function countArray(template) {
  let c = 0
  for (let i=0, n=template.length; i<n; ++i)
    c += count(template[i])
  return c
}

function countObject(template) {
  let c = 0
  for (const k in template)
    c += count(template[k])
  return c
}

function countTemplate(template) {
  if (isArray(template))
    return countArray(template)
  else if (isObject(template))
    return countObject(template)
  else
    return 0
}

function count(template) {
  if (template instanceof Observable)
    return 1
  else
    return countTemplate(template)
}

function subscribe(template, handlers, self) {
  let index = -1
  forEach(template, observable => {
    const handler = e => self._handleAny(handler, e)
    handlers[++index] = handler
    observable.onAny(handler)
  })
}

function unsubscribe(template, handlers) {
  let index = -1
  forEach(template, observable => {
    const handler = handlers[++index]
    if (handler)
      observable.offAny(handler)
  })
}

function combine(template, values, state) {
  if (template instanceof Observable) {
    return values[++state.index]
  } else if (isArray(template)) {
    const n = template.length
    const next = Array(n)
    for (let i=0; i<n; ++i)
      next[i] = combine(template[i], values, state)
    return next
  } else if (isObject(template)) {
    const next = {}
    for (const k in template)
      next[k] = combine(template[k], values, state)
    return next
  } else {
    return template
  }
}

function invoke(xs) {
  if (!(xs instanceof Array))
    return xs

  const nm1 = xs.length-1
  const f = xs[nm1]
  return f instanceof Function
    ? f.apply(void 0, xs.slice(0, nm1))
    : xs
}

//

function Combine() {
  Property.call(this)
}

inherit(Combine, Property, {
  _maybeEmitValue(next) {
    const prev = this._currentEvent
    if (!prev || !identicalU(prev.value, next))
      this._emitValue(next)
  }
})

//

function CombineMany(template, n) {
  Combine.call(this)
  this._template = template
  this._handlers = n
  this._values = null
}

inherit(CombineMany, Combine, {
  _onActivation() {
    const template = this._template
    const n = this._handlers
    const handlers = Array(n)
    const values = Array(n)
    for (let i=0; i<n; ++i) {
      values[i] = this
      handlers[i] = this
    }
    this._handlers = handlers
    this._values = values
    subscribe(template, handlers, this)
  },
  _handleAny(handler, e) {
    const handlers = this._handlers
    let i=0
    while (handlers[i] !== handler)
      ++i
    switch (e.type) {
      case "value": {
        const values = this._values
        values[i] = e.value
        for (let j=0, n=values.length; j<n; ++j)
          if (values[j] === this)
            return
        this._maybeEmitValue(invoke(combine(this._template, values, {index: -1})))
        break
      }
      case "error": {
        this._emitError(e.value)
        break
      }
      default: {
        handlers[i] = null
        for (let j=0, n=handlers.length; j<n; ++j)
          if (handlers[j])
            return
        this._handlers = handlers.length
        this._values = null
        this._emitEnd()
        break
      }
    }
  },
  _onDeactivation() {
    const handlers = this._handlers
    this._handlers = handlers.length
    this._values = null
    unsubscribe(this._template, handlers)
  }
})

//

function CombineOne(template) {
  Combine.call(this)
  this._template = template
  this._handler = null
}

inherit(CombineOne, Combine, {
  _onActivation() {
    const handler = e => this._handleAny(e)
    this._handler = handler
    forEach(this._template, observable => observable.onAny(handler))
  },
  _handleAny(e) {
    switch (e.type) {
      case "value":
        this._maybeEmitValue(invoke(combine(this._template, [e.value], {index: -1})))
        break
      case "error":
        this._emitError(e.value)
        break
      default:
        this._handler = null
        this._emitEnd()
        break
    }
  },
  _onDeactivation() {
    const {_handler} = this
    this._handler = null
    forEach(this._template, observable => observable.offAny(_handler))
  }
})

//

function CombineOneWith(observable, fn) {
  Combine.call(this)
  this._observable = observable
  this._fn = fn
  this._handler = null
}

inherit(CombineOneWith, Combine, {
  _onActivation() {
    const handler = e => this._handleAny(e)
    this._handler = handler
    this._observable.onAny(handler)
  },
  _handleAny(e) {
    switch (e.type) {
      case "value":
        this._maybeEmitValue(this._fn(e.value))
        break
      case "error":
        this._emitError(e.value)
        break
      default:
        this._handler = null
        this._emitEnd()
        break
    }
  },
  _onDeactivation() {
    const {_handler, _observable} = this
    this._handler = null
    _observable.offAny(_handler)
  }
})

//

export const lift1Shallow = fn => x =>
  x instanceof Observable ? new CombineOneWith(x, fn) : fn(x)

export const lift1 = fn => x => {
  if (x instanceof Observable)
    return new CombineOneWith(x, fn)
  const n = countTemplate(x)
  if (0 === n)
    return fn(x)
  if (1 === n)
    return new CombineOne([x, fn])
  return new CombineMany([x, fn], n)
}

export function lift(fn) {
  const fnN = fn.length
  switch (fnN) {
    case 0: return fn
    case 1: return lift1(fn)
    default: return arityN(fnN, function () {
      const xsN = arguments.length, xs = Array(xsN)
      for (let i=0; i<xsN; ++i)
        xs[i] = arguments[i]
      const n = countArray(xs)
      if (0 === n)
        return fn.apply(null, xs)
      xs.push(fn)
      if (1 === n)
        new CombineOne(xs)
      return new CombineMany(xs, n)
    })
  }
}

export default function (...template) {
  const n = countArray(template)
  switch (n) {
    case 0: return invoke(template)
    case 1: return (template.length === 2 &&
                    template[0] instanceof Observable &&
                    template[1] instanceof Function
                    ? new CombineOneWith(template[0], template[1])
                    : new CombineOne(template))
    default: return new CombineMany(template, n)
  }
}
