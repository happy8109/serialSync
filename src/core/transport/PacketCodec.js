/**
 * PacketCodec.js
 * 负责协议帧的编解码、COBS 转义与 CRC 校验
 * Protocol v2.1
 */

class PacketCodec {
    /**
     * 计算 CRC-16/XMODEM
     * Poly: 0x1021, Init: 0x0000
     * @param {Buffer} buffer 
     * @returns {number}
     */
    static crc16(buffer) {
        let crc = 0x0000;
        for (let i = 0; i < buffer.length; i++) {
            crc ^= (buffer[i] << 8);
            for (let j = 0; j < 8; j++) {
                if (crc & 0x8000) {
                    crc = (crc << 1) ^ 0x1021;
                } else {
                    crc = crc << 1;
                }
            }
        }
        return crc & 0xFFFF;
    }

    /**
     * COBS 编码
     * @param {Buffer} buffer 
     * @returns {Buffer}
     */
    static cobsEncode(buffer) {
        let readIndex = 0;
        let writeIndex = 1;
        let codeIndex = 0;
        let code = 1;

        const encoded = Buffer.alloc(buffer.length + Math.ceil(buffer.length / 254) + 1);

        while (readIndex < buffer.length) {
            if (buffer[readIndex] === 0) {
                encoded[codeIndex] = code;
                code = 1;
                codeIndex = writeIndex++;
                readIndex++;
            } else {
                encoded[writeIndex++] = buffer[readIndex++];
                code++;
                if (code === 0xFF) {
                    encoded[codeIndex] = code;
                    code = 1;
                    codeIndex = writeIndex++;
                }
            }
        }

        encoded[codeIndex] = code;
        return encoded.slice(0, writeIndex);
    }

    /**
     * COBS 解码
     * @param {Buffer} buffer 
     * @returns {Buffer}
     */
    static cobsDecode(buffer) {
        let readIndex = 0;
        let writeIndex = 0;
        let code = 0;
        let i = 0;

        const decoded = Buffer.alloc(buffer.length);

        while (readIndex < buffer.length) {
            code = buffer[readIndex];
            if (readIndex + code > buffer.length && code !== 1) {
                throw new Error('COBS Decode Error: Buffer too short');
            }
            readIndex++;

            for (i = 1; i < code; i++) {
                decoded[writeIndex++] = buffer[readIndex++];
            }

            if (code < 0xFF && readIndex < buffer.length) {
                decoded[writeIndex++] = 0;
            }
        }

        return decoded.slice(0, writeIndex);
    }

    /**
     * 封装帧 (Raw Frame -> CRC -> COBS -> +0x00)
     * @param {number} type 
     * @param {number} seq 
     * @param {Buffer|string} body 
     * @returns {Buffer}
     */
    static encode(type, seq, body = Buffer.alloc(0)) {
        if (typeof body === 'string') {
            body = Buffer.from(body, 'utf8');
        } else if (!Buffer.isBuffer(body)) {
            body = Buffer.alloc(0);
        }

        // 1. 构建 Raw Frame (Type + Seq + Len + Body)
        // TYPE(1) + SEQ(4) + LEN(2) + BODY(N)  -- SEQ 升级为 4 字节以支持大文件
        const rawLen = 1 + 4 + 2 + body.length;
        const raw = Buffer.alloc(rawLen);

        let offset = 0;
        raw.writeUInt8(type, offset++);
        raw.writeUInt32BE(seq, offset); offset += 4;  // 改为 4 字节
        raw.writeUInt16BE(body.length, offset); offset += 2;
        body.copy(raw, offset);

        // 2. 计算 CRC (Type + Seq + Len + Body)
        const crc = this.crc16(raw);

        // 3. 拼接 CRC
        const frameWithCrc = Buffer.concat([raw, Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF])]);

        // 4. COBS 编码
        const cobsEncoded = this.cobsEncode(frameWithCrc);

        // 5. 添加帧定界符 0x00
        return Buffer.concat([cobsEncoded, Buffer.from([0x00])]);
    }

    /**
     * 解析帧 (COBS Data -> Decode -> Check CRC -> Extract)
     * @param {Buffer} buffer COBS 编码的数据（不含末尾的 0x00）
     * @returns {Object} { type, seq, body }
     */
    static decode(buffer) {
        // 1. COBS 解码
        const decoded = this.cobsDecode(buffer);

        // 2. 长度检查 (Type(1) + Seq(4) + Len(2) + CRC(2) = 9 bytes min)
        if (decoded.length < 9) {
            throw new Error('Frame too short');
        }

        // 3. 提取 CRC
        const receivedCrc = decoded.readUInt16BE(decoded.length - 2);
        const dataPayload = decoded.slice(0, decoded.length - 2);

        // 4. 校验 CRC
        const calculatedCrc = this.crc16(dataPayload);
        if (receivedCrc !== calculatedCrc) {
            throw new Error(`CRC Mismatch: expected ${calculatedCrc.toString(16)}, got ${receivedCrc.toString(16)}`);
        }

        // 5. 解析字段
        let offset = 0;
        const type = dataPayload.readUInt8(offset++);
        const seq = dataPayload.readUInt32BE(offset); offset += 4;  // 改为 4 字节
        const len = dataPayload.readUInt16BE(offset); offset += 2;

        if (dataPayload.length - offset !== len) {
            throw new Error(`Length Mismatch: header says ${len}, actual body is ${dataPayload.length - offset}`);
        }

        const body = dataPayload.slice(offset);

        return { type, seq, body };
    }
}

module.exports = PacketCodec;
