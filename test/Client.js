import utils from 'ethereumjs-util'
import chai from 'chai'
import chaiHttp from 'chai-http'
import {mineToBlockHeight, waitFor} from './helpers/utils'
import {generateFirstWallets} from './helpers/wallets'

import Transaction from '../src/chain/transaction'
import config from '../src/config'

let RootChain = artifacts.require('./RootChain.sol')

const BN = utils.BN
const rlp = utils.rlp

chai.use(chaiHttp)

const printReceiptEvents = receipt => {
  receipt.logs.forEach(l => {
    console.log(JSON.stringify(l.args))
  })
}

// check end point
const endPoint = `http://localhost:${config.app.port}`
const getDepositTx = (wallet, value) => {
  return new Transaction([
    new Buffer([]), // block number 1
    new Buffer([]), // tx number 1
    new Buffer([]), // previous output number 1 (input 1)
    new Buffer([]), // block number 2
    new Buffer([]), // tx number 2
    new Buffer([]), // previous output number 2 (input 2)

    utils.toBuffer(wallet.getAddressString()), // output address 1
    value.toArrayLike(Buffer, 'be', 32), // value for output 2

    utils.zeros(20), // output address 2
    new Buffer([]), // value for output 2

    new Buffer([]) // fee
  ])
}

const getTransferTx = (from, to, pos, value) => {
  const tx = new Transaction([
    utils.toBuffer(pos[0]), // block number 1
    utils.toBuffer(pos[1]), // tx number 1
    utils.toBuffer(pos[2]), // previous output number 1 (input 1)
    new Buffer([]), // block number 2
    new Buffer([]), // tx number 2
    new Buffer([]), // previous output number 2 (input 2)

    utils.toBuffer(to.getAddressString()), // output address 1
    value.toArrayLike(Buffer, 'be', 32), // value for output 2

    utils.zeros(20), // output address 2
    new Buffer([]), // value for output 2

    new Buffer([]) // fee
  ])
  tx.sign1(from.getPrivateKey())
  return tx
}

const value = new BN(web3.toWei(1, 'ether'))
const mnemonics =
  'clock radar mass judge dismiss just intact mind resemble fringe diary casino'
const wallets = generateFirstWallets(mnemonics, 5)

// client
contract('Root chain - client', async function(accounts) {
  describe('Client', async function() {
    let rootChainContract

    before(async function() {
      // get contract from address
      rootChainContract = RootChain.at(config.chain.rootChainContract)
    })

    it('deposit', async function() {
      // draft deposit tx with 1 ether
      const depositor = wallets[0]
      const depositTx = getDepositTx(depositor, value)
      const depositTxBytes = utils.bufferToHex(depositTx.serializeTx())

      // deposit
      const receipt = await rootChainContract.deposit(depositTxBytes, {
        gas: 200000,
        from: depositor.getAddressString(),
        value: value.toString() // 1 value
      })
      // console.log(receipt)

      // wait for 5 sec (give time to sync chain. TODO fix it)
      await waitFor(10000)
    })

    it('transfer', async function() {
      // draft deposit tx with 1 ether
      const from = wallets[0] // account 1
      const to = wallets[1] // account 2

      let response = await chai
        .request(endPoint)
        .post('/')
        .send({
          jsonrpc: '2.0',
          method: 'plasma_getUTXOs',
          params: [from.getAddressString()],
          id: 1
        })
      chai.expect(response).to.be.json
      chai.expect(response).to.have.status(200)
      chai
        .expect(response.body.result.length)
        .to.be.above(0, 'No UTXOs to transfer')

      const {blockNumber, txIndex, outputIndex} = response.body.result[0]
      const transferTx = getTransferTx(
        from,
        to,
        [blockNumber, txIndex, outputIndex], // pos
        value
      )
      const transferTxBytes = utils.bufferToHex(transferTx.serializeTx(true)) // include signature

      // broadcast transfer tx
      response = await chai
        .request(endPoint)
        .post('/')
        .send({
          jsonrpc: '2.0',
          method: 'plasma_sendTx',
          params: [transferTxBytes],
          id: 1
        })
      chai.expect(response).to.be.json
      chai.expect(response).to.have.status(200)
      chai.expect(response.body.result).to.not.equal('0x')
    })

    it('mine more blocks', async function() {
      await mineToBlockHeight(web3.eth.blockNumber + 7)

      // wait for 10 sec (give time to sync chain. TODO fix it)
      await waitFor(10000)
    })

    it('withdraw', async function() {
      const withdrawer = wallets[1]

      // fetch utxos
      let response = await chai
        .request(endPoint)
        .post('/')
        .send({
          jsonrpc: '2.0',
          method: 'plasma_getUTXOs',
          params: [withdrawer.getAddressString()],
          id: 1
        })
      chai.expect(response).to.be.json
      chai.expect(response).to.have.status(200)
      chai
        .expect(response.body.result.length)
        .to.be.above(0, 'No UTXOs to withdraw')

      const {blockNumber, txIndex, outputIndex, tx} = response.body.result[0]
      const exitTx = new Transaction(tx)
      let merkleProofResponse = await chai
        .request(endPoint)
        .post('/')
        .send({
          jsonrpc: '2.0',
          method: 'plasma_getMerkleProof',
          params: [parseInt(blockNumber), parseInt(txIndex)],
          id: 1
        })
      chai.expect(response).to.be.json
      chai.expect(response).to.have.status(200)

      const {
        proof: merkleProof,
        root: childBlockRoot
      } = merkleProofResponse.body.result

      const sigs = utils.bufferToHex(
        Buffer.concat([
          exitTx.sig1,
          exitTx.sig2,
          exitTx.confirmSig(
            utils.toBuffer(childBlockRoot),
            wallets[0].getPrivateKey() // attested transaction from sender to receiver
          )
        ])
      )

      // start exit
      const receipt = await rootChainContract.startExit(
        parseInt(blockNumber) * 1000000000 +
          parseInt(txIndex) * 10000 +
          parseInt(outputIndex),
        utils.bufferToHex(exitTx.serializeTx(false)), // serialize without signature
        merkleProof,
        sigs,
        {
          gas: 500000,
          from: withdrawer.getAddressString()
        }
      )
      // console.log(receipt)
    })
  })
})
