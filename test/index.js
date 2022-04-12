const test = require('brittle')
const dedent = require('dedent')
const ram = require('random-access-memory')
const Hypercore = require('hypercore')
const Autobase = require('autobase')

const { bufferize, linearizedValues } = require('./helpers')
const Autoisolate = require('../')

const script = dedent`

  function apply (batch) {
    return batch.map(({ value }) => Buffer.from(Buffer.toString(value).toUpperCase()))
  }

`
const scriptAddress = 'hyp1pqdnvkw95qufp9czn8540f2lazdecn2cht475n08zaz6fkpatq2tshqltq2'
const expectedHash = '0366cb38b4071212e0533d2af4abfd137389ab175d7d49bce2e8b49b07ab0297'

test('put script on dht', async t => {
  const localInput = new Hypercore(ram)

  const base = new Autobase({
    inputs: [localInput],
    localInput
  })

  const isolate = new Autoisolate(script, { autobase: base })
  await isolate.ready()

  t.is(isolate.address, scriptAddress, 'computes address correctly')

  const hash = await isolate.putScript()
  t.is(hash.toString('hex'), expectedHash, 'script stored on dht at correct hash')

  const code = await isolate.getScript()
  t.is(code.toString(), script, 'script retrieved from dht')

  await isolate.destroy()

  t.end()
})

test('load from dht', async t => {
  const localInput = new Hypercore(ram)
  const localOutput = new Hypercore(ram)

  const base = new Autobase({
    inputs: [localInput],
    localInput,
    localOutput
  })

  const isolate = new Autoisolate(scriptAddress, { autobase: base })
  await isolate.ready()

  t.is(isolate.script, script, 'loaded isolate from dht')
  t.is(isolate.address, scriptAddress, 'same address')

  await base.append('hello world')

  const outputNodes = await linearizedValues(base.view)
  const expected = bufferize(['HELLO WORLD'])

  outputNodes.forEach((v, i) => t.is(true, v.value.equals(expected[i]), 'received loud greeting'))

  await isolate.destroy()

  t.end()
})

test('map with stateless mapper', async t => {
  const output = new Hypercore(ram)
  const writerA = new Hypercore(ram)
  const writerB = new Hypercore(ram)
  const writerC = new Hypercore(ram)

  const base = new Autobase({
    inputs: [writerA, writerB, writerC],
    localOutput: output
  })

  const isolate = new Autoisolate(script, { autobase: base })
  await isolate.ready()

  // Create three independent forks
  for (let i = 0; i < 1; i++) {
    await base.append(`a${i}`, await base.latest(writerA), writerA)
  }
  for (let i = 0; i < 2; i++) {
    await base.append(`b${i}`, await base.latest(writerB), writerB)
  }
  for (let i = 0; i < 3; i++) {
    await base.append(`c${i}`, await base.latest(writerC), writerC)
  }

  const outputNodes = await linearizedValues(base.view)
  const expected = bufferize(['A0', 'B1', 'B0', 'C2', 'C1', 'C0'])

  outputNodes.forEach((v, i) => t.is(true, v.value.equals(expected[i])))

  await isolate.destroy()

  t.end()
})

test('mapping into batches yields the correct clock on reads', async t => {
  const output = new Hypercore(ram)
  const writerA = new Hypercore(ram)
  const writerB = new Hypercore(ram)
  const writerC = new Hypercore(ram)

  const base = new Autobase({
    inputs: [writerA, writerB, writerC],
    localOutput: output
  })

  const isolate = new Autoisolate(script, { autobase: base })
  await isolate.ready()

  // Create three independent forks
  await base.append(['a0'], [], writerA)
  await base.append(['b0', 'b1'], [], writerB)
  await base.append(['c0', 'c1', 'c2'], [], writerC)

  const outputNodes = await linearizedValues(base.view)
  const expected = bufferize(['A0', 'B1', 'B0', 'C2', 'C1', 'C0'])

  outputNodes.forEach((v, i) => t.is(true, v.value.equals(expected[i])))

  await isolate.destroy()

  t.end()
})
