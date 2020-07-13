
const flatc = {};
const fs = require('fs');
const { builtinModules } = require('module');

flatc.Object = class {

    constructor(parent, name) {
        this.parent = parent;
        this.name = name;
    }

    resolve() {
    }

    find(name, type) {
        return this.parent ? this.parent.find(name, type) : undefined;
    }

    get root() {
        return this.parent.root;
    }
};

flatc.Namespace = class extends flatc.Object {

    constructor(parent, name) {
        super(parent, name);
        this.children = new Map();
    }

    resolve() {
        for (const child of this.children.values()) {
            child.resolve();
        }
        if (this.root_type) {
            const type = this.find(this.root_type, flatc.Type);
            if (!type) {
                throw new flatc.Error("Failed to resolve root type '" + this.root_type + "'.");
            }
            this.root.set('root_type', type);
        }
    }

    find(name, type) {
        if (type === flatc.Type) {
            const parts = name.split('.');
            const typeName = parts.pop();
            const namespaceName = parts.join('.');
            if (namespaceName === '') {
                if (this.children.has(typeName)) {
                    return this.children.get(typeName);
                }
            }
            const namespace = this.parent.find(namespaceName, flatc.Namespace);
            if (namespace) {
                if (namespace.children.has(typeName)) {
                    return namespace.children.get(typeName);
                }
            }
            const parents = this.name.split('.');
            while (parents.length > 1) {
                parents.pop();
                const namespace = this.parent.find(parents.join('.') + '.' + namespaceName, flatc.Namespace);
                if (namespace) {
                    if (namespace.children.has(typeName)) {
                        return namespace.children.get(typeName);
                    }
                }
            }
        }
        return super.find(name, type);
    }
};

flatc.Type = class extends flatc.Object {

    constructor(parent, name) {
        super(parent, name);
        if (parent instanceof flatc.Namespace) {
            if (parent.children.has(name)) {
                throw new flatc.Error("Duplicate identifier '" + name + "'.");
            }
            parent.children.set(name, this);
        }
    }
};

flatc.Enum = class extends flatc.Type {

    constructor(parent, name, base) {
        super(parent, name);
        this.base = base;
        this.values = new Map();
    }

    resolve() {
        if (this.base instanceof flatc.TypeReference) {
            this.base = this.base.resolve(this);
            this.defaultValue = this.base.defaultValue;
        }
        let index = 0;
        for (const key of this.values.keys()) {
            if (this.values.get(key) === undefined) {
                this.values.set(key, index);
            }
            index = this.values.get(key) + 1;
        }
        super.resolve();
    }
};

flatc.Union = class extends flatc.Type {

    constructor(parent, name) {
        super(parent, name);
        this.values = new Map();
    }

    resolve() {
        super.resolve();
    }
};


flatc.Table = class extends flatc.Type {

    constructor(parent, name) {
        super(parent, name);
        this.fields = new Map();
    }

    resolve() {
        let offset = 4;
        for (const field of this.fields.values()) {
            field.resolve();
            field.offset = offset;
            offset += 2;
        }
        super.resolve();
    }
};

flatc.Struct = class extends flatc.Type {

    constructor(parent, name) {
        super(parent, name);
        this.fields = new Map();
        this.size = -1;
    }

    resolve() {
        if (this.size === -1) {
            let offset = 0;
            for (const field of this.fields.values()) {
                field.resolve();
                if (field.type instanceof flatc.PrimitiveType && field.type !== 'string') {
                    const size = field.type.size;
                    field.offset = (offset % size != 0) ? (Math.floor(offset / size) + 1) * size : offset;
                    offset = field.offset + field.type.size;
                }
                else if (field.type instanceof flatc.Struct) {
                    field.type.resolve();
                    field.offset = offset;
                    offset += field.type.size;
                }
                else {
                    throw flatc.Error('Structs may contain only scalar or struct fields.');
                }
            }
            this.size = offset;
        }
        super.resolve();
    }
};

