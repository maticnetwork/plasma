import utils from 'ethereumjs-util'
import {Buffer} from 'safe-buffer'

const BN = utils.BN
const rlp = utils.rlp
const ZeroBalance = new BN(0)
const BlankAddress = utils.bufferToHex(utils.zeros(20))
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

    // total inputs & oututs
    this.totalInputs = 2
    this.totalOutputs = 2
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

  // check if transaction is valid for deposit
  isDepositTx() {
    // invalid if any input is not null
    if (!this._inputNull(0) || !this._inputNull(1)) {
      return false
    }

    // invalid if 1st output is null
    if (this._outputNull(0)) {
      return false
    }

    return true
  }

  async validate(chain) {
    // valid if tx is deposit tx
    if (this.isDepositTx()) {
      return true
    }

    // invalid if both inputs are same
    if (this._inputKey(0) === this._inputKey(1)) {
      return false
    }

    // check while making blocks
    let inputSum = ZeroBalance
    let outputSum = ZeroBalance
    let fees = new BN(this.raw[10])

    let i
    for (i = 0; i < this.totalInputs; i++) {
      const inputTx = await this.getInputTransaction(chain, i)
      if (inputTx) {
        const outputIndex = utils.bufferToInt(this.raw[3 * i + 2]) // this.raw[2] & this.raw[5] ==> can be 0 or 1

        // calculate input sum
        inputSum = inputSum.add(
          // inputTx.raw[7] & inputTx.raw[9] ==> input amount
          new BN(inputTx.raw[7 + outputIndex * 2])
        )

        // check signature
        const recovered = this._getSender(i)
        if (
          !recovered ||
          recovered.compare(inputTx.raw[6 + outputIndex * 2]) !== 0 // inputTx.raw[6] & inputTx.raw[8]
        ) {
          return false
        }
      }
    }

    for (i = 0; i < this.totalOutputs; i++) {
      // calculate output sum
      outputSum = outputSum.add(new BN(this.raw[2 * i + 7]))
    }

    // invalid if sum(inputs) < fees + sum(outputs)
    if (inputSum.lt(fees.add(outputSum))) {
      return false
    }

    return true
  }

  async getInputTransaction(chain, inputIndex) {
    if (this._inputNull(inputIndex)) {
      return null
    }

    const from = inputIndex * 3
    let [blockNumber, txIndex] = this.raw.slice(from, from + 3)
    try {
      txIndex = utils.bufferToInt(txIndex) // parse to int
      const block = await chain.getBlock(new BN(blockNumber).toNumber())
      if (block.transactions.length > utils.bufferToInt(txIndex)) {
        return block.transactions[txIndex]
      }
    } catch (e) {}
    return null
  }

  getSender1() {
    return this._getSender(0)
  }

  getSender2() {
    return this._getSender(1)
  }

  _getSender(i) {
    if (this._inputNull(i)) {
      return null
    }

    const vrs = utils.fromRpcSig(this.raw[11 + i]) // parse {v,r,s} from sig
    return utils.pubToAddress(
      utils.ecrecover(this.hash(false), vrs.v, vrs.r, vrs.s)
    )
  }

  //
  // utils methods
  //

  _inputKey(inputIndex) {
    return this.raw
      .slice(inputIndex * 3, 3)
      .map(v => utils.bufferToInt(v).toString())
      .join('-')
  }

  _inputNull(inputIndex) {
    const from = inputIndex * 3
    return this.raw.slice(from, from + 3).every(v => utils.bufferToInt(v) === 0)
  }

  _outputNull(outputIndex) {
    const from = 6 + outputIndex * 2
    return (
      utils.bufferToHex(this.raw[from]) === BlankAddress &&
      new BN(this.raw[from + 1]).isZero()
    )
  }
}
