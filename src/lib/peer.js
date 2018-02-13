import net from 'net'
import EventEmitter from 'events'
import {Buffer} from 'safe-buffer'

class Host {
  constructor(host, port) {
    this._host = host
    this._port = port
  }

  get host() {
    return this._host
  }

  get port() {
    return this._port
  }
}

export default class Peer extends EventEmitter {
  constructor(host, port) {
    super()
    this.MAX_RECEIVE_BUFFER = 1024 * 1024 * 10
    this.state = 'new'
    this.lastSeen = false

    if (!(this.host instanceof Host)) {
      this.host = new Host(host, port)
    }
  }

  _changeState(newState) {
    const oldState = this.state
    this.state = newState
    this.emit('stateChange', {new: newState, old: oldState})
  }

  connect(socket) {
    this._changeState('connecting')
    if (typeof socket === 'undefined' || !(socket instanceof net.Socket)) {
      socket = net.createConnection(
        this.host.port,
        this.host.host,
        this.handleConnect.bind(this)
      )
    } else {
      this._changeState('connected') // Binding to an already-connected socket; will not fire a 'connect' event, but will still fire a 'stateChange' event
    }

    this.socket = socket
    this.socket.on('error', this.handleError.bind(this))
    this.socket.on('data', this.handleData.bind(this))
    this.socket.on('end', this.handleEnd.bind(this))
    this.socket.on('close', this.handleClose.bind(this))

    return this.socket
  }

  disconnect() {
    this._changeState('disconnecting')
    this.socket.end() // Inform the other end we're going away
  }

  destroy() {
    this.socket.destroy()
  }

  getUUID() {
    return `${this.host.host}~${this.host.port}`
  }

  get hostString() {
    return `${this.host.host}:${this.host.port}`
  }

  handleConnect() {
    this._changeState('connected')
    this.emit('connect', {
      peer: this
    })
  }

  handleEnd() {
    this.emit('end', {
      peer: this
    })
  }

  handleError(data) {
    try {
      this.emit('error', {
        peer: this,
        error: data
      })
    } catch (e) {}
  }

  handleClose(hadError) {
    this._changeState('closed')
    this.emit('close', {
      peer: this,
      hadError: hadError
    })
  }

  send(command, data = Buffer.from(0), callback) {
    if (Array.isArray(data)) {
      data = Buffer.from(data)
    }

    this.socket.write(data, null, callback)
  }

  handleData(data) {
    this.lastSeen = Date.now()
    console.log('lastSeen', this.lastSeen)
  }

  handleMessage(message) {
    console.log('message', message)
  }
}