flatc.Field = class extends flatc.Object {

    constructor(parent, name, type, defaultValue) {
        super(parent, name);
        this.type = type;
        this.defaultValue = defaultValue;
    }

    resolve() {
        if (this.type instanceof flatc.TypeReference) {
            if (this.type.repeated) {
                this.repeated = true;
            }
            this.type = this.type.resolve(this);
            if (this.defaultValue === undefined) {
                const type = this.type instanceof flatc.Enum ? this.type.base : this.type;
                if (type instanceof flatc.PrimitiveType) {
                    this.defaultValue = type.defaultValue;
                }
            }
            else if (this.type instanceof flatc.Enum) {
                if (!this.type.values.has(this.defaultValue)) {
                    throw new flatc.Error("Unknown enum value '" + this.defaultValue + "'.");
                }
                this.defaultValue = this.type.values.get(this.defaultValue);
            }
        }
        super.resolve();
    }
};

flatc.PrimitiveType = class extends flatc.Type {

    constructor(name, defaultValue, size) {
        super(null, name);
        this.defaultValue = defaultValue;
        this.size = size;
    }

    static get(name) {
        if (!this._map) {
            this._map = new Map();
            const register = (names, defaultValue, size) => {
                const type = new flatc.PrimitiveType(names[0], defaultValue, size);
                for (const name of names) {
                    this._map.set(name, type);
                }
            };
            register([ 'bool' ], false, 1);
            register([ 'int8', 'byte' ], 0, 1);
            register([ 'uint8', 'ubyte' ], 0, 1);
            register([ 'int16', 'short' ], 0, 2);
            register([ 'uint16', 'ushort' ], 0, 2);
            register([ 'int32', 'int' ], 0, 4);
            register([ 'uint32', 'uint' ], 0, 4);
            register([ 'int64', 'long' ], 0, 8);
            register([ 'uint64', 'ulong' ], 0, 8);
            register([ 'float32', 'float' ], 0.0, 4);
            register([ 'float64', 'double' ], 0, 4);
            register([ 'string' ], null, undefined);
        }
        return this._map.get(name);
    }
};

flatc.TypeReference = class {

    constructor(name, repeated) {
        this.name = name;
        this.repeated = repeated;
    }

    resolve(context) {
        const primitiveType = flatc.PrimitiveType.get(this.name);
        if (primitiveType) {
            return primitiveType;
        }
        const type = context.parent.find(this.name, flatc.Type);
        if (type) {
            return type;
        }
        throw new flatc.Error("Falied to resolve type '" + this.type.name + "'.");
    }
};

