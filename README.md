# autoisolate

script-addressed [autobase](https://github.com/hypercore-protocol/autobase) executed with [isolated vm](https://github.com/laverdet/isolated-vm).

for building composable autobase-protocols

## usage

```js
const toUppercaseAddress = 'hyp1pqdnvkw95qufp9czn8540f2lazdecn2cht475n08zaz6fkpatq2tshqltq2'

const base = new Autobase(opts)
const isolate = new Autoisolate(toUppercaseAddress, { 
  autobase: base,
  isolate: new Isolate()
})

await isolate.ready()
await base.append('hello world')
const node = await base.view.get(0)

console.log(node.value.toString()) // HELLO WORLD
```

where `toUppercaseAddress` is the the key used to [lookup](https://github.com/hyperswarm/dht#-value-from---await-nodeimmutablegethash-options) the [`apply`](https://github.com/hypercore-protocol/autobase#customizing-views-with-apply) function for an autobase from the DHT

```js
const script = dedent`
  function apply (batch) {
    return batch.map(({ value }) => Buffer.from(Buffer.toString(value).toUpperCase()))
  }
`
const toUppercaseAddress = Autoisolate.encodeScript(script)
const { value } = await dht.immutableGet(toUppercaseAddress)
console.log(script === value.toString()) // true
```
