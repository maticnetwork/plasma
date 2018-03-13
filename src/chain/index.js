import Web3 from 'web3'
import utils from 'ethereumjs-util'
import level from 'level'
import EthereumTx from 'ethereumjs-tx'
import {Buffer} from 'safe-buffer'

import config from '../config'
import Block from './block'
import Transaction from './transaction'
import TxPool from './txpool'
import SyncManager from './sync-manager'
import EventWatcher from './event-watcher'
import FixedMerkleTree from '../lib/fixed-merkle-tree'

import RootChain from '../../build/contracts/RootChain.json'

const BN = utils.BN
const rlp = utils.rlp
const defaultDBOptions = {
  keyEncoding: 'binary',
  valueEncoding: 'binary'
}

class Chain {
  constructor(options = {}) {
    this.options = options
    this.blockDb = level(`${this.options.db}/block`, defaultDBOptions)
    this.detailsDb = level(`${this.options.db}/details`, defaultDBOptions)
    this.txPoolDb = level(`${this.options.db}/txPool`, defaultDBOptions)

    // transaction pool
    this.txPool = new TxPool(this.txPoolDb)

    // sync manager
    this.syncManager = new SyncManager(this, this.options.network)

    // create instance for web3
    this.web3 = new Web3(this.options.web3Provider)

    // create root chain contract
    this.parentContract = new this.web3.eth.Contract(
      RootChain.abi,
      this.options.rootChainContract
    )

    //
    // Watchers
    //
    this.eventWatcher = new EventWatcher(
      this.web3,
      this.parentContract,
      this.detailsDb,
      this.options
    )

    // watch root chain's block (and submit block)
    if (this.options.authorizedNode) {
      this._rootBlock = this._rootBlock.bind(this)
      this.eventWatcher.onBlock(this._rootBlock)
    }
  }

  async start() {
    // start sync manager
    await this.syncManager.start()

    // start listening block
    this.eventWatcher.on('ChildBlockCreated', data => {
      const {blockNumber, root} = data.returnValues
      console.log(`New block created, number: ${blockNumber}, root: ${root}`)

      // update block number for last submitted block
      this._updateBlockNumber(root, blockNumber)
    })

    // start listening deposit block
    this.eventWatcher.on('DepositBlockCreated', data => {
      const {blockNumber, root, txBytes} = data.returnValues
      this.addDepositBlock(
        [
          new BN(blockNumber).toArrayLike(Buffer, 'be', 32),
          utils.toBuffer(root)
        ], // header
        [txBytes] // tx list
      )
    })

    // start listening exits and mark them spent
    this.eventWatcher.on('StartExit', data => {
      const {owner, blockNumber, txIndex, outputIndex} = data.returnValues

      // mark utxo spent after 2 sec
      // TODO use better method to mark exited UTXO
      setTimeout(() => {
        this._markUTXOSpent(
          Transaction.keyForUTXO(owner, blockNumber, txIndex, outputIndex)
        )
      }, 2000)
    })

    // start watcher
    this.eventWatcher.start()
  }

  async stop() {
    // stop watching root block number
    this.eventWatcher.stop()

    // stop sync manager
    await this.syncManager.stop()
  }

  async _updateBlockNumber(root, blockNumber) {
    const block = await this.getBlock(utils.toBuffer(root))
    if (block) {
      try {
        // update block number by root
        block.header.number = new BN(blockNumber).toBuffer()

        // put block
        await this.putBlock(block)
      } catch (e) {
        console.log(`Error while updating block details ${blockNumber}`, e)
      }
    }
  }

  _rootBlock(data) {
    const rootBlock = new BN(data).toNumber()
    this._lastBlock = this._lastBlock || rootBlock

    if (rootBlock - this._lastBlock > this.options.blockPeriod) {
      this._lastBlock = rootBlock

      // submit block
      this._submitBlock()
    }
  }

  async _submitBlock() {
    const txs = await this.txPool.popTxs()
    if (txs.length === 0) {
      return
    }

    console.log(`Submitting block with total ${txs.length} transactions`)
    const merkleHashes = txs.map(tx => tx.merkleHash())
    const tree = new FixedMerkleTree(16, merkleHashes)
    const newBlock = new Block([
      [Buffer.from([]), tree.getRoot()], // header
      txs.map(tx => tx.serializeTx(true)) // transactions
    ])

    // put block into db
    await this.putBlock(newBlock)

    // submit block to root chain
    const root = utils.bufferToHex(newBlock.header.root)
    const currentChildBlock = await this.parentContract.methods
      .currentChildBlock()
      .call()
    try {
      await this._sendTransaction({
        gasLimit: 100000,
        to: this.parentContract.options.address,
        data: this.parentContract.methods
          .submitBlock(root, parseInt(currentChildBlock.toString(), 10))
          .encodeABI()
      })
    } catch (e) {
      console.log(`Error while submitting the new root: ${root}`, e)
    }
  }