flatc.Parser = class {

    constructor(text, file, root) {
        // https://google.github.io/flatbuffers/flatbuffers_grammar.html
        this._tokenizer = new flatc.Parser.Tokenizer(text, file);
        this._root = root;
        this._context = root.defineNamespace('');
    }

    parse() {

        const result = { includes: [], attributes: [] };

        while (!this._tokenizer.match('eof') && this._tokenizer.eat('id', 'include')) {
            result.includes.push(this._tokenizer.string());
            this._tokenizer.expect(';');
        }

        while (!this._tokenizer.match('eof')) {

            if (this._tokenizer.eat('id', 'namespace')) {
                let name = this._tokenizer.identifier();
                while (this._tokenizer.eat('.')) {
                    name += '.' + this._tokenizer.identifier();
                }
                this._tokenizer.expect(';');
                this._context = this._root.defineNamespace(name);
                continue;
            }
            if (this._tokenizer.eat('id', 'table')) {
                const name = this._tokenizer.identifier();
                const table = new flatc.Table(this._context, name);
                table.metadata = this._parseMetadata();
                this._tokenizer.expect('{');
                while (!this._tokenizer.eat('}')) {
                    const field = this._parseField(table);
                    table.fields.set(field.name, field);
                    this._tokenizer.expect(';');
                }
                continue;
            }
            if (this._tokenizer.eat('id', 'struct')) {
                const name = this._tokenizer.identifier();
                const table = new flatc.Struct(this._context, name);
                table.metadata = this._parseMetadata();
                this._tokenizer.expect('{');
                while (!this._tokenizer.eat('}')) {
                    const field = this._parseField(table);
                    table.fields.set(field.name, field);
                    this._tokenizer.expect(';');
                }
                continue;
            }
            if (this._tokenizer.eat('id', 'enum')) {
                const name = this._tokenizer.identifier();
                this._tokenizer.expect(':');
                const base = this._parseTypeReference();
                if (base.repeated) {
                    throw new flatc.Error('Underlying enum type must be integral' + this._tokenizer.location());
                }
                const type = new flatc.Enum(this._context, name, base);
                type.metadata = this._parseMetadata();
                this._tokenizer.expect('{');
                while (!this._tokenizer.eat('}')) {
                    const key = this._tokenizer.identifier();
                    const value = this._tokenizer.eat('=') ? this._tokenizer.integer() : undefined;
                    type.values.set(key, value);
                    if (this._tokenizer.eat(',')) {
                        continue;
                    }
                }
                continue;
            }
            if (this._tokenizer.eat('id', 'union')) {
                const name = this._tokenizer.identifier();
                const type = new flatc.Union(this._context, name);
                type.metadata = this._parseMetadata();
                this._tokenizer.expect('{');
                while (!this._tokenizer.eat('}')) {
                    const key = this._tokenizer.identifier();
                    const value = this._tokenizer.eat('=') ? this._tokenizer.integer() : undefined;
                    type.values.set(key, value);
                    if (this._tokenizer.eat(',')) {
                        continue;
                    }
                }
                continue;
            }
            if (this._tokenizer.eat('id', 'root_type')) {
                this._context.root_type = this._tokenizer.identifier();
                this._tokenizer.eat(';');
                continue;
            }
            if (this._tokenizer.eat('id', 'file_extension')) {
                const value = this._tokenizer.string();
                this._root.set('file_extension', value);
                this._tokenizer.eat(';');
                continue;
            }
            if (this._tokenizer.eat('id', 'file_identifier')) {
                const value = this._tokenizer.string();
                if (value.length !== 4) {
                    throw new flatc.Error("'file_identifier' must be exactly 4 characters " + this._tokenizer.location());
                }
                this._root.set('file_identifier', value);
                this._tokenizer.eat(';');
                continue;
            }
            if (this._tokenizer.eat('id', 'attribute')) {
                const token = this._tokenizer.read();
                switch (token.type) {
                    case 'string':
                        result.attributes.push(token.value);
                        break;
                    case 'id':
                        result.attributes.push(token.token);
                        break;
                    default:
                        throw new flatc.Error("Unexpected attribute token '" + token.token + "'" + this._tokenizer.location());
                }
                this._tokenizer.expect(';');
                continue;
            }
            if (this._tokenizer.eat('{')) {
                throw new flatc.Error('XXXX');
            }
            throw new flatc.Error("Unexpected token '" + this._tokenizer.peek().token + "'" + this._tokenizer.location());
        }
        return result;
    }

    _parseTypeReference() {
        const token = this._tokenizer.read();
        if (token.type === 'id') {
            return new flatc.TypeReference(token.token, false);
        }
        if (token.type === '[') {
            const identifier = this._tokenizer.read();
            if (identifier.type === 'id') {
                this._tokenizer.expect(']');
                return new flatc.TypeReference(identifier.token, true);
            }
        }
        throw new flatc.Error("Expected type instead of '" + token.token + "'" + this._tokenizer.location());
    }

    _parseField(parent) {
        const name = this._tokenizer.identifier();
        this._tokenizer.expect(':');
        const type = this._parseTypeReference();
        const defaultValue = this._tokenizer.eat('=') ? this._parseScalar() : undefined;
        const field = new flatc.Field(parent, name, type, defaultValue);
        field.metadata = this._parseMetadata();
        return field;
    }

    _parseMetadata() {
        if (this._tokenizer.eat('(')) {
            const metadata = new Map();
            while (!this._tokenizer.eat(')')) {
                const key = this._tokenizer.identifier();
                const value = this._tokenizer.eat(':') ? this._parseSingleValue() : undefined;
                metadata.set(key, value);
                if (this._tokenizer.eat(',')) {
                    continue;
                }
            }
            return metadata;
        }
        return undefined;
    }

    _parseScalar() {
        const token = this._tokenizer.read();
        switch (token.type) {
            case 'boolean':
            case 'integer':
            case 'float':
                return token.value;
            case 'id':
                return token.token;
        }
        throw new flatc.Error("Expected scalar instead of '" + token.token + "'" + this._tokenizer.location());
    }

    _parseSingleValue() {
        const token = this._tokenizer.read();
        switch (token.type) {
            case 'string':
            case 'boolean':
            case 'integer':
            case 'float':
                return token.value;
        }
        throw new flatc.Error("Expected single value instead of '" + token.token + "'" + this._token.location());
    }
};

