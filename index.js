const EventEmitter = require('events')
const browserify = require('browserify')
const dedent = require('dedent')
const b4a = require('b4a')
const sodium = require('sodium-universal')
const bech32 = require('bcrypto/lib/encoding/bech32')
const { Isolate, Reference, Context, ExternalCopy } = require('isolated-vm')
const Autobase = require('autobase')
const DHT = require('@hyperswarm/dht')

class Autoisolate extends EventEmitter {
  constructor (script, opts) {
    super()

    if (typeof script === 'object') {
      opts = script
      script = opts.script
    }

    if (!script) throw new Error('Missing script')

    if (!opts) opts = {}
    if (!opts.injection) opts.injection = {}

    this.dht = (opts.dht instanceof DHT) ? opts.dht : new DHT(opts.dht)
    this.autobase = (opts.autobase instanceof Autobase) ? opts.autobase : new Autobase(opts.autobase)
    this.isolate = (opts.isolate instanceof Isolate) ? opts.isolate : new Isolate(opts.isolate)
    this.injection = opts.injection || {}
    this.violation = false
    this._ready = false
    this._browserifying = false

    this.start(script, opts)
  }

  // --- initialize ---

  async start (script, opts) {
    // --- isolate ---
    this.script = await this.maybeAddress(script)

    this._browserifying = true
    const b = browserify()
    b.require('b4a', { expose: 'buffer' })
    b.bundle(async (err, prescript) => {
      if (err) throw error
      this.prescript = prescript.toString()
      const script = dedent(`
        ${this.prescript}
        const Buffer = require('buffer')
        ${this.script}
      `)
      this.program = await this.isolate.compileScript(script)
      this._browserifying = false
      this.emit('_browserified')
    })

    this.address = Autoisolate.encodeScript(this.script)

    // --- witness ---
    const passToWitness = async function (...args) {
      if (this._ready && args[0].indexOf('error') !== 0) return

      // pass error events to witness
      try {
        const response = await this.witness(...args)
        return this._handleWitnessResponse(response, ...args)
      } catch (error) {
        // todo: trace violations (eg which input violated contract?)
        this.violation = true
        this.emit('violation', error)
        return error
      }
    }
    this.autobase.on('error', passToWitness.bind(this, 'error:autobase'))
    this.on('error:script', passToWitness.bind(this, 'error:script'))
    this.on('error', passToWitness.bind(this, 'error'))

    // --- autobase ---

    this.autobase.start({
      ...opts,
      apply: this.apply.bind(this)
    })

    await this.autobase.ready()

    if (this._browserifying) {
      this.on('_browserified', () => {
        this._ready = true
        this.emit('ready')
      })
    }
  }

  ready () {
    return this._ready || new Promise(ready => this.on('ready', ready))
  }

  // --- autobase ---

  get view () {
    return this.autobase.view
  }

  clock (...args) {
    return this.autobase.clock(...args)
  }

  latest (...args) {
    return this.autobase.latest(...args)
  }

  append (...args) {
    return this.autobase.append(...args)
  }

  async apply (batch, clocks, change) {
    try {
      batch = await this.map(batch, clocks, change)
        .catch(error => this.emit('error:script', error)) || []
    } catch (error) {
      return this._handleScriptError(error)
    }

    try {
      await this.view.append(batch)
    } catch (error) {
      return this._handleBatchError(error)
    }

    return this.view
  }

  async map (...args) {
    try {
      return await this.runScript('apply', args, this.injection)
    } catch (error) {
      return this._handleApplyError(error)
    }
  }

  async witness (...args) {
    try {
      return await this.runScript('witness', args, this.injection)
    } catch (error) {
      return this._handleWitnessError(error)
    }
  }

  // --- isolate ---

  async createContext (script, injection) {
    if (!injection) injection = {}

    const context = await this.isolate.createContext()

    context.global.setSync('log', (...args) => console.log(...args))
    Object.keys(injection).forEach(key => {
      try {
        if (typeof injection[key] === 'function') {
          context.global.setSync(key, injection[key])
        } else {
          context.global.setSync(key, injection[key], { copy: true })
        }
      } catch (error) {
        return this._handleInjectionError(error, key, injection)
      }
    })

    return context
  }

  async runProgram (context) {
    if (!(context instanceof Context)) {
      context = await this.createContext(this.script, context)
    }

    await this.program.run(context)

    return context
  }

  async runScript (name, args, context, opts) {
    if (!name) throw new Error('No script specified')
    if (!args) args = []
    if (!(context instanceof Context)) {
      context = await this.createContext(this.script, context)
    }
    if (!opts) {
      opts = {
        arguments: {
          copy: true
        },
        result: {
          promise: true,
          copy: true
        }
      }
    }

    await this.runProgram(context)
    const fn = await context.global.get(name, { reference: true })
    try {
      return await fn.apply(null, args, opts)
    } catch (error) {
      return this._handleScriptError(error)
    }
  }

  // --- dht ---

  destroy (...args) {
    return this.dht.destroy(...args)
  }

  async maybeAddress (script, options) {
    const node = this.dht
    if (script.length === 63) {
      try {
        const [hrp, version, hash] = bech32.decode(script)
        try {
          const { value } = await node.immutableGet(hash, options)
          return value.toString()
        } catch (error) {
          throw error
        }
      } catch (error) {} // if not valid bech32, treat as script
    }
    try {
      return script
    } catch (error) {
      throw error
    }
  }

  async getScript (options) {
    const { value } = await Autoisolate.getScript(this.dht, this.address, options)
    return value
  }

  async putScript (options) {
    const { hash } = await Autoisolate.putScript(this.dht, this.script, options)
    return hash
  }

  static async getScript (dht, address, options) {
    if (!address || typeof address !== 'string') throw new Error('Missing address')
    if (address.length !== 63) throw new Error(`Addresses are 63 characters long not ${address.length}`)

    const [hrp, version, hash] = bech32.decode(address)
    return await dht.immutableGet(hash, options)
  }

  static async putScript (dht, script, options) {
    if (!script || (typeof script !== 'string' && !b4a.isBuffer(script))) throw new Error('Missing script')
    if (typeof script === 'string') {
      script = b4a.from(script)
    }

    return await dht.immutablePut(script, options)
  }

  static hashScript (script) {
    if (typeof script === 'string') {
      script = b4a.from(script)
    }
    const target = b4a.allocUnsafe(32)
    sodium.crypto_generichash(target, script)
    return target
  }

  static encodeScript (script) {
    const hash = Autoisolate.hashScript(script)
    return Autoisolate.encodeHash(hash)
  }

  static encodeHash (hash) {
    return bech32.encode('hyp', 1, hash)
  }

  // --- error handling ---
  async _handleBatchError (error) {
    console.log('BatchError:', error)
  }

  async _handleScriptError (error) {
    console.log('ScriptError:', error)
  }

  async _handleInjectionError (error) {
    console.log('InjectionError:', error)
  }

  async _handleWitnessError (error) {
    console.log('WitnessError:', error)
  }
}

module.exports = Autoisolate
