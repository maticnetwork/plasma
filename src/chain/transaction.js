import utils from 'ethereumjs-util'
import {Buffer} from 'safe-buffer'

// const BN = utils.BN
const rlp = utils.rlp
const getFields = () => [
  {
    name: 'blknum1',
    default: new Buffer([])
  },
  {
    name: 'txindex1',
    default: new Buffer([])
  },
  {
    name: 'oindex1',
    default: new Buffer([])
  },
  {
    name: 'blknum2',
    default: new Buffer([])
  },
  {
    name: 'txindex2',
    default: new Buffer([])
  },
  {
    name: 'oindex2',
    default: new Buffer([])
  },
  {
    name: 'newowner1',
    length: 20,
    default: utils.zeros(20)
  },
  {
    name: 'amount1',
    default: new Buffer([])
  },
  {
    name: 'newowner2',
    length: 20,
    default: utils.zeros(20)
  },
  {
    name: 'amount2',
    default: new Buffer([])
  },
  {
    name: 'fee',
    default: new Buffer([])
  },
  {
    name: 'sig1',
    length: 65,
    default: utils.zeros(65)
  },
  {
    name: 'sig2',
    length: 65,
    default: utils.zeros(65)
  }
]

export default class Transaction {
  constructor(data) {
    utils.defineProperties(this, getFields(), data)
  }

  hash(includeSignature = false) {
    let items
    if (includeSignature) {
      items = this.raw
    } else {
      items = this.raw.slice(0, this.raw.length - 2)
    }

    // create hash
    return utils.rlphash(items)
  }

  merkleHash() {
    return utils.sha3(Buffer.concat([this.hash(false), this.sig1, this.sig2]))
  }

  /**
   * sign a transaction with a given a private key
   * @param {Buffer} privateKey
   */
  sign1(privateKey) {
    const vrs = utils.ecsign(this.hash(false), privateKey)
    this.sig1 = utils.toBuffer(utils.toRpcSig(vrs.v, vrs.r, vrs.s))
    return this.sig1
  }

  /**
   * sign a transaction with a given a private key
   * @param {Buffer} privateKey
   */
  sign2(privateKey) {
    const vrs = utils.ecsign(this.hash(false), privateKey)
    this.sig2 = utils.toBuffer(utils.toRpcSig(vrs.v, vrs.r, vrs.s))
    return this.sig2
  }

  confirmSig(root, privateKey) {
    const vrs = utils.ecsign(
      utils.sha3(Buffer.concat([this.hash(false), this.sig1, this.sig2, root])),
      privateKey
    )
    return utils.toBuffer(utils.toRpcSig(vrs.v, vrs.r, vrs.s))
  }

  serializeTx(includeSignature = false) {
    if (includeSignature) {
      return this.serialize()
    }

    const items = this.raw.slice(0, this.raw.length - 2)
    // create hash
    return rlp.encode(items)
  }
}
