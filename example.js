const ram = require('random-access-memory')
const Hypercore = require('hypercore')
const Autobase = require('autobase')
const Autoisolate = require('.')

const toUppercaseAddress = 'hyp1pqdnvkw95qufp9czn8540f2lazdecn2cht475n08zaz6fkpatq2tshqltq2'

main()

async function main () {
  const localInput = new Hypercore(ram)
  const localOutput = new Hypercore(ram)
  const autobase = new Autobase({ localInput, localOutput, inputs: [localInput] })

  const isolate = new Autoisolate(toUppercaseAddress, { autobase })
  await isolate.ready()

  await autobase.append('hello world')
  const node = await autobase.view.get(0)
  console.log(node.value.toString()) // HELLO WORLD

  await isolate.destroy()
}
