import utils from 'ethereumjs-util'
import {Buffer} from 'safe-buffer'
import Web3 from 'web3'

import config from './config'
import Transaction from './chain/transaction'
import chain from './chain'
import RootChain from '../build/contracts/RootChain'
import keyPair from '../test/keypair'

const web3 = new Web3(config.chain.web3Provider)
const BN = utils.BN
const value = new BN(web3.utils.toWei('1', 'ether'))

// key pair
keyPair.key1 = utils.toBuffer(keyPair.key1)
const owner = keyPair.address1

const rootChainContract = new web3.eth.Contract(
  RootChain.abi,
  config.chain.rootChainContract
)

const depositTx = new Transaction([
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

const transferTx = new Transaction([
  utils.toBuffer(1), // block number 1
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

async function deposit() {
  let gas = await rootChainContract.methods
    .deposit(utils.bufferToHex(depositTx.serializeTx()))
    .estimateGas({
      from: owner,
      value: value
    })

  let tx = await rootChainContract.methods
    .deposit(utils.bufferToHex(depositTx.serializeTx()))
    .send({
      gas: gas,
      from: owner,
      value: value
    })

  // transferTx.sign1(keyPair.key1)
  // console.log(utils.bufferToHex(transferTx.serializeTx(true))) // include signature
}

deposit()
