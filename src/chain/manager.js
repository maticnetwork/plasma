import utils from 'ethereumjs-util'
import {Buffer} from 'safe-buffer'

import chain from './index'
import Transaction from './transaction'
import config from '../config'

const rlp = utils.rlp

export async function getAllUTXOs(address) {
  if (!address || !utils.isValidAddress(address)) {
    return []
  }

  const from = Buffer.concat([
    config.prefixes.utxo,
    utils.toBuffer(address),
    Buffer.alloc(32), // block number
    Buffer.alloc(32), // tx index
    Buffer.alloc(32) // output index
  ])

  const to = Buffer.concat([
    config.prefixes.utxo,
    utils.toBuffer(address),
    Buffer.from('ff'.repeat(32), 'hex'), // block number
    Buffer.from('ff'.repeat(32), 'hex'), // tx index
    Buffer.from('ff'.repeat(32), 'hex') // output index
  ])

  return new Promise((resolve, reject) => {
    const result = []
    chain.detailsDb
      .createReadStream({
        gte: from,
        lte: to,
        keyEncoding: 'binary',
        valueEncoding: 'binary'
      })
      .on('data', data => {
        const tx = new Transaction(rlp.decode(data.value))
        const keyData = data.key.slice(-96)
        result.push({
          blockNumber: utils.bufferToHex(keyData.slice(0, 32)),
          txIndex: utils.bufferToHex(keyData.slice(32, 64)),
          outputIndex: utils.bufferToHex(keyData.slice(64)),
          tx: tx.toJSON(true)
        })
      })
      .on('error', function(err) {
        reject(err)
      })
      .on('end', function() {
        resolve(result)
      })
  })
}

export async function getTxByPos(address, blockNumber, txIndex, oIndex) {
  if (!address || !utils.isValidAddress(address)) {
    return null
  }

  try {
    const key = Transaction.keyForUTXO(address, blockNumber, txIndex, oIndex)
    const data = await chain.detailsDb.get(key)
    return new Transaction(rlp.decode(data))
  } catch (e) {
    return null
  }
}

export async function getTxByHash(txHash) {
  if (!txHash) {
    return null
  }

  const hashBuffer = utils.toBuffer(txHash)
  try {
    const d = await chain.detailsDb.get(
      Buffer.concat([config.prefixes.tx, hashBuffer])
    )
    return new Transaction(rlp.decode(d))
  } catch (e) {
    // tx not found
  }

  return null
}