  async addTx(txBytes, exclude) {
    // get tx
    const tx = new Transaction(rlp.decode(txBytes))

    // tx must not be deposit transaction
    if (tx.isDepositTx()) {
      return
    }

    const isValid = await tx.validate(this)
    if (!isValid) {
      return
    }

    // check if any tx input is already spent or exited
    for (let i = 0; i < tx.totalInputs; i++) {
      const keyForUTXO = tx.keyForUTXOByInputIndex(i)
      if (keyForUTXO) {
        try {
          // check if utxo exist for given key
          await this.detailsDb.get(keyForUTXO)
        } catch (e) {
          // utxo has been spent as no value present
          return
        }

        // check if already exited
        const exitData = await this.parentContract.methods
          .getExit(tx.exitIdByInputIndex(i))
          .call()

        // if exit id > 0, utxo has been exited
        if (+exitData[1] > 0) {
          // mark it spent
          await this._markUTXOSpent(keyForUTXO)
          return
        }
      }
    }

    // add tx to pool
    await this.txPool.push(tx)

    // fetch merkle hash
    const hash = tx.merkleHash()

    // log tx pool entry
    console.log(`New transaction added into pool: ${utils.bufferToHex(hash)}`)

    // broadcast tx to peers
    setTimeout(() => {
      this.syncManager.broadcastNewTx(txBytes, exclude)
    })

    // return merkle hash for reference
    return hash
  }

  async addDepositBlock(header, txs) {
    const depositBlock = new Block(
      [header, txs.map(tx => rlp.decode(tx))],
      true
    )

    // put deposit block into db
    await this.putBlock(depositBlock)
  }

  /**
   *Gets a block by its hash
   * @method getBlock
   * @param {String|Buffer|Number} hash - the sha256 hash of the rlp encoding of the block
   */
  async getBlock(blockTag) {
    const lookupByHash = hash => {
      return this.blockDb
        .get(hash)
        .then(encodedBlock => {
          return new Block(rlp.decode(encodedBlock))
        })
        .catch(e => {})
    }

    const lookupNumberToHash = hexString => {
      const key = new BN(hexString).toString()
      return this.detailsDb.get(key).catch(e => {})
    }

    // determine BlockTag type
    if (Buffer.isBuffer(blockTag)) {
      return lookupByHash(blockTag)
    }

    if (/^[0-9]+$/gi.test(String(blockTag))) {
      const blockHash = await lookupNumberToHash(blockTag)
      if (blockHash) {
        return lookupByHash(blockHash)
      }
    }

    return null
  }

  /**
   * Gets block details by block has
   * @method getDetails
   * @param {String} hash - the sha256 hash of the rlp encoding of the block
   */
  async getDetails(hash) {
    // key will be ['blockDetails', hash]
    const key = Buffer.concat([config.prefixes.blockDetails, hash])
    return this.detailsDb.get(key, {
      valueEncoding: 'json'
    })
  }

  /**
   * Gets a latest block details
   * @method getLatestHead
   */
  async getLatestHead() {
    const key = Buffer.concat([config.prefixes.latestHead])
    return this.detailsDb
      .get(key, {
        valueEncoding: 'json'
      })
      .catch(e => {
        // supress key error for new node
      })
  }

