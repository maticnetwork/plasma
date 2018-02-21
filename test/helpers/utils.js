/* global web3 */

export async function mineOneBlock() {
  await web3.currentProvider.send({
    jsonrpc: '2.0',
    method: 'evm_mine',
    id: new Date().getTime()
  })
}

export async function waitFor(t = 1000) {
  await new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, t)
  })
}

export async function mineToBlockHeight(targetBlockHeight, t = 1000) {
  while (web3.eth.blockNumber < targetBlockHeight) {
    await mineOneBlock()
    await waitFor(t)
  }
}
