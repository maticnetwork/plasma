import utils from 'ethereumjs-util'

import assertRevert from './helpers/assertRevert'

// import chain components
import Transaction from '../src/chain/transaction'

// require root chain
let RootChain = artifacts.require('./RootChain.sol')

const BN = utils.BN
const keyPair = require('./keypair')

contract('Root chain', function(accounts) {
  describe('deposit', async function() {
    let rootChain
    let owner

    // before task
    before(async function() {
      rootChain = await RootChain.new({from: accounts[0]})
      owner = keyPair.address1 // same as accounts[0]
    })

    it('should allow user to deposit ETH into plasma chain', async function() {
      const value = new BN(web3.toWei(1, 'ether'))
      const tx = new Transaction([
        new Buffer([]), // block number 1
        new Buffer([]), // tx number 1
        new Buffer([]), // previous output number 1 (input 1)
        new Buffer([]), // block number 2
        new Buffer([]), // tx number 2
        new Buffer([]), // previous output number 2 (input 2)

        Buffer.from(utils.stripHexPrefix(owner), 'hex'), // output address 1
        value.toArrayLike(Buffer, 'be', 32), // value for output 2

        utils.zeros(20), // output address 2
        new Buffer([]), // value for output 2

        new Buffer([]) // fee
      ])

      // serialize tx bytes
      const txBytes = utils.addHexPrefix(tx.serializeTx().toString('hex'))

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
  })
})