  /**
   * Adds many blocks to the blockchain
   * @method putBlocks
   * @param {array} blocks - the blocks to be added to the blockchain
   */
  async putBlocks(blocks) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      await this.putBlock(b)
    }
  }

  /**
   * Adds a block to the blockchain
   * @method putBlock
   * @param {object} block -the block to be added to the block chain
   */
  async putBlock(blockObj) {
    let block = blockObj
    if (!(block instanceof Block)) {
      block = new Block(block)
    }

    const blockHash = block.hash
    const blockHashHexString = utils.bufferToHex(blockHash)
    const blockNumber = new BN(block.header.number)
    const dbOps = []

    // validate block
    const isValid = await block.validate(this)
    if (!isValid) {
      throw new Error('Invalid block')
    }

    if (!blockNumber.isZero()) {
      // store the block details
      const blockDetails = {
        hash: blockHashHexString,
        number: utils.bufferToHex(block.header.number),
        totalTxs: block.transactions.length,
        header: block.header.toJSON(true)
      }

      // put chain head
      dbOps.push({
        db: 'details',
        type: 'put',
        key: Buffer.concat([config.prefixes.latestHead]),
        valueEncoding: 'json',
        value: blockDetails
      })

      // hash -> details
      dbOps.push({
        db: 'details',
        type: 'put',
        key: Buffer.concat([config.prefixes.blockDetails, blockHash]),
        valueEncoding: 'json',
        value: blockDetails
      })

      // block hash -> block
      dbOps.push({
        db: 'block',
        type: 'put',
        key: blockHash,
        value: block.serialize()
      })

      // number -> hash
      dbOps.push({
        db: 'details',
        type: 'put',
        key: blockNumber.toString(),
        value: blockHash
      })

      // update utxo, deposits etc...
      block.transactions.forEach((tx, txIndex) => {
        // add tx to db, indexed by hash
        dbOps.push({
          db: 'details',
          type: 'put',
          key: Buffer.concat([config.prefixes.tx, tx.merkleHash()]),
          value: tx.serializeTx(true)
        })

        for (let i = 0; i < tx.totalInputs; i++) {
          const sender = tx.senderByInputIndex(i)
          // sender
          if (sender) {
            const [blkNumber, txIndex, oIndex] = tx.positionsByInputIndex(i)
            dbOps.push({
              db: 'details',
              type: 'del',
              key: Buffer.concat([
                config.prefixes.utxo,
                utils.toBuffer(sender), // address
                new BN(blkNumber).toArrayLike(Buffer, 'be', 32), // block number
                new BN(txIndex).toArrayLike(Buffer, 'be', 32), // tx index
                new BN(oIndex).toArrayLike(Buffer, 'be', 32) // output index
              ])
            })
          }
        }

        for (let i = 0; i < tx.totalOutputs; i++) {
          dbOps.push({
            db: 'details',
            type: 'put',
            key: Buffer.concat([
              config.prefixes.utxo,
              tx.ownerByOutputIndex(i), // new owner address
              new BN(block.header.number).toArrayLike(Buffer, 'be', 32), // block number
              new BN(txIndex).toArrayLike(Buffer, 'be', 32), // current tx index
              new BN(i).toArrayLike(Buffer, 'be', 32) // output index
            ]),
            value: tx.serializeTx(true)
          })
        }

        // remove tx from pool
        dbOps.push({
          db: 'txPool',
          type: 'del',
          key: this.txPool.keyForTx(tx)
        })
      })
    }

    // root -> block
    dbOps.push({
      db: 'block',
      type: 'put',
      key: block.header.root,
      value: block.serialize()
    })

    await this._batchDbOps(dbOps)
  }

  async _batchDbOps(dbOps) {
    const blockDbOps = []
    const detailsDbOps = []
    const txPoolDbOps = []
    dbOps.forEach(op => {
      switch (op.db) {
        case 'block':
          blockDbOps.push(op)
          break
        case 'details':
          detailsDbOps.push(op)
          break
        case 'txPool':
          txPoolDbOps.push(op)
          break
        default:
          throw new Error('DB op did not specify known db:', op)
      }
    })

    return Promise.all([
      this.blockDb.batch(blockDbOps),
      this.detailsDb.batch(detailsDbOps),
      this.txPoolDb.batch(txPoolDbOps)
    ])
  }

  async _markUTXOSpent(_keyForUTXO) {
    const keyForUTXO = utils.toBuffer(_keyForUTXO)
    // remove utxo for exited utxo
    return this.detailsDb.del(keyForUTXO)
  }

  async _sendTransaction(options = {}) {
    if (!options.gasLimit) {
      throw new Error('`gasLimit` is required')
    }

    const from = this.options.authority.address
    const [nonce, gasPrice, chainId] = await Promise.all([
      this.web3.eth.getTransactionCount(from, 'pending'),
      this.web3.eth.getGasPrice(),
      this.web3.eth.net.getId()
    ])

    const tx = new EthereumTx({
      from: from,
      to: options.to || '0x',
      data: options.data || '0x',
      value: options.value || '0x',
      gasLimit: utils.bufferToHex(new BN(options.gasLimit).toBuffer()),
      nonce: utils.bufferToHex(new BN(nonce).toBuffer()),
      gasPrice: utils.bufferToHex(new BN(gasPrice).toBuffer()),
      chainId: utils.bufferToHex(new BN(chainId).toBuffer())
    })
    tx.sign(utils.toBuffer(this.options.authority.privateKey))
    return this.web3.eth.sendSignedTransaction(tx.serialize())
  }
}

export default new Chain(config.chain)
