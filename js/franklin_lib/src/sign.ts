import BN = require('bn.js');

const elliptic = require('elliptic');

//! `Fr modulus = 21888242871839275222246405745257275088548364400416034343698204186575808495617`
//!
//! It takes the form `-x^2 + y^2 = 1 + dx^2y^2` with
//! `d = -(168696/168700)` using the isomorphism from usual Baby Jubjub
//! with a requirement that `a' = -1, a = 168696`, that results in
//! ```
//! scaling = 1911982854305225074381251344103329931637610209014896889891168275855466657090
//! a' = 21888242871839275222246405745257275088548364400416034343698204186575808495616 == -1 = a*scale^2 mod P
//! d' = 12181644023421730124874158521699555681764249180949974110617291017600649128846 == -(168696/168700) = d*scale^2
//! ```
const babyJubjubParams = {
    a: new BN('21888242871839275222246405745257275088548364400416034343698204186575808495616'),
    d: new BN('12181644023421730124874158521699555681764249180949974110617291017600649128846'),
    n: new BN('2736030358979909402780800718157159386076813972158567259200215660948447373041'),
    p: new BN('21888242871839275222246405745257275088548364400416034343698204186575808495617'),
    c: '1',
    g: [
        '2ef3f9b423a2c8c74e9803958f6c320e854a1c1c06cd5cc8fd221dc052d76df7',
        '05a01167ea785d3f784224644a68e4067532c815f5f6d57d984b5c0e9c6c94b7',
    ],
};

const fsModulus = babyJubjubParams.n;
const fsOne = new BN(1); //(new BN(2)).pow(new BN(256)).mod(fsModulus);
const fsZero = new BN(0);
const curve = new elliptic.curve.edwards(babyJubjubParams);
const curveZero = curve.point('0', '1');
const chunksPerGenerator = 62;
const generatorExpTable = genPedersonHashLookupTable();

function wrapFs(fs) {
    while (fs.ltn(0)) {
        fs = fs.add(fsModulus);
    }
    if (fs.gte(fsModulus)) {
        fs = fs.mod(fsModulus);
    }
    return fs;
}

function genPedersonHashLookupTable() {
    function genTableForGenerator(g) {
        let result = [];
        for (let window = 0; window < 32; ++window) {
            let window_table = [curveZero];
            let accum = curveZero;
            for (let mul = 1; mul < 256; ++mul) {
                accum = accum.add(g).normalize();
                window_table.push(accum);
            }
            g = g.mul(new BN(256));
            result.push(window_table);
        }
        return result;
    }

    let gen1 = curve.point(
        '184570ed4909a81b2793320a26e8f956be129e4eed381acf901718dff8802135',
        '1c3a9a830f61587101ef8cbbebf55063c1c6480e7e5a7441eac7f626d8f69a45',
    );
    let gen2 = curve.point(
        '0afc00ffa0065f5479f53575e86f6dcd0d88d7331eefd39df037eea2d6f031e4',
        '237a6734dd50e044b4f44027ee9e70fcd2e5724ded1d1c12b820a11afdc15c7a',
    );
    let gen3 = curve.point(
        '00fb62ad05ee0e615f935c5a83a870f389a5ea2baccf22ad731a4929e7a75b37',
        '00bc8b1c9d376ceeea2cf66a91b7e2ad20ab8cce38575ac13dbefe2be548f702',
    );
    let gen4 = curve.point(
        '0675544aa0a708b0c584833fdedda8d89be14c516e0a7ef3042f378cb01f6e48',
        '169025a530508ee4f1d34b73b4d32e008b97da2147f15af3c53f405cf44f89d4',
    );
    let gen5 = curve.point(
        '07350a0660a05014168047155c0a0647ea2720ecb182a6cb137b29f8a5cfd37f',
        '3004ad73b7abe27f17ec04b04b450955a4189dd012b4cf4b174af15bd412696a',
    );
    const basicGenerators = [gen1, gen2, gen3, gen4, gen5];

    let table = [];
    for (let g of basicGenerators) {
        table.push(genTableForGenerator(g));
    }
    return table;
}

function buffer2bits(buff) {
    const res = new Array(buff.length * 8);
    for (let i = 0; i < buff.length; i++) {
        const b = buff[i];
        res[i * 8] = (b & 0x01) != 0;
        res[i * 8 + 1] = (b & 0x02) != 0;
        res[i * 8 + 2] = (b & 0x04) != 0;
        res[i * 8 + 3] = (b & 0x08) != 0;
        res[i * 8 + 4] = (b & 0x10) != 0;
        res[i * 8 + 5] = (b & 0x20) != 0;
        res[i * 8 + 6] = (b & 0x40) != 0;
        res[i * 8 + 7] = (b & 0x80) != 0;
    }
    return res;
}

function pedersonHash() {
    function fsToPoint(fs, generator) {
        fs = wrapFs(fs);

        let tmpPoint = curveZero;
        let accStr = fs.toString('hex').padStart(64, '0');
        let accBuff = Buffer.from(accStr, 'hex').reverse();
        for (let window = 0; window < 32; ++window) {
            tmpPoint = tmpPoint.add(generatorExpTable[generator][window][accBuff[window]]);
        }
        return tmpPoint;
    }

    let bits = buffer2bits(Buffer.from(new Array(115).fill(144)));
    while (bits.length % 3 != 0) {
        bits.push(false);
    }

    let result = curveZero;

    let newChunkEncountered = false;
    let currentTriple = 0;
    let currentGenerator = 0;

    let generatorChunksLeft = chunksPerGenerator;

    let acc = fsZero;
    let cur = fsOne;

    while (bits.length > 0) {
        let triple = bits.slice(0, 3);
        bits = bits.slice(3);
        ++currentTriple;
        generatorChunksLeft -= 1;
        newChunkEncountered = true;

        let tmp = cur;
        let [a, b, c] = triple;
        if (a) {
            tmp = tmp.add(cur);
        }
        cur = cur.muln(2);
        if (b) {
            tmp = tmp.add(cur);
        }
        if (c) {
            tmp = tmp.neg();
        }
        // console.log(wrapFs(tmp).toArray());

        acc = acc.add(tmp);

        cur = cur.muln(2);
        cur = cur.muln(2);
        cur = cur.muln(2);

        if (generatorChunksLeft == 0) {
            result = result.add(fsToPoint(acc, currentGenerator));
            ++currentGenerator;
            generatorChunksLeft = chunksPerGenerator;
            acc = fsZero;
            cur = fsOne;
            newChunkEncountered = false;
        }
    }

    if (newChunkEncountered) {
        result = result.add(fsToPoint(acc, currentGenerator));
    }

    console.log(result.normalize());
}

pedersonHash();
