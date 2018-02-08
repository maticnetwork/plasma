import Web3 from 'web3'
import utils from 'ethereumjs-util'
import EthDagger from 'eth-dagger'
import level from 'level'
import EthereumTx from 'ethereumjs-tx'
import {Buffer} from 'safe-buffer'

import config from '../config'
import Block from './block'
import Transaction from './transaction'
import TxPool from './txpool'
import FixedMerkleTree from '../lib/fixed-merkle-tree'

import RootChain from '../../build/contracts/RootChain.json'

const BN = utils.BN
const rlp = utils.rlp

class Chain {
  constructor(options = {}) {
    this.options = options
    this.blockDb = level(`${this.options.db}/block`)
    this.detailsDb = level(`${this.options.db}/details`)
    this.txPool = new TxPool(
      level(`${this.options.db}/txpool`, {
        keyEncoding: 'binary',
        valueEncoding: 'binary'
      })
    )

    // create instance for web3
    this.web3 = new Web3(this.options.web3Provider)

    // create root chain contract
    this.parentContract = new this.web3.eth.Contract(
      RootChain.abi,
      this.options.rootChainContract
    )

    // get dagger contract from web3 contract
    this.daggerObject = new EthDagger(this.options.daggerEndpoint)
    this.parentDaggerContract = this.daggerObject.contract(this.parentContract)

    //
    // Watchers
    //

    // watch root chain's block
    this._rootBlock = this._rootBlock.bind(this)
    this.daggerObject.on('latest:block.number', this._rootBlock)

    // block watcher
    this.blockWatcher = this.parentDaggerContract.events.ChildBlockCreated()

    // deposit block watcher
    this.depositBlockWatcher = this.parentDaggerContract.events.DepositBlockCreated()
  }

  async start() {
    // start listening block
    this.blockWatcher.watch((data, removed) => {
      const {blockNumber, root} = data.returnValues
      console.log(`New block created, number: ${blockNumber}, root: ${root}`)

      // update block number for last submitted block
      this._updateBlockNumber(root, blockNumber)
    })

    // start listening deposit block
    this.depositBlockWatcher.watch((data, removed) => {
      const {blockNumber, root, txBytes} = data.returnValues
      this.addDepositBlock(
        [
          new BN(blockNumber).toArrayLike(Buffer, 'be', 32),
          utils.toBuffer(root)
        ], // header
        [txBytes] // tx list
      )
    })
  }

  async stop() {
    // stop watching root block number
    this.daggerObject.off('latest:block.number', this._rootBlock)

    // stop watching block
    this.blockWatcher.stopWatching()

    // stop watching deposit block
    this.depositBlockWatcher.stopWatching()
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
    try {
      await this._sendTransaction({
        gasLimit: 100000,
        to: this.parentContract.options.address,
        data: this.parentContract.methods.submitBlock(root).encodeABI()
      })
    } catch (e) {
      console.log(`Error while submitting the new root: ${root}`, e)
    }
  }

