import {Buffer} from 'safe-buffer'
import Transaction from './transaction'

import config from '../config'

export default class TxPool {
  constructor(db) {
    this.db = db
  }

  async push(tx) {
    return this.db.put(this.keyForTx(tx), tx.serializeTx(true))
  }

  async pop(tx) {
    return this.db.del(this.keyForTx(tx))
  }

  async getTxs() {
    const values = []
    await new Promise((resolve, reject) => {
      this.db
        .createReadStream()
        .on('data', data => {
          values.push(new Transaction(data.value))
        })
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          resolve()
        })
    })
    return values
  }

  async popTxs() {
    const batch = this.db.batch()
    const result = []
    await new Promise((resolve, reject) => {
      this.db
        .createReadStream()
        .on('data', data => {
          result.push(new Transaction(data.value))
          batch.del(data.key)
        })
        .on('error', err => {
          reject(err)
        })
        .on('end', () => {
          resolve()
        })
    })
    await batch.write()
    return result
  }

  // get key for tx
  keyForTx(tx) {
    return Buffer.concat([config.prefixes.txpool, tx.merkleHash()])
  }
}
