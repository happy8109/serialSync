const assert = require('assert');
const PacketCodec = require('../src/core/transport/PacketCodec');

console.log('Running PacketCodec Tests...');

// Test 1: CRC-16 Calculation
{
    console.log('Test 1: CRC-16 Calculation');
    const buffer = Buffer.from('123456789');
    // CRC-16/XMODEM of "123456789" is 0x31C3
    const crc = PacketCodec.crc16(buffer);
    assert.strictEqual(crc, 0x31C3, `Expected 0x31C3, got 0x${crc.toString(16)}`);
    console.log('  PASS');
}

// Test 2: COBS Encoding/Decoding
{
    console.log('Test 2: COBS Encoding/Decoding');
    const cases = [
        Buffer.from([0x00]),
        Buffer.from([0x00, 0x00]),
        Buffer.from([0x11, 0x22, 0x00, 0x33]),
        Buffer.from([0x11, 0x22, 0x33, 0x44]),
        Buffer.alloc(300).fill(0x01) // Long buffer > 254
    ];

    cases.forEach((input, index) => {
        const encoded = PacketCodec.cobsEncode(input);
        // Encoded buffer should not contain 0x00
        assert.ok(!encoded.includes(0x00), `Case ${index}: Encoded data contains 0x00`);

        const decoded = PacketCodec.cobsDecode(encoded);
        assert.deepStrictEqual(decoded, input, `Case ${index}: Decode mismatch`);
    });
    console.log('  PASS');
}

// Test 3: Frame Encoding/Decoding
{
    console.log('Test 3: Frame Encoding/Decoding');
    const type = 0x10; // MSG_TEXT
    const seq = 12345;
    const body = Buffer.from('Hello SerialSync v2.0');

    // Encode
    const packet = PacketCodec.encode(type, seq, body);

    // Packet should end with 0x00
    assert.strictEqual(packet[packet.length - 1], 0x00, 'Packet must end with 0x00');

    // Decode (remove trailing 0x00 first)
    const cobsData = packet.slice(0, packet.length - 1);
    const decoded = PacketCodec.decode(cobsData);

    assert.strictEqual(decoded.type, type, 'Type mismatch');
    assert.strictEqual(decoded.seq, seq, 'Seq mismatch');
    assert.deepStrictEqual(decoded.body, body, 'Body mismatch');
    console.log('  PASS');
}

// Test 4: Error Handling
{
    console.log('Test 4: Error Handling');

    // CRC Error
    const type = 0x10;
    const seq = 1;
    const body = Buffer.from('Test');
    const packet = PacketCodec.encode(type, seq, body);
    const cobsData = packet.slice(0, packet.length - 1);

    // Corrupt the data (flip a bit in the body)
    // COBS encoded data structure is complex, so we decode, corrupt, encode back to simulate transmission error
    // Or simpler: just corrupt the COBS data and hope it decodes to something with bad CRC
    // Let's try corrupting the raw COBS data. 
    // Note: Corrupting COBS data might cause COBS decode error OR CRC error. Both are valid failures.

    // Let's simulate a CRC error specifically:
    // 1. Construct raw frame
    // 2. Calculate CRC
    // 3. Change CRC
    // 4. Encode COBS

    // Actually, let's just try to decode a buffer that we know has bad CRC
    // We can use the internal helper logic if we exposed it, but we only have public APIs.
    // Let's manually construct a bad packet.

    // Valid packet
    const validRaw = Buffer.concat([
        Buffer.from([0x01, 0x00, 0x01, 0x00, 0x01, 0xAA]), // Type, Seq, Len, Body
        Buffer.from([0x00, 0x00]) // Dummy CRC
    ]);
    const validCobs = PacketCodec.cobsEncode(validRaw);

    try {
        PacketCodec.decode(validCobs);
        assert.fail('Should throw CRC error');
    } catch (e) {
        assert.ok(e.message.includes('CRC Mismatch'), 'Should be CRC error');
    }

    console.log('  PASS');
}

console.log('All Tests Passed!');
