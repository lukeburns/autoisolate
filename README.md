# autoisolate

[bech32](https://wiki.trezor.io/Bech32)-addressed [autobase](https://github.com/hypercore-protocol/autobase) executed with [isolated vm](https://github.com/laverdet/isolated-vm)

## usage

```js
const toUppercaseAddress = 'hyp1pqdnvkw95qufp9czn8540f2lazdecn2cht475n08zaz6fkpatq2tshqltq2'

const isolate = new Autoisolate(toUppercaseAddress, { 
  autobase: new Autobase(opts),
  isolate: new Isolate()
})
await isolate.ready()
await base.append('hello world')
const node = await base.view.get(0)

console.log(node.value.toString()) // HELLO WORLD
```