flatc.Parser.Tokenizer = class {

    constructor(text, file) {
        this._text = text;
        this._file = file;
        this._position = 0;
        this._lineStart = 0;
        this._line = 0;
        this._token = { type: '', value: '' };
    }

    peek() {
        if (!this._cache) {
            this._token = this._tokenize(this._token);
            this._cache = true;
        }
        return this._token;
    }

    read() {
        if (!this._cache) {
            this._token = this._tokenize(this._token);
        }
        const next = this._position + this._token.token.length;
        while (this._position < next) {
            if (flatc.Parser.Tokenizer._isNewline(this._get(this._position))) {
                this._position = this._newLine(this._position);
                this._lineStart = this._position;
                this._line++;
            }
            else {
                this._position++;
            }
        }
        this._cache = false;
        return this._token;
    }

    match(type, value) {
        const token = this.peek();
        if (token.type === type && (!value || token.token === value)) {
            return true;
        }
        return false;
    }

    eat(type, value) {
        const token = this.peek();
        if (token.type === type && (!value || token.token === value)) {
            this.read();
            return true;
        }
        return false;
    }

    expect(type, value) {
        const token = this.peek();
        if (token.type !== type) {
            throw new flatc.Error("Unexpected '" + token.token + "' instead of '" + type + "'" + this.location());
        }
        if (value && token.token !== value) {
            throw new flatc.Error("Unexpected '" + token.token + "' instead of '" + value + "'" + this.location());
        }
        this.read();
    }

    string() {
        const token = this.read();
        if (token.type === 'string') {
            return token.value;
        }
        throw new flatc.Error("Expected string instead of '" + token.token + "'" + this.location());
    }

    identifier() {
        const token = this.read();
        if (token.type === 'id') {
            return token.token;
        }
        throw new flatc.Error("Expected identifier instead of '" + token.token + "'" + this.location());
    }

    integer() {
        const token = this.read();
        if (token.type === 'integer') {
            return token.value;
        }
        throw new flatc.Error("Expected integer instead of '" + token.token + "'" + this.location());
    }

    location() {
        return ' at ' + this._file + ':' + (this._line + 1).toString() + ':' + (this._position - this._lineStart + 1).toString();
    }

    _tokenize(token) {
        if (this._token.type !== '\n') {
            this._skipWhitespace();
        }
        if (this._position >= this._text.length) {
            return { type: 'eof', value: '' };
        }
        const text = this._text.slice(this._position);

        const boolean_constant = text.match(/^(true|false)/);
        if (boolean_constant) {
            const text = boolean_constant[0];
            return { type: 'boolean', token: text, value: text === 'true' };
        }

        const identifier = text.match(/^[a-zA-Z_][a-zA-Z0-9_.]*/);
        if (identifier) {
            return { type: 'id', token: identifier[0] };
        }

        const string_constant = text.match(/^".*?"/) || text.match(/^'.*?'/);
        if (string_constant) {
            const text = string_constant[0];
            return { type: 'string', token: text, value: text.substring(1, text.length - 1) };
        }

        const dec_float_constant = text.match(/^[-+]?(([.][0-9]+)|([0-9]+[.][0-9]*)|([0-9]+))([eE][-+]?[0-9]+)?/);
        if (dec_float_constant) {
            const text = dec_float_constant[0];
            if (text.indexOf('.') !== -1 || text.indexOf('e') !== -1) {
                return { type: 'float', token: text, value: parseFloat(text) };
            }
        }

        const hex_float_constant = text.match(/^[-+]?0[xX](([.][0-9a-fA-F]+)|([0-9a-fA-F]+[.][0-9a-fA-F]*)|([0-9a-fA-F]+))([pP][-+]?[0-9]+)/);
        if (hex_float_constant) {
            throw new flatc.Error('XXXX');
        }

        const dec_integer_constant = text.match(/^[-+]?[0-9]+/);
        if (dec_integer_constant) {
            const text = dec_integer_constant[0];
            return { type: 'integer', token: text, value: parseInt(text, 10) };
        }
        const hex_integer_constant = text.match(/^[-+]?0[xX][0-9a-fA-F]+/);
        if (hex_integer_constant) {
            throw new flatc.Error('XXXX');
            // return { type: 'integer', value: hex_integer_constant[0] };
        }

        const c = this._get(this._position);
        switch (c) {
            case ';':
            case ':':
            case '{':
            case '}':
            case '[':
            case ']':
            case '(':
            case ')':
            case '=':
            case ',':
                return { type: c, token: c };
        }

        throw new flatc.Error("Unknown character '" + c + "' " + this.location());
    }

    _get(position) {
        return position >= this._text.length ? '\0' : this._text[position];
    }

    _skipLine() {
        while (this._position < this._text.length) {
            if (flatc.Parser.Tokenizer._isNewline(this._get(this._position))) {
                break;
            }
            this._position++;
        }
    }

    _skipWhitespace() {
        while (this._position < this._text.length) {
            const c = this._get(this._position);
            if (flatc.Parser.Tokenizer._isSpace(c)) {
                this._position++;
                continue;
            }
            if (flatc.Parser.Tokenizer._isNewline(c)) {
                // Implicit Line Continuation
                this._position = this._newLine(this._position);
                this._lineStart = this._position;
                this._line++;
                continue;
            }
            if (c === '/') {
                const c1 = this._get(this._position + 1);
                if (c1 === '/') {
                    this._skipLine();
                    continue;
                }
                if (c1 === '*') {
                    throw new flatc.Error('XXXX');
                }
            }
            break;
        }
    }

    static _isSpace(c) {
        switch (c) {
            case ' ':
            case '\t':
            case '\v': // 11
            case '\f': // 12
            case '\xA0': // 160
                return true;
            default:
                return false;
        }
    }

    static _isNewline(c) {
        switch(c) {
            case '\n':
            case '\r':
            case '\u2028': // 8232
            case '\u2029': // 8233
                return true;
        }
        return false;
    }

    _newLine(position) {
        if ((this._get(position) === '\n' && this._get(position + 1) === '\r') ||
            (this._get(position) === '\r' && this._get(position + 1) === '\n')) {
            return position + 2;
        }
        return position + 1;
    }
};

