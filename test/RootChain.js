/* global assert */

import utils from 'ethereumjs-util'

import assertRevert from './helpers/assertRevert'

// import chain components
import Transaction from '../src/chain/transaction'
import FixedMerkleTree from '../src/lib/fixed-merkle-tree'

// require root chain
let RootChain = artifacts.require('./RootChain.sol')

const BN = utils.BN
const rlp = utils.rlp
const keyPair = require('./keypair')
keyPair.key1 = utils.toBuffer(keyPair.key1)

contract('Root chain', function(accounts) {
  describe('deposit and withdraw', async function() {
    const value = new BN(web3.toWei(1, 'ether'))

    let rootChain
    let owner
    let depositTx

    // before task
    before(async function() {
      rootChain = await RootChain.new({from: accounts[0]})
      owner = keyPair.address1 // same as accounts[0]
    })

    it('should allow user to deposit ETH into plasma chain', async function() {
      depositTx = new Transaction([
        new Buffer([]), // block number 1
        new Buffer([]), // tx number 1
        new Buffer([]), // previous output number 1 (input 1)
        new Buffer([]), // block number 2
        new Buffer([]), // tx number 2
        new Buffer([]), // previous output number 2 (input 2)

        utils.toBuffer(owner), // output address 1
        value.toArrayLike(Buffer, 'be', 32), // value for output 2

        utils.zeros(20), // output address 2
        new Buffer([]), // value for output 2

        new Buffer([]) // fee
      ])

      // serialize tx bytes
      const txBytes = utils.bufferToHex(depositTx.serializeTx())

      // deposit
      const receipt = await rootChain.deposit(txBytes, {
        from: owner,
        value: value
      })

      assert.equal(receipt.logs.length, 1)
      assert.equal(receipt.logs[0].event, 'Deposit')
      assert.equal(receipt.logs[0].args.depositor, owner)
      assert.equal(receipt.logs[0].args.amount.toString(), value.toString())
    })

    it('should allow user to start withdraw ETH from plasma chain', async function() {
      const value = new BN(web3.toWei(1, 'ether'))

      // serialize tx bytes
      const txBytes = utils.addHexPrefix(
        depositTx.serializeTx().toString('hex')
      )

      // deposit
      let [childChainRoot, t] = await rootChain.getChildChain(1)
      childChainRoot = utils.toBuffer(childChainRoot)

      // generate proof
      const merkleHash = depositTx.merkleHash()
      // depositTx.sign1(keyPair.key1) // sign1
      // depositTx.sign2(keyPair.key2) // sign2
      const tree = new FixedMerkleTree(16, [merkleHash])
      const proof = utils.bufferToHex(Buffer.concat(tree.getPlasmaProof(0)))
      const sigs = utils.bufferToHex(
        Buffer.concat([
          depositTx.sig1,
          depositTx.sig2,
          depositTx.confirmSig(childChainRoot, keyPair.key1)
        ])
      )

      const receipt = await rootChain.startExit(
        [1, 0, 0], // [blockNumber, txNumber, oIndex]
        txBytes,
        proof,
        sigs,
        {
          from: owner
        }
      )

      const priority = 1 * 1000000000 + 10000 * 0 + 0
      const [user, amount, pos] = await rootChain.getExit(priority)
      assert.equal(user, owner)
      assert.equal(amount.toString(), value)
      assert.deepEqual([1, 0, 0], pos.map(p => p.toNumber()))
    })
  })
})
