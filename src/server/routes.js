import utils from 'ethereumjs-util'
import {Router} from 'express'
import {Validator} from 'jsonschema'

import chain from '../chain'
import {getAllUTXOs, getTxByHash} from '../chain/manager'

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

  async getUTXOs([address]) {
    return getAllUTXOs(address)
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

  const fn = methods[data.method]
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
