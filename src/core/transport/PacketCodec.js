/**
 * PacketCodec.js
 * 负责协议帧的编解码、COBS 转义与 CRC 校验
 * Protocol v3.1 - 支持链路层 ARQ (FSeq/FAck 追加在帧尾)
 * 
 * 帧结构: Type(1) + Seq(4) + Len(2) + Body(N) + FSeq(2) + FAck(2) + CRC(2)
 *         前 7+N 字节与 v2.1 兼容
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
     * v3.1 帧结构: Type(1) + Seq(4) + Len(2) + Body(N) + FSeq(2) + FAck(2) + CRC(2)
     * @param {number} type 帧类型
     * @param {number} seq 应用层序号
     * @param {Buffer|string} body 帧体
     * @param {number} fSeq 链路帧序号 (0-65535)
     * @param {number} fAck 捎带确认号 (0-65535)
     * @returns {Buffer}
     */
    static encode(type, seq, body = Buffer.alloc(0), fSeq = 0, fAck = 0) {
        if (typeof body === 'string') {
            body = Buffer.from(body, 'utf8');
        } else if (!Buffer.isBuffer(body)) {
            body = Buffer.alloc(0);
        }

        // 1. 构建 Raw Frame: Type(1) + Seq(4) + Len(2) + Body(N) + FSeq(2) + FAck(2)
        const rawLen = 1 + 4 + 2 + body.length + 2 + 2;
        const raw = Buffer.alloc(rawLen);

        let offset = 0;
        raw.writeUInt8(type, offset++);                      // Type
        raw.writeUInt32BE(seq, offset); offset += 4;         // Seq (4字节，与 v2.1 相同位置)
        raw.writeUInt16BE(body.length, offset); offset += 2; // Len (与 v2.1 相同位置)
        body.copy(raw, offset); offset += body.length;       // Body
        raw.writeUInt16BE(fSeq & 0xFFFF, offset); offset += 2; // FSeq (新增，帧尾)
        raw.writeUInt16BE(fAck & 0xFFFF, offset);              // FAck (新增，帧尾)

        // 2. 计算 CRC (整个 Raw Frame)
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
     * v3.1 帧结构: Type(1) + Seq(4) + Len(2) + Body(N) + FSeq(2) + FAck(2) + CRC(2)
     * @param {Buffer} buffer COBS 编码的数据（不含末尾的 0x00）
     * @returns {Object} { type, seq, body, fSeq, fAck }
     */
    static decode(buffer) {
        // 1. COBS 解码
        const decoded = this.cobsDecode(buffer);

        // 2. 长度检查 (v3.1: Type(1) + Seq(4) + Len(2) + FSeq(2) + FAck(2) + CRC(2) = 13 bytes min)
        if (decoded.length < 13) {
            throw new Error('Frame too short');
        }

        // 3. 提取 CRC (最后 2 字节)
        const receivedCrc = decoded.readUInt16BE(decoded.length - 2);
        const dataPayload = decoded.slice(0, decoded.length - 2);

        // 4. 校验 CRC
        const calculatedCrc = this.crc16(dataPayload);
        if (receivedCrc !== calculatedCrc) {
            throw new Error(`CRC Mismatch: expected ${calculatedCrc.toString(16)}, got ${receivedCrc.toString(16)}`);
        }

        // 5. 解析字段
        let offset = 0;
        const type = dataPayload.readUInt8(offset++);                    // Type
        const seq = dataPayload.readUInt32BE(offset); offset += 4;       // Seq
        const len = dataPayload.readUInt16BE(offset); offset += 2;       // Len

        // Body 长度校验: dataPayload 总长 - 已解析的头部(7) - 尾部 FSeq(2) + FAck(2) = Body 长度
        const expectedBodyLen = dataPayload.length - 7 - 4;
        if (len !== expectedBodyLen) {
            throw new Error(`Length Mismatch: header says ${len}, actual body is ${expectedBodyLen}`);
        }

        const body = dataPayload.slice(offset, offset + len); offset += len;

        // 6. 提取 FSeq 和 FAck (帧尾)
        const fSeq = dataPayload.readUInt16BE(offset); offset += 2;
        const fAck = dataPayload.readUInt16BE(offset);

        return { type, seq, body, fSeq, fAck };
    }
}

module.exports = PacketCodec;