flatc.Root = class extends flatc.Object {

    constructor(root, paths, files) {
        super(null, root);
        this.namespaces = new Map();
        this.metadata = new Map();
        this._files = new Set();
        for (const file of files) {
            this._parseFile(paths, file);
        }
        this.resolve();
    }

    resolve() {
        for (const namespace of this.namespaces.values()) {
            namespace.resolve();
        }
    }

    get root() {
        return this;
    }

    set(name, value) {
        this.metadata.set(name, value);
    }

    get(name) {
        return this.metadata.get(name);
    }

    defineNamespace(name) {
        if (!this.namespaces.has(name)) {
            this.namespaces.set(name, new flatc.Namespace(this, name));
        }
        return this.namespaces.get(name);
    }

    find(name, type) {
        if (type === flatc.Namespace) {
            if (this.namespaces.has(name)) {
                return this.namespaces.get(name);
            }
        }
        return super.find(name, type);
    }

    _parseFile(paths, file) {
        if (this._files.has(file)) {
            return;
        }
        this._files.add(file);
        const text = fs.readFileSync(file, 'utf-8');
        const parser = new flatc.Parser(text, file, this);
        const parsed = parser.parse();
        for (const include of parsed.includes) {
            const path = file.split('/');
            path[path.length - 1] = include;
            const includeFile = path.join('/');
            if (fs.existsSync(includeFile)) {
                this._parseFile(paths, includeFile);
                continue;
            }
            throw new flatc.Error("Include '" + include + "' not found.");
        }
    }
};

