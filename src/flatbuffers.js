
/* jshint esversion: 6 */

var flatbuffers = {};

flatbuffers.get = (name) => {
    flatbuffers._map = flatbuffers._map || new Map();
    if (!flatbuffers._map.has(name)) {
        flatbuffers._map.set(name, {});
    }
    return flatbuffers._map.get(name);
};

flatbuffers.SIZE_PREFIX_LENGTH = 4;

flatbuffers.Encoding = {
    UTF8_BYTES: 1,
    UTF16_STRING: 2
};

flatbuffers.Long = function(low, high) {
    this.low = low | 0;
    this.high = high | 0;
};

flatbuffers.Long.create = function(low, high) {
    return low == 0 && high == 0 ? flatbuffers.Long.ZERO : new flatbuffers.Long(low, high);
};

flatbuffers.Long.prototype.toFloat64 = function() {
    return (this.low >>> 0) + this.high * 0x100000000;
};

flatbuffers.Long.prototype.equals = function(other) {
    return this.low == other.low && this.high == other.high;
};

flatbuffers.Long.ZERO = new flatbuffers.Long(0, 0);

flatbuffers.Reader = class {

    constructor(buffer) {
        this._buffer = buffer;
        this._position = 0;
        this._dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    get buffer() {
        return this._buffer;
    }

    get position() {
        return this._position;
    }

    int8(offset) {
        return this.uint8(offset) << 24 >> 24;
    }

    uint8(offset) {
        return this._buffer[offset];
    }

    int16(offset) {
        return this._dataView.getInt16(offset, true);
    }

    uint16(offset) {
        return this._dataView.getUint16(offset, true);
    }

    int32(offset) {
        return this._dataView.getInt32(offset, true);
    }

    uint32(offset) {
        return this._dataView.getUint32(offset, true);
    }

    int64(offset) {
        return new flatbuffers.Long(this.int32(offset), this.int32(offset + 4));
    }

    uint64(offset) {
        return new flatbuffers.Long(this.uint32(offset), this.uint32(offset + 4));
    }

    float32(offset) {
        return this._dataView.getFloat32(offset, true);
    }

    float64(offset) {
        return this._dataView.getFloat64(offset, true);
    }

    string(offset, encoding) {
        offset += this.int32(offset);
        const length = this.int32(offset);
        var result = '';
        var i = 0;
        offset += 4;
        if (encoding === flatbuffers.Encoding.UTF8_BYTES) {
            return this._buffer.subarray(offset, offset + length);
        }
        while (i < length) {
            var codePoint;
            // Decode UTF-8
            const a = this.uint8(offset + i++);
            if (a < 0xC0) {
                codePoint = a;
            }
            else {
                const b = this.uint8(offset + i++);
                if (a < 0xE0) {
                    codePoint = ((a & 0x1F) << 6) | (b & 0x3F);
                }
                else {
                    const c = this.uint8(offset + i++);
                    if (a < 0xF0) {
                        codePoint = ((a & 0x0F) << 12) | ((b & 0x3F) << 6) | (c & 0x3F);
                    }
                    else {
                        const d = this.uint8(offset + i++);
                        codePoint = ((a & 0x07) << 18) | ((b & 0x3F) << 12) | ((c & 0x3F) << 6) | (d & 0x3F);
                    }
                }
            }
            // Encode UTF-16
            if (codePoint < 0x10000) {
                result += String.fromCharCode(codePoint);
            }
            else {
                codePoint -= 0x10000;
                result += String.fromCharCode((codePoint >> 10) + 0xD800, (codePoint & ((1 << 10) - 1)) + 0xDC00);
            }
        }

        return result;
    }

    getBufferIdentifier() {
        if (this._buffer.length < this._position + 4 + 4) {
            throw new flatbuffers.Error('Reader is too short to contain an identifier.');
        }
        let result = '';
        for (let i = 0; i < 4; i++) {
            result += String.fromCharCode(this.int8(this._position + 4 + i));
        }
        return result;
    }

    offset(bb_pos, vtableOffset) {
        var vtable = bb_pos - this.int32(bb_pos);
        return vtableOffset < this.int16(vtable) ? this.int16(vtable + vtableOffset) : 0;
    }

    union(t, offset) {
        t.bb_pos = offset + this.int32(offset);
        t.bb = this;
        return t;
    }

    indirect(offset) {
        return offset + this.int32(offset);
    }

    vector(offset) {
        return offset + this.int32(offset) + 4; // data starts after the length
    }

    length(offset) {
        return this.int32(offset + this.int32(offset));
    }

    identifier(value) {
        if (value.length !== 4) {
            throw new flatbuffers.Error('File identifier must be 4 characters in length.');
        }
        for (let i = 0; i < 4; i++) {
            if (value.charCodeAt(i) != this.int8(this._position + 4 + i)) {
                return false;
            }
        }
        return true;
    }

    createLong(low, high) {
        return flatbuffers.Long.create(low, high);
    }
};

flatbuffers.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'FlatBuffers Error';
        this.message = message;
    }
};

if (typeof module !== "undefined" && typeof module.exports === "object") {
    module.exports.Reader = flatbuffers.Reader;
    module.exports.Error = flatbuffers.Error;
    module.exports.Long = flatbuffers.Long;
    module.exports.get = flatbuffers.get;
}