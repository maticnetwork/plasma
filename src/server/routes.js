import utils from 'ethereumjs-util'
import {Router} from 'express'
import {Validator} from 'jsonschema'

import chain from '../chain'
import {getAllUTXOs, getTxByHash, getTxByPos} from '../chain/manager'

// RPC schema and validator
const rpcSchema = {
  id: '/RpcInput',
  type: 'object',
  properties: {
    jsonrpc: {type: 'string'},
    method: {type: 'string', required: true},
    params: {type: 'array', required: true},
    id: {type: 'number'}
  }
}
const rpcValidator = new Validator()

// create router
const routes = Router()

const methods = {
  async getLatestBlockNumber() {
    const blockDetails = await chain.getLatestHead()
    if (blockDetails) {
      return parseInt(blockDetails.number.toString('hex'), 16).toString()
    }

    return null
  },

  async getLatestBlock() {
    const blockDetails = await chain.getLatestHead()
    if (blockDetails) {
      const obj = await chain.getBlock(utils.toBuffer(blockDetails.hash))
      if (obj) {
        return obj.toJSON(true)
      }
    }

    return null
  },

  async getBlockByNumber([blockNumber]) {
    const obj = await chain.getBlock(blockNumber)
    if (obj) {
      return obj.toJSON(true)
    }

    return null
  },

  async getBlockByHash([blockHash]) {
    const obj = await chain.getBlock(utils.toBuffer(blockHash))
    if (obj) {
      return obj.toJSON(true)
    }

    return null
  },

  async sendTx([txBytes]) {
    const hash = await chain.addTx(txBytes)
    return utils.bufferToHex(hash)
  },

  async getTxByHash([txHash]) {
    const obj = await getTxByHash(txHash)
    if (obj) {
      return obj.toJSON(true)
    }

    return null
  },

  async getTxByPos([address, blockNumber, txIndex, outputIndex]) {
    const obj = await getTxByPos(address, blockNumber, txIndex, outputIndex)
    if (obj) {
      return obj.toJSON(true)
    }

    return null
  },

  async getUTXOs([address]) {
    return getAllUTXOs(address)
  },

  async getMerkleProof([blockNumber, txIndex]) {
    const block = await chain.getBlock(blockNumber)
    if (block && !isNaN(txIndex)) {
      const obj = block.getMerkleProof(txIndex)
      if (obj) {
        return {
          root: utils.bufferToHex(obj.root),
          leaf: utils.bufferToHex(obj.leaf),
          proof: utils.bufferToHex(obj.proof)
        }
      }
    }
    return null
  }
}

/**
 * POST RPC data
 */
routes.post('/', (req, res) => {
  const data = req.body
  const v = rpcValidator.validate(data, rpcSchema)
  if (v.errors && v.errors.length > 0) {
    return res.status(400).json({
      code: 'input-error',
      message: v.errors[0].stack
    })
  }

  if (!data.method.startsWith('plasma_')) {
    return res.status(400).json({
      code: 'input-error',
      message: 'Invalid method name'
    })
  }

  const method = data.method.split('plasma_')[1]
  const fn = methods[method]
  if (!fn) {
    return res.status(404).json({
      message: 'No method found.',
      error: true
    })
  }

  fn(data.params)
    .then(result => {
      return res.json({
        id: data.id,
        jsonrpc: data.jsonrpc,
        result: result
      })
    })
    .catch(e => {
      return res.status(400).json({
        message: e.toString(),
        error: true
      })
    })
})

export default routes
