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
        result.push(tx.toJSON(true))
      })
      .on('error', function(err) {
        reject(err)
      })
      .on('end', function() {
        resolve(result)
      })
  })
}

export async function getTxByHash(txHash) {
  if (!txHash) {
    return null
  }

  const hashBuffer = utils.toBuffer(txHash)
  const d = await chain.detailsDb.get(
    Buffer.concat([config.prefixes.tx, hashBuffer]),
    {
      keyEncoding: 'binary',
      valueEncoding: 'binary'
    }
  )

  return new Transaction(rlp.decode(d))
}