flatc.Generator = class {

    constructor(root, text) {
        this._root = root;
        this._text = text;
        this._builder = new flatc.Generator.StringBuilder();
        this._builder.add("const $root = flatbuffers.get('" + this._root.name + "');");
        for (const namespace of this._root.namespaces.values()) {
            this._buildNamespace(namespace);
        }
        this._content = this._builder.toString();
    }

    get content() {
        return this._content;
    }

    _buildNamespace(namespace) {
        if (namespace.name !== '') {
            const name = '$root.' + namespace.name;
            this._builder.add('');
            this._builder.add(name + ' = ' + name + ' || {};');
        }
        for (const child of namespace.children.values()) {
            if (child instanceof flatc.Table) {
                this._buildTable(child);
            }
            else if (child instanceof flatc.Struct) {
                this._buildStruct(child);
            }
            else if (child instanceof flatc.Enum) {
                this._buildEnum(child);
            }
        }
    }

    _buildTable(type) {

        const name = '$root.' + type.parent.name + '.' + type.name;

        /* eslint-disable indent */
        this._builder.add('');
        this._builder.add(name + ' = class ' + type.name + ' {');
        this._builder.indent();

            this._builder.add('');
            this._builder.add('constructor(reader, offset) {');
            this._builder.indent();
                this._builder.add('this._reader = reader;');
                this._builder.add('this._offset = offset;');
            this._builder.outdent();
            this._builder.add('}');

            if (type === this._root.get('root_type')) {
                this._builder.add('');
                this._builder.add('static create(reader) {');
                this._builder.indent();
                    this._builder.add('return new ' + name + '(reader, reader.int32(reader.position) + reader.position);');
                this._builder.outdent();
                this._builder.add('}');

                const file_identifier = this._root.get('file_identifier');
                if (file_identifier) {
                    this._builder.add('');
                    this._builder.add('static identifier(reader) {');
                    this._builder.indent();
                        this._builder.add("return reader.identifier('" + file_identifier + "');");
                    this._builder.outdent();
                    this._builder.add('}');
                }
            }

            for (const field of type.fields.values()) {
                this._builder.add('');
                this._builder.add('get ' + field.name + '() {');
                this._builder.indent();
                    this._builder.add('const offset = this._reader.offset(this._offset, ' + field.offset + ');');
                    if (field.repeated) {
                        if (field.type instanceof flatc.PrimitiveType && field.type.name !== 'string' && field.type.name !== 'int64' && field.type.name !== 'uint64' && field.type.name !== 'bool') {
                            const arrayType = field.type.name[0].toUpperCase() + field.type.name.substring(1) + 'Array';
                            this._builder.add('return offset ? new ' + arrayType + '(this._reader.buffer.buffer, this._reader.buffer.byteOffset + this._reader.vector(this._offset + offset), this._reader.length(this._offset + offset)) : null;');
                        }
                        else if (field.type instanceof flatc.PrimitiveType && field.type.name === 'int64') {
                            this._builder.add("// TODO");
                            this._builder.add("return undefined;");
                        }
                        else if (field.type instanceof flatc.PrimitiveType && field.type.name === 'uint64') {
                            this._builder.add("// TODO");
                            this._builder.add("return undefined;");
                        }
                        else if (field.type instanceof flatc.PrimitiveType && field.type.name === 'bool') {
                            this._builder.add("// TODO");
                            this._builder.add("return undefined;");
                        }
                        else if (field.type instanceof flatc.PrimitiveType && field.type.name === 'string') {
                            this._builder.add("// TODO");
                            this._builder.add("return undefined;");
                        }
                        else {
                            this._builder.add('const length = offset ? this._reader.length(this._offset + offset) : 0;');
                            this._builder.add('const vector = [];');
                            this._builder.add('for (let i = 0; i < length; i++) {');
                            this._builder.indent();
                                const fieldType = '$root.' + field.type.parent.name + '.' + field.type.name;
                                this._builder.add('vector.push(new ' + fieldType + '(this._reader, this._reader.indirect(this._reader.vector(this._offset + offset) + i * 4)));');
                            this._builder.outdent();
                            this._builder.add('}');
                            this._builder.add('return vector;');
                        }
                    }
                    else {
                        const fieldType = field.type instanceof flatc.Enum ? field.type.base : field.type;
                        if (fieldType instanceof flatc.PrimitiveType) {
                            this._builder.add('return offset ? this._reader.' + fieldType.name + '(this._offset + offset) : ' + field.defaultValue + ';');
                        }
                        else {
                            this._builder.add("// TODO");
                            this._builder.add("return undefined;");
                        }
                    }
                this._builder.outdent();
                this._builder.add('}');
            }

        this._builder.outdent();
        this._builder.add('};');
        /* eslint-enable indent */
    }

    _buildStruct(type) {

        const name = '$root.' + type.parent.name + '.' + type.name;

        /* eslint-disable indent */
        this._builder.add('');
        this._builder.add(name + ' = class ' + type.name + ' {');
        this._builder.indent();

            this._builder.add("// TODO");

        this._builder.outdent();
        this._builder.add('};');
        /* eslint-enable indent */
    }

    _buildEnum(type) {

        /* eslint-disable indent */
        this._builder.add('');
        this._builder.add('$root.' + type.parent.name + '.' + type.name + ' = {');
        this._builder.indent();
            const keys = Array.from(type.values.keys());
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                this._builder.add(key + ': ' + type.values.get(key) + (i === keys.length - 1 ? '' : ','));
            }
        this._builder.outdent();
        this._builder.add('};');
        /* eslint-enable indent */
    }
};

