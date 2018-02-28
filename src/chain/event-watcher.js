import utils from 'ethereumjs-util'

import config from '../config'

const BN = utils.BN
const Zero = new BN(0)

export default class EventWatcher {
  constructor(web3, contract, db, options = {}) {
    this.options = options
    this.web3 = web3
    this.db = db
    this.contract = contract

    this._blockEventName = '__block__'
    this._events = {}
    this._checker = null
  }

  onBlock(fn) {
    if (!this._events[this._blockEventName]) {
      this._events[this._blockEventName] = []
    }

    this._events[this._blockEventName].push(fn)
  }

  on(name, fn) {
    if (!this._events[name]) {
      this._events[name] = []
    }

    this._events[name].push(fn)
  }

  start() {
    this._checkNewBlock()
  }

  stop() {
    clearTimeout(this._checker)
  }

  async _checkNewBlock() {
    this._checker = setTimeout(() => {
      this._checkNewBlock()
    }, 5000)

    let lastBlock = Zero
    try {
      lastBlock = new BN(
        await this.db.get(Buffer.concat([config.prefixes.latestRootBlock]))
      )
    } catch (e) {}

    // get number
    lastBlock = lastBlock.toNumber()
    let blockNumber = new BN(await this.web3.eth.getBlockNumber()).toNumber()
    if (blockNumber > lastBlock) {
      for (let i = lastBlock; i <= blockNumber; i++) {
        console.log('New root block found', i)
        await this._broadcastBlockEvents(new BN(i))
      }
    }
  }

  async _broadcastBlockEvents(blockNumber) {
    // put latest block on details
    await this.db.put(
      Buffer.concat([config.prefixes.latestRootBlock]),
      blockNumber.toBuffer()
    )

    const blockListeners = this._events[this._blockEventName] || []
    blockListeners.forEach(fn => {
      fn(blockNumber.toNumber())
    })

    const events = await this.contract.getPastEvents('allEvents', {
      fromBlock: blockNumber.toNumber(),
      toBlock: blockNumber.toNumber()
    })
    events.forEach(obj => {
      const listeners = this._events[obj.event] || []
      listeners.forEach(fn => {
        fn(obj)
      })
    })
  }
}