  async addTx(txBytes) {
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

    // check if any tx input is already spent
    for (let i = 0; i < tx.totalInputs; i++) {
      const sender = tx._getSender(i)
      if (sender) {
        const keyForUTXO = Buffer.concat([
          config.prefixes.utxo,
          utils.toBuffer(sender),
          new BN(tx.raw[i * 3 + 0]).toArrayLike(Buffer, 'be', 32), // block number
          new BN(tx.raw[i * 3 + 1]).toArrayLike(Buffer, 'be', 32), // tx index
          new BN(tx.raw[i * 3 + 2]).toArrayLike(Buffer, 'be', 32) // output index
        ])

        let valueForUTXO = null
        try {
          valueForUTXO = await this.detailsDb.get(keyForUTXO, {
            keyEncoding: 'binary',
            valueEncoding: 'binary'
          })
        } catch (e) {
          return
        }

        if (!valueForUTXO) {
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
        .get(hash, {
          keyEncoding: 'binary',
          valueEncoding: 'binary'
        })
        .then(encodedBlock => {
          return new Block(rlp.decode(encodedBlock))
        })
        .catch(e => {})
    }

    const lookupNumberToHash = hexString => {
      const key = new BN(hexString).toString()
      return this.detailsDb.get(key, {
        valueEncoding: 'binary'
      })
    }

    // determine BlockTag type
    if (Buffer.isBuffer(blockTag)) {
      return lookupByHash(blockTag)
    }

    if (/^[0-9]+$/gi.test(String(blockTag))) {
      const blockHash = await lookupNumberToHash(blockTag)
      return lookupByHash(blockHash)
    }

    return null
  }

  /**
   * Gets a block by its hash
   * @method getBlockInfo
   * @param {String} hash - the sha256 hash of the rlp encoding of the block
   */
  async getDetails(hash) {
    // key will be ['blockDetails', hash]
    const key = Buffer.concat([config.prefixes.blockDetails, hash])
    return this.detailsDb.get(key, {
      keyEncoding: 'binary',
      valueEncoding: 'json'
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

      // hash -> details
      dbOps.push({
        db: 'details',
        type: 'put',
        key: Buffer.concat([config.prefixes.blockDetails, blockHash]),
        keyEncoding: 'binary',
        valueEncoding: 'json',
        value: blockDetails
      })

      // block hash -> block
      dbOps.push({
        db: 'block',
        type: 'put',
        key: blockHash,
        keyEncoding: 'binary',
        valueEncoding: 'binary',
        value: block.serialize()
      })

      // number -> hash
      dbOps.push({
        db: 'details',
        type: 'put',
        key: blockNumber.toString(),
        valueEncoding: 'binary',
        value: blockHash
      })

      // update utxo, deposits etc...
      block.transactions.forEach((tx, txIndex) => {
        // add tx to db, indexed by hash
        dbOps.push({
          db: 'details',
          type: 'put',
          key: Buffer.concat([config.prefixes.tx, tx.merkleHash()]),
          keyEncoding: 'binary',
          valueEncoding: 'binary',
          value: tx.serializeTx(true)
        })

        for (let i = 0; i < tx.totalInputs; i++) {
          const sender = tx._getSender(i)
          // sender
          if (sender) {
            dbOps.push({
              db: 'details',
              type: 'del',
              key: Buffer.concat([
                config.prefixes.utxo,
                utils.toBuffer(sender), // address
                new BN(tx.raw[i * 3 + 0]).toArrayLike(Buffer, 'be', 32), // block number
                new BN(tx.raw[i * 3 + 1]).toArrayLike(Buffer, 'be', 32), // tx index
                new BN(tx.raw[i * 3 + 2]).toArrayLike(Buffer, 'be', 32) // output index
              ]),
              keyEncoding: 'binary',
              valueEncoding: 'binary'
            })
          }
        }

        for (let i = 0; i < tx.totalOutputs; i++) {
          dbOps.push({
            db: 'details',
            type: 'put',
            key: Buffer.concat([
              config.prefixes.utxo,
              tx.raw[i * 2 + 6], // address
              new BN(block.header.number).toArrayLike(Buffer, 'be', 32), // block number
              new BN(txIndex).toArrayLike(Buffer, 'be', 32), // current tx index
              new BN(i).toArrayLike(Buffer, 'be', 32) // output index
            ]),
            keyEncoding: 'binary',
            valueEncoding: 'binary',
            value: tx.serializeTx(true)
          })
        }
      })
    }

    // root -> block
    dbOps.push({
      db: 'block',
      type: 'put',
      key: block.header.root,
      keyEncoding: 'binary',
      valueEncoding: 'binary',
      value: block.serialize()
    })

    await this._batchDbOps(dbOps)
  }

  async _batchDbOps(dbOps) {
    const blockDbOps = []
    const detailsDbOps = []
    dbOps.forEach(op => {
      switch (op.db) {
        case 'block':
          blockDbOps.push(op)
          break
        case 'details':
          detailsDbOps.push(op)
          break
        default:
          throw new Error('DB op did not specify known db:', op)
      }
    })

    return Promise.all([
      this.blockDb.batch(blockDbOps),
      this.detailsDb.batch(detailsDbOps)
    ])
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