flatc.Generator.StringBuilder = class {

    constructor() {
        this._indentation = '';
        this._lines = [];
        this._newline = true;
    }

    indent() {
        this._indentation += '    ';
    }

    outdent() {
        if (this._indentation.length === 0) {
            throw new flatc.Error('Invalid indentation.');
        }
        this._indentation = this._indentation.substring(0, this._indentation.length - 4);
    }

    add(text, newline) {
        if (this._newline) {
            if (text !== '') {
                this._lines.push(this._indentation);
            }
        }
        this._lines[this._lines.length - 1] = this._lines[this._lines.length - 1] + text + (newline === false ? '' : '\n');
        this._newline = newline === false ? false : true;
    }

    toString() {
        return this._lines.join('');
    }
};

flatc.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'FlatBuffers Compiler Error';
    }
};

const main = (args) => {

    const options = { verbose: false, root: 'default', out: '', text: false, paths: [], files: [] };
    while (args.length > 0) {
        const arg = args.shift();
        switch (arg) {
            case '--verbose':
                options.verbose = true;
                break;
            case '--out':
                options.out = args.shift();
                break;
            case '--root':
                options.root = args.shift();
                break;
            case '--text':
                options.text = true;
                break;
            case '--path':
                options.paths.push(args.shift());
                break;
            default:
                if (arg.startsWith('-')) {
                    throw new flatc.Error("Invalid command line argument '" + arg + "'.");
                }
                options.files.push(arg);
                break;
        }
    }

    try {
        const content = new flatc.Generator(new flatc.Root(options.root, options.paths, options.files), options.text).content;
        if (options.out) {
            fs.writeFileSync(options.out, content, 'utf-8');
        }
    }
    catch (err) {
        if (err instanceof flatc.Error && !options.verbose) {
            process.stderr.write(err.message + '\n');
        }
        else {
            process.stderr.write(err.stack + '\n');
        }
        return 1;
    }
    return 0;
};

process.exit(main(process.argv.slice(2)));