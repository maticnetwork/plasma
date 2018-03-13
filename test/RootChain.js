/* global assert */

import utils from 'ethereumjs-util'

import assertRevert from './helpers/assertRevert'
import {mineToBlockHeight} from './helpers/utils'
import {generateFirstWallets} from './helpers/wallets'

// import chain components
import Transaction from '../src/chain/transaction'
import FixedMerkleTree from '../src/lib/fixed-merkle-tree'

// require root chain
let RootChain = artifacts.require('./test/mocks/RootChainMock.sol')

const BN = utils.BN
const rlp = utils.rlp

const printReceiptEvents = receipt => {
  receipt.logs.forEach(l => {
    console.log(JSON.stringify(l.args))
  })
}

// generate first 5 wallets
const mnemonics =
  'clock radar mass judge dismiss just intact mind resemble fringe diary casino'
const wallets = generateFirstWallets(mnemonics, 5)

const getDepositTx = (owner, value) => {
  return new Transaction([
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
}

contract('Root chain', function(accounts) {
  describe('deposit and start withdraw:', async function() {
    const value = new BN(web3.toWei(1, 'ether'))

    let rootChain
    let owner
    let depositTx

    // before task
    before(async function() {
      rootChain = await RootChain.new({from: accounts[0]})
      owner = wallets[0].getAddressString() // same as accounts[0]
    })

    it('should allow user to deposit ETH into plasma chain', async function() {
      depositTx = getDepositTx(owner, value)

      // serialize tx bytes
      const txBytes = utils.bufferToHex(depositTx.serializeTx())

      // deposit
      const receipt = await rootChain.deposit(txBytes, {
        from: owner,
        value: value
      })

      assert.equal(receipt.logs.length, 3)
      assert.equal(receipt.logs[0].event, 'ChildBlockCreated')
      assert.equal(receipt.logs[1].event, 'DepositBlockCreated')

      assert.equal(receipt.logs[2].event, 'Deposit')
      assert.equal(receipt.logs[2].args.depositor, owner)
      assert.equal(receipt.logs[2].args.amount.toString(), value.toString())
    })

    it('should allow user to start withdraw ETH from plasma chain', async function() {
      const value = new BN(web3.toWei(1, 'ether'))

      // serialize tx bytes
      const txBytes = utils.bufferToHex(depositTx.serializeTx())

      // deposit
      let [childChainRoot, t] = await rootChain.getChildChain(1)
      childChainRoot = utils.toBuffer(childChainRoot)

      // generate proof
      const merkleHash = depositTx.merkleHash()
      // depositTx.sign1(wallets[0].getPrivateKey()) // sign1
      // depositTx.sign2(wallets[0].getPrivateKey()) // sign2
      const tree = new FixedMerkleTree(16, [merkleHash])
      const proof = utils.bufferToHex(
        Buffer.concat(tree.getPlasmaProof(merkleHash))
      )
      const sigs = utils.bufferToHex(
        Buffer.concat([
          depositTx.sig1,
          depositTx.sig2,
          depositTx.confirmSig(childChainRoot, wallets[0].getPrivateKey())
        ])
      )

      const receipt = await rootChain.startExit(
        1000000000, // exitId = sum([blockNumber * 1000000000, txNumber * 10000, oIndex]) => [1, 0, 0]
        txBytes,
        proof,
        sigs,
        {
          from: owner
        }
      )

      let priority = 1 * 1000000000 + 10000 * 0 + 0
      const [user, amount, pos] = await rootChain.getExit(priority)
      assert.equal(user, owner)
      assert.equal(amount.toString(), value)
      assert.deepEqual(priority, pos.toNumber())

      // trying again shoul fail
      await assertRevert(
        rootChain.startExit(
          1000000000, // exitId = sum([blockNumber * 1000000000, txNumber * 10000, oIndex]) => [1, 0, 0]
          txBytes,
          proof,
          sigs,
          {
            from: owner
          }
        )
      )
    })
  })

  describe('start withdraw with single input:', async function() {
    const value = new BN(web3.toWei(1, 'ether'))

    let rootChain
    let owner
    let depositTx

    // before task
    beforeEach(async function() {
      rootChain = await RootChain.new({from: accounts[0]})
      owner = wallets[0].getAddressString() // same as accounts[0]
    })

    it('should allow user to withdraw', async function() {
      depositTx = getDepositTx(owner, value)

      // serialize tx bytes
      const txBytes = utils.bufferToHex(depositTx.serializeTx())

      // deposit
      await rootChain.deposit(txBytes, {
        from: owner,
        value: value
      })

      let transferTx = new Transaction([
        utils.toBuffer(1), // block number for first input
        new Buffer([]), // tx number for 1st input
        new Buffer([]), // previous output number 1 (as 1st input)
        new Buffer([]), // block number 2
        new Buffer([]), // tx number 2
        new Buffer([]), // previous output number 2 (as 2nd input)

        utils.toBuffer(owner), // output address 1
        value.toArrayLike(Buffer, 'be', 32), // value for output 2

        utils.zeros(20), // output address 2
        new Buffer([]), // value for output 2

        new Buffer([]) // fee
      ])

      // serialize tx bytes
      const transferTxBytes = utils.bufferToHex(transferTx.serializeTx())

      // generate proof
      transferTx.sign1(wallets[0].getPrivateKey()) // sign1
      // transferTx.sign2(wallets[0].getPrivateKey()) // sign2
      const merkleHash = transferTx.merkleHash()
      const tree = new FixedMerkleTree(16, [merkleHash])
      const proof = utils.bufferToHex(
        Buffer.concat(tree.getPlasmaProof(merkleHash))
      )

      const childBlockNumber = (await rootChain.currentChildBlock()).toNumber()
      const lastBlock = web3.eth.blockNumber

      // try again by submitting block
      let receipt = await rootChain.submitBlock(
        utils.bufferToHex(tree.getRoot()),
        childBlockNumber
      )

      let currentChildBlock =
        (await rootChain.currentChildBlock()).toNumber() - 1

      // start exiting
      let [childChainRoot, t] = await rootChain.getChildChain(currentChildBlock)
      childChainRoot = utils.toBuffer(childChainRoot)
      const sigs = utils.bufferToHex(
        Buffer.concat([
          transferTx.sig1,
          transferTx.sig2,
          transferTx.confirmSig(childChainRoot, wallets[0].getPrivateKey())
        ])
      )

      let priority = currentChildBlock * 1000000000 + 10000 * 0 + 0
      // Single input exit
      receipt = await rootChain.startExit(
        priority,
        transferTxBytes,
        proof,
        sigs,
        {
          from: owner
        }
      )

      const [user, amount, posResult] = await rootChain.getExit(priority)
      assert.equal(user, owner)
      assert.equal(amount.toString(), value)
      assert.deepEqual(priority, posResult.toNumber())
    })

    // There is a spectial condition in the MVP spec:
    // "However, if when calling exit, the block that the UTXO was created in is more than 7 days old, then the blknum of the oldest Plasma block that is less than 7 days old is used instead."
    // This condition is needed so that very old UTXOs don't overwrite the tip of the priority queue.
    // If people would submit exits from older and older utxos, then no-one could ever exit, because waiting would start from 0 again and again at the tip of the queue.
    // Yet, this condition also means that old UTXOs (older than 7 days) might receive the same priority, if they exit short after each other and hold the same position in block.
    // This test makes sure that exitId is used instead of priority to store the records, hence avoiding collisions (which existed in previous implementations due to use of priority for hash map key).
    it('should allow utxos with same priority to exit without collision', async function() {
      const value = new BN(web3.toWei(0.1, 'ether'))

      // alice deposits, spends. blocks get mined
      let alice = wallets[0].getAddressString()
      let a_depositTx = getDepositTx(alice, value)
      await rootChain.deposit(utils.bufferToHex(a_depositTx.serializeTx()), {
        from: alice,
        value: value
      })
      let a_transferTx = new Transaction([
        utils.toBuffer(1),
        new Buffer([]),
        new Buffer([]),
        new Buffer([]),
        new Buffer([]),
        new Buffer([]),
        utils.toBuffer(alice),
        value.toArrayLike(Buffer, 'be', 32),
        utils.zeros(20),
        new Buffer([]),
        new Buffer([])
      ])
      const a_transferTxBytes = utils.bufferToHex(a_transferTx.serializeTx())
      a_transferTx.sign1(wallets[0].getPrivateKey())
      const a_merkleHash = a_transferTx.merkleHash()
      const a_tree = new FixedMerkleTree(16, [a_merkleHash])
      const a_proof = utils.bufferToHex(
        Buffer.concat(a_tree.getPlasmaProof(a_merkleHash))
      )
      let blknum = (await rootChain.currentChildBlock()).toNumber()
      await rootChain.submitBlock(utils.bufferToHex(a_tree.getRoot()), blknum)
      const a_blockPos = (await rootChain.currentChildBlock()).toNumber() - 1
      let [childChainRoot] = await rootChain.getChildChain(a_blockPos)
      childChainRoot = utils.toBuffer(childChainRoot)
      const a_sigs = utils.bufferToHex(
        Buffer.concat([
          a_transferTx.sig1,
          a_transferTx.sig2,
          a_transferTx.confirmSig(childChainRoot, wallets[0].getPrivateKey())
        ])
      )

      // bob deposits, spends. blocks get mined
      let bob = wallets[1].getAddressString()
      let b_depositTx = getDepositTx(bob, value)
      await rootChain.deposit(utils.bufferToHex(b_depositTx.serializeTx()), {
        from: bob,
        value: value
      })
      let b_transferTx = new Transaction([
        utils.toBuffer(3),
        new Buffer([]),
        new Buffer([]),
        new Buffer([]),
        new Buffer([]),
        new Buffer([]),
        utils.toBuffer(bob),
        value.toArrayLike(Buffer, 'be', 32),
        utils.zeros(20),
        new Buffer([]),
        new Buffer([])
      ])
      const b_transferTxBytes = utils.bufferToHex(b_transferTx.serializeTx())
      b_transferTx.sign1(wallets[1].getPrivateKey()) // sign1
      const b_merkleHash = b_transferTx.merkleHash()
      const b_tree = new FixedMerkleTree(16, [b_merkleHash])
      const b_proof = utils.bufferToHex(
        Buffer.concat(b_tree.getPlasmaProof(b_merkleHash))
      )

      blknum = (await rootChain.currentChildBlock()).toNumber()
      await rootChain.submitBlock(utils.bufferToHex(b_tree.getRoot()), blknum)
      const b_blockPos = (await rootChain.currentChildBlock()).toNumber() - 1
      let [b_childChainRoot, b_t] = await rootChain.getChildChain(b_blockPos)
      b_childChainRoot = utils.toBuffer(b_childChainRoot)
      const b_sigs = utils.bufferToHex(
        Buffer.concat([
          b_transferTx.sig1,
          b_transferTx.sig2,
          b_transferTx.confirmSig(b_childChainRoot, wallets[1].getPrivateKey())
        ])
      )

      // time passes and blocks move ahead
      // simulated by increase of week old blocks
      // to triger line `priority = priority.mul(Math.max(txPos[0], weekOldBlock));` in RootChain.sol
      await rootChain.incrementWeekOldBlock()
      await rootChain.incrementWeekOldBlock()
      await rootChain.incrementWeekOldBlock()
      await rootChain.incrementWeekOldBlock()

      // alice starts exit
      await rootChain.startExit(
        2000000000,
        a_transferTxBytes,
        a_proof,
        a_sigs,
        {
          from: alice
        }
      )
      const a_exitId = a_blockPos * 1000000000 + 10000 * 0 + 0
      let [user1] = await rootChain.getExit(a_exitId)
      assert.equal(alice, user1)

      // bob starts exit
      await rootChain.startExit(
        4000000000,
        b_transferTxBytes,
        b_proof,
        b_sigs,
        {
          from: bob
        }
      )
      const b_exitId = b_blockPos * 1000000000 + 10000 * 0 + 0
      const [user2] = await rootChain.getExit(b_exitId)
      assert.equal(bob, user2)

      // make sure alice's slot is not overwritten
      ;[user1] = await rootChain.getExit(a_exitId)
      assert.equal(alice, user1)
    })
  })

  describe('start withdraw with two inputs:', async function() {
    const value = new BN(web3.toWei(1, 'ether'))

    let rootChain
    let owner
    let depositTx

    // before task
    before(async function() {
      rootChain = await RootChain.new({from: accounts[0]})
      owner = wallets[0].getAddressString() // same as accounts[0]
    })

    it('should allow user to withdraw', async function() {
      depositTx = getDepositTx(owner, value)

      // deposit 1
      await rootChain.deposit(utils.bufferToHex(depositTx.serializeTx()), {
        from: owner,
        value: value
      })

      const block1 = (await rootChain.currentChildBlock()).toNumber() - 1

      // deposit 2
      await rootChain.deposit(utils.bufferToHex(depositTx.serializeTx()), {
        from: owner,
        value: value
      })

      const block2 = (await rootChain.currentChildBlock()).toNumber() - 1

      let transferTx = new Transaction([
        utils.toBuffer(block1), // block number for first input
        new Buffer([]), // tx number for 1st input
        new Buffer([]), // previous output number 1 (as 1st input)

        utils.toBuffer(block2), // block number 2
        new Buffer([]), // tx number 2
        new Buffer([]), // previous output number 2 (as 2nd input)

        utils.toBuffer(owner), // output address 1
        value.toArrayLike(Buffer, 'be', 32), // value for output 2

        utils.zeros(20), // output address 2
        new Buffer([]), // value for output 2

        new Buffer([]) // fee
      ])

      // serialize tx bytes
      let transferTxBytes = utils.bufferToHex(transferTx.serializeTx())

      // generate proof
      transferTx.sign1(wallets[0].getPrivateKey()) // sign1
      transferTx.sign2(wallets[0].getPrivateKey()) // sign2
      const merkleHash = transferTx.merkleHash()
      const tree = new FixedMerkleTree(16, [merkleHash])
      const proof = utils.bufferToHex(
        Buffer.concat(tree.getPlasmaProof(merkleHash))
      )

      // submit block
      let blknum = (await rootChain.currentChildBlock()).toNumber()
      let receipt = await rootChain.submitBlock(
        utils.bufferToHex(tree.getRoot()),
        blknum
      )

      let currentChildBlock =
        (await rootChain.currentChildBlock()).toNumber() - 1

      // start exiting
      let [childChainRoot, t] = await rootChain.getChildChain(currentChildBlock)
      childChainRoot = utils.toBuffer(childChainRoot)
      const sigs = utils.bufferToHex(
        Buffer.concat([
          transferTx.sig1,
          transferTx.sig2,
          transferTx.confirmSig(childChainRoot, wallets[0].getPrivateKey()),
          transferTx.confirmSig(childChainRoot, wallets[0].getPrivateKey())
        ])
      )

      let priority = currentChildBlock * 1000000000 + 10000 * 0 + 0
      // Single input exit
      receipt = await rootChain.startExit(
        priority,
        transferTxBytes,
        proof,
        sigs,
        {
          from: owner
        }
      )

      const [user, amount, posResult] = await rootChain.getExit(priority)
      assert.equal(user, owner)
      assert.equal(amount.toString(), value)
      assert.deepEqual(priority, posResult.toNumber())
    })
  })

  describe('challenge exit', async function() {
    const value = new BN(web3.toWei(1, 'ether'))

    let rootChain
    let owner
    let depositTx

    // before task
    before(async function() {
      rootChain = await RootChain.new({from: accounts[0]})
      owner = wallets[0].getAddressString() // same as accounts[0]
    })

    it('should allow user to challenge bad tx', async function() {
      //
      // deposit
      //

      depositTx = getDepositTx(owner, value)

      // serialize tx bytes
      let depositTxBytes = utils.bufferToHex(depositTx.serializeTx())

      // deposit
      await rootChain.deposit(depositTxBytes, {
        from: owner,
        value: value
      })

      //
      // exit
      //

      let currentChildBlock = 1
      let merkleHash = depositTx.merkleHash()
      let tree = new FixedMerkleTree(16, [merkleHash])
      let proof = utils.bufferToHex(
        Buffer.concat(tree.getPlasmaProof(merkleHash))
      )
      let childChainRoot = utils.toBuffer(
        (await rootChain.getChildChain(currentChildBlock))[0]
      )
      let confirmSig = depositTx.confirmSig(
        childChainRoot,
        wallets[0].getPrivateKey()
      )
      let sigs = utils.bufferToHex(
        Buffer.concat([depositTx.sig1, depositTx.sig2, confirmSig])
      )

      let receipt = await rootChain.startExit(
        currentChildBlock * 1000000000 + 10000 * 0 + 0,
        depositTxBytes,
        proof,
        sigs
      )

      //
      // transfer
      //

      let transferTx = new Transaction([
        utils.toBuffer(currentChildBlock), // block number for first input
        new Buffer([]), // tx number for 1st input
        new Buffer([]), // previous output number 1 (as 1st input)
        new Buffer([]), // block number 2
        new Buffer([]), // tx number 2
        new Buffer([]), // previous output number 2 (as 2nd input)

        utils.toBuffer(owner), // output address 1
        value.toArrayLike(Buffer, 'be', 32), // value for output 2

        utils.zeros(20), // output address 2
        new Buffer([]), // value for output 2

        new Buffer([]) // fee
      ])

      // serialize tx bytes
      let transferTxBytes = utils.bufferToHex(transferTx.serializeTx())
      transferTx.sign1(wallets[0].getPrivateKey()) // sign1
      merkleHash = transferTx.merkleHash()
      tree = new FixedMerkleTree(16, [merkleHash])
      proof = utils.bufferToHex(Buffer.concat(tree.getPlasmaProof(merkleHash)))

      // submit block
      let blknum = (await rootChain.currentChildBlock()).toNumber()
      receipt = await rootChain.submitBlock(
        utils.bufferToHex(tree.getRoot()),
        blknum
      )

      //
      // challenge exit
      //

      currentChildBlock = 2
      childChainRoot = utils.toBuffer(
        (await rootChain.getChildChain(currentChildBlock))[0]
      )
      confirmSig = transferTx.confirmSig(
        childChainRoot,
        wallets[0].getPrivateKey()
      )
      sigs = utils.bufferToHex(
        Buffer.concat([transferTx.sig1, transferTx.sig2])
      )

      const exitId = (currentChildBlock - 1) * 1000000000 + 10000 * 0 + 0
      receipt = await rootChain.challengeExit(
        currentChildBlock * 1000000000 + 10000 * 0 + 0,
        exitId,
        transferTxBytes,
        proof,
        sigs,
        utils.bufferToHex(confirmSig)
      )

      assert.equal(
        (await rootChain.getExit(exitId))[0].toString(),
        utils.bufferToHex(utils.zeros(20))
      )
    })
  })
})
