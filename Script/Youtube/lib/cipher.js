import crypto from 'crypto'

export class Cipher {
  constructor (clientKey) {
    this.aesKey = clientKey.slice(0, 16)
    this.hmacKey = clientKey.slice(16)
  }

  decrypt (enPartMessage) {
    this.iv = enPartMessage.iv
    const receivedHmac = enPartMessage.hmac

    const encryptedData = enPartMessage.encryptedContent
    const hmac = crypto.createHmac('sha256', this.hmacKey)
    hmac.update(encryptedData)
    hmac.update(this.iv)

    if (!crypto.timingSafeEqual(hmac.digest(), receivedHmac)) {
      throw new Error('HMAC verification failed')
    }

    const decipher = crypto.createDecipheriv('aes-128-ctr', this.aesKey,
      this.iv)
    return Buffer.concat(
      [decipher.update(encryptedData), decipher.final()])
  }

  encrypt (data) {
    const cipher = crypto.createCipheriv('aes-128-ctr', this.aesKey, this.iv)
    const encryptedData = Buffer.concat([cipher.update(data), cipher.final()])

    const hmac = crypto.createHmac('sha256', this.hmacKey)
    hmac.update(encryptedData)
    hmac.update(this.iv)

    return {
      encryptedContent: encryptedData,
      hmac: hmac.digest(),
    }
  }
}