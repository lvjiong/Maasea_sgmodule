// refer https://github.com/davidzeng0/innertube/blob/main/googlevideo/ump.md
/* eslint-disable */

// @ts-nocheck
import CryptoJS from 'crypto-js'

export class UmpReader {
  constructor (buffer) {
    this.buffer = buffer
    this.offset = 0
  }

  readU8 () {
    const byte = this.buffer[this.offset]
    this.offset += 1
    return byte
  }

  readBytes (size) {
    const bytes = this.buffer.slice(this.offset, this.offset + size)
    this.offset += size
    return bytes
  }

  varIntSize (byte) {
    let size = 0
    for (let shift = 1; shift <= 5; shift++) {
      if ((byte & (128 >> (shift - 1))) === 0) {
        size = shift
        break
      }
    }
    if (size < 1 || size > 5) {
      throw new Error('Invalid size')
    }
    return size
  }

  readVarInt () {
    const prefix = this.readU8()
    const size = this.varIntSize(prefix)

    let shift = 0
    let result = 0

    if (size !== 5) {
      shift = 8 - size
      const mask = (1 << shift) - 1
      result |= prefix & mask
    }

    for (let i = 1; i < size; i++) {
      const byte = this.readU8()
      result |= byte << shift
      shift += 8
    }

    return result
  }

  readPart () {
    const type = this.readVarInt()
    const size = this.readVarInt()
    const data = this.readBytes(size)

    return {
      data,
      type,
    }
  }

  hasNext () {
    return this.offset < this.buffer.length
  }

}

export class UmpWriter {
  constructor () {
    this.buffer = new Uint8Array(1024)  // 初始大小设为1024，可以根据需要调整
    this.length = 0
  }

  clearBuffer () {
    this.buffer = new Uint8Array(1024) // Reinitialize the buffer to the original size
    this.length = 0 // Reset the length to 0
  }

  expandBuffer (additionalSize) {
    if (this.length + additionalSize > this.buffer.length) {
      let newBuffer = new Uint8Array(
        Math.max(this.buffer.length * 2, this.length + additionalSize)) // 确保总是足够大
      newBuffer.set(this.buffer) // 复制旧数据到新缓冲区
      this.buffer = newBuffer
    }
  }

  writeU8 (value) {
    this.expandBuffer(1)
    this.buffer[this.length] = value & 0xFF
    this.length++
  }

  writeBytes (bytes) {
    this.expandBuffer(bytes.length)
    this.buffer.set(bytes, this.length)
    this.length += bytes.length
  }

  writeVarInt (value) {
    let size = 1
    while (value >= 1 << (7 * size)) {
      size++
    }
    if (size === 1) {
      this.writeU8(value)
    } else if (size === 2) {
      this.writeU8((value & 0x3F) | 0x80)
      this.writeU8(value >> 6)
    } else if (size === 3) {
      this.writeU8((value & 0x1F) | 0xC0)
      this.writeU8((value >> 5) & 0xFF)
      this.writeU8(value >> 13)
    } else if (size === 4) {
      this.writeU8((value & 0x0F) | 0xE0)
      this.writeU8((value >> 4) & 0xFF)
      this.writeU8((value >> 12) & 0xFF)
      this.writeU8(value >> 20)
    } else {
      this.writeU8(0xF0)
      this.writeU8(value & 0xFF)
      this.writeU8((value >> 8) & 0xFF)
      this.writeU8((value >> 16) & 0xFF)
      this.writeU8(value >> 24)
    }

  }

  writePart (part) {
    this.writeVarInt(part.type)
    this.writeVarInt(part.data.length)
    this.writeBytes(part.data)
  }

  // writePart (type, data) {
  //   this.writeVarInt(type)
  //   this.writeVarInt(data.length)
  //   this.writeBytes(data)
  // }

  getBuffer () {
    return this.buffer.slice(0, this.length)
  }
}

export class Cipher {
  constructor (clientKey) {
    this.aesKey = this.u8ToWA(clientKey.slice(0, 16))
    this.hmacKey = this.u8ToWA(clientKey.slice(16))
  }

  waToU8 (wordArray) {
    const dataArray = new Uint8Array(wordArray.sigBytes)
    for (let i = 0x0; i < wordArray.sigBytes; i++) {
      dataArray[i] = wordArray.words[i >>> 0x2] >>> 0x18 - i % 0x4 * 0x8 & 0xff
    }
    return dataArray
  }

  u8ToWA (u8Array) {
    return CryptoJS.lib.WordArray.create(u8Array)
  }

  hmacSha256 (data) {
    const hmacSha256 = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256,
      this.hmacKey)
    hmacSha256.update(data)
    hmacSha256.update(this.iv)
    return hmacSha256.finalize()
  }

  decrypt (message) {
    this.iv = this.u8ToWA(message.iv)
    const receivedHmac = this.u8ToWA(message.hmac)
    const encryptedData = this.u8ToWA(message.encryptedContent)

    const calculateHmac = this.hmacSha256(encryptedData)

    if (calculateHmac.toString() !== receivedHmac.toString()) {
      throw new Error('HMAC verification failed')
    }
    const decryptedData = CryptoJS.AES.decrypt(
      {
        ciphertext: encryptedData,
      },
      this.aesKey,
      {
        iv: this.iv,
        mode: CryptoJS.mode.CTR,
        padding: CryptoJS.pad.NoPadding,
      })
    return this.waToU8(decryptedData)
  }

  encrypt (data) {
    const encryptedData = CryptoJS.AES.encrypt(this.u8ToWA(data), this.aesKey, {
      iv: this.iv,
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding,
    }).ciphertext

    const hmac = this.hmacSha256(encryptedData)
    return {
      encryptedContent: this.waToU8(encryptedData),
      hmac: this.waToU8(hmac),
    }
  }
}