const net = require('net');
const clc = require("cli-color");
const ini = require("ini");
const fs = require("fs");
const req = require('request');


let configFile = './config.ini';

// check if config file exists
if (!fs.existsSync(configFile)) {
    configFile = './../config.ini';
    if (!fs.existsSync(configFile)) {
        throw 'config.ini file does not exist';
    }
}

// read config and check defaults
const config = ini.parse(fs.readFileSync(configFile, 'utf-8'));
config.timeout = parseInt(config.timeout || 3, 10);
config.interval = parseInt(config.interval || 10, 10);
config.compact = config.compact || false;

if(config.interval < config.timeout) {
    throw 'Interval has to be > that timeout';
}

config.port = parseInt(config.port || 7111, 10);
config.print = parseFloat(config.print);

if(config.servers === undefined) {
    throw 'No servers in config.ini';
}

const ERR_SOCKET = 'socket';
const ERR_BOOTING = 'booting';
const ERR_TIMEOUT = 'timeout';
const ERR_INIT = 'init';

// a list of sockets to make sure every connection is cleaned up - each server
// has its own socket connection. Due to the bad responses from the rhminer
// miniweb server, we will use pure sockets and not simple HTTP requests.
let sockets = [];

/**
 * Tries to destroy a socket connection.
 *
 * @param socket
 */
function tryDestroySocket(socket)
{
    try {
        sockets[server.idx].destroy();
        sockets[server.idx] = null;
    }
    catch(e) {
        // TODO what to do now..
    }
}

/**
 * Tries to clean up all sockers (in case the script is cancelled),
 */
function cleanupAllSockets() {
    sockets.forEach((s) => tryDestroySocket(s));
}

/**
 * Requests a configured server and either returns a successful response or
 * an error.
 *
 * @param server
 * @returns {Promise<any>}
 */
function request(server)
{
    return new Promise(function(resolve, reject) {

        // check if the socket index exists
        if(sockets[server.idx] === undefined) {
            sockets[server.idx] = null;
        }

        // if the socket is alive, try to close it…
        if(sockets[server.idx] !== null) {
            tryDestroySocket(sockets[server.idx]);
        }

        // create new socket
        sockets[server.idx] = new net.Socket();

        // try to make sure the socket gets closed by all means
        setTimeout(() => {
            tryDestroySocket(sockets[server.idx]);
            reject({type: ERR_SOCKET, msg: 'Socket problem.'});
        }, server.timeout * 1000 * 2);

        // set socket timeout
        sockets[server.idx].setTimeout(server.timeout * 1000);
        sockets[server.idx].connect(server.port, server.ip, function() {
            sockets[server.idx].write(' ');
        });

        // check if the socket responded
        sockets[server.idx].on('data', function(data) {
            tryDestroySocket(sockets[server.idx]);

            // empty response
            if(data.toString().trim() === "{}") {
                reject({
                    type: ERR_BOOTING,
                    msg: 'Empty response, miner is probably booting, stay tuned...'
                });
            } else {
                resolve(JSON.parse(data.toString().trim()));
            }
        });

        // check errors
        sockets[server.idx].on('error', function(e) {
            reject({
                type: ERR_SOCKET,
                msg: e.toString()
            });
            tryDestroySocket(sockets[server.idx]);
        });

        // timeout..
        sockets[server.idx].on('timeout', function() {
            reject({
                type: ERR_TIMEOUT,
                msg: `Server not reachable, timeout after ${server.timeout}s`
            });
            tryDestroySocket(sockets[server.idx]);
        });
    });
}

/**
 * Requests a single server and reacts accordingly.
 *
 * @param server
 * @param first
 */
function doRequest(server, first) {
    // set inited flag
    server.inited = true;

    request(server).then((response) => {
        // reset errors
        server.errorMsg = null;
        server.errorType = null;

        // set response data
        server.data = response;

        // save speed history

        if(server.speedHistory === null) {
            server.speedHistory = {};
            server.data.infos.forEach((info) => {
                server.speedHistory[info.name] = [];
            });
        }
        server.data.infos.forEach((info) => {
            server.speedHistory[info.name].push(info.speed);
            if(server.speedHistory[info.name].length > config.average_lookback) {
                server.speedHistory[info.name].shift();
            }
        });

        // the first call to this method will not create another timer
        if(!!!first) {
            timer(server);
        }
    }).catch((error) => {
        // set errors
        server.errorType = error.type;
        server.errorMsg = error.msg;
        // the first call to this method will not create another timer
        if(!!!first) {
            timer(server);
        }
    });
}

function doQueryWallet() {
    if(config.wallet_ip && config.wallet_ip !== '')
    {
        const url = `http://${config.wallet_ip}:${config.wallet_port}`;
        const json = {
            jsonrpc: '2.0',
            method: 'getwalletcoins',
            params: {
                b58_pubkey: config.b58_pubkey
            }
        };

        req.post(url, {json},
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    all.balance = body.result;
                }
            }
        );
        json.method = 'getwalletaccountscount';
        req.post(url, {json},
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    all.accounts = body.result;
                }
            }
        );

        json.method = 'getblockcount';
        req.post(url, {json},
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    all.block_count = body.result;
                }
            }
        );

        json.method = 'getblocks';
        json.params.last = "1";
        req.post(url, {json},
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    all.last_block = body.result[0];
                }
            }
        );
    }

}

/**
 * Creates a new timer for when the miner is requested again.
 *
 * @param server
 */
function timer(server)
{
    server.next = Math.floor(Date.now() / 1000) + (parseInt(config.interval || server.interval, 10));
    setTimeout(() => {
        doRequest(server);
        doQueryWallet();
    }, server.interval * 1000);
}

// initialize the servers from the config
let servers = {};
let idx = 0;
// summary
let all = {
    threads: 0,
    rejected: 0,
    accepted: 0,
    speed: 0,
    speedHistory: [],
    good: 0,
    bad: 0,
    balance: 0,
    accounts: 0,
    block_count: 0,
    last_block: null
};

Object.keys(config.servers).forEach((ident) => {
    // get config object
    let serverConfig = config.servers[ident];

    // create new server state object
    const server = {
        ip: serverConfig.ip,
        port: serverConfig.port || 7111,
        timeout: parseInt(serverConfig.timeout || config.timeout || 3, 10),
        interval: parseInt(serverConfig.interval || config.interval || 10, 10),
        data: null,
        errorType: ERR_INIT,
        errorMsg: 'Not initialized, please wait..',
        last: 0,
        speedHistory: null,
        idx: idx,
        ident: ident,
        next: Math.floor(Date.now() / 1000) + parseInt(serverConfig.interval || config.interval, 10),
        inited: false,
        compact: serverConfig.compact || config.compact || false
    };
    idx++;

    // add server to list of servers
    servers[`${server.ip}:${server.port}-${idx}`] = server;

    // create new timer
    timer(server);

    // immediately call when first call
    doRequest(server, true);
    doQueryWallet();
});

/**
 * Ugly function to print the result table.
 */
function print() {
    // clear screen
    process.stdout.write('\033c');
    let output = "";
    output += '╔═════════════════╤══════╤═════════╤══════════╤══════════╤═════════╤══════╤══════╗' + "\n";
    output += '║ Server          │ Name │ Threads │ Speed    │ Average  │ ACC/REJ │ Temp │ Fan  ║' + "\n";
    output += '╟─────────────────┼──────┼─────────┼──────────┼──────────┼─────────┼──────┼──────╢' + "\n";

    all.good = 0;
    all.threads = 0;
    all.rejected = 0;
    all.accepted = 0;
    all.speed = 0;
    all.good = 0;
    all.bad = 0;

    Object.keys(servers).forEach((k) => {
        const server = servers[k];
        if(server.data === null || server.errorMsg !== null) {
            all.bad++;
            let ip = clc.bold(format(server.ip, false, 15));
            output += `║ ${ip} │ xxxx │ xxxxxxx │ xxxxxxxx │ xxxxxxxx │ xxx/xxx │ xxxx │ xxxx ║` + "\n";
            output += '╟────────────────────────────────────────────────────────────────────────────────╢' + "\n";
            let msg;
            if(server.inited === true) {
                msg = clc.bgRed.white(format(server.errorMsg, false, 67));
            } else {
                msg = clc.bgYellow.white(format(server.errorMsg, false, 67));
            }
            let repeat = Math.abs(server.next - Math.floor(Date.now() / 1000));
            let next = format('.'.repeat(repeat), true, 10);
            if(repeat > 6) {
                next = clc.red(next);
            } else if(repeat > 3) {
                next = clc.blue(next);
            } else {
                next = clc.green(next);
            }

            output += '║ ' + msg + ' ' + next + ' ║' + "\n";
            if(server.idx < Object.keys(servers).length - 1) {
                output += "╟════════════════════════════════════════════════════════════════════════════════╢" + "\n";
            } else {
                output += "╚════════════════════════════════════════════════════════════════════════════════╝" + "\n";
            }

            return;
        }
        all.good++;

        let first = true;
        let threadSum = 0;

        server.data.infos.forEach((info, idx) => {
            const ip = clc.bold(format(first ? server.ip : '', false,15));
            first = false;
            const name = format(info.name, false, 4);
            const threads = format(info.threads.toString(), true, 7);
            threadSum += info.threads;
            all.threads += info.threads;
            all.speed += info.speed;
            all.accepted += info.accepted;
            all.rejected += info.rejected;
            const speed = format(info.speed + ' H/s', true, 8);
            const avgSpeed = format(Math.floor(server.speedHistory[info.name].reduce((pv, cv) => pv + cv, 0) / server.speedHistory[info.name].length) + ' H/s', true, 8);
            const acc = format(info.accepted.toString(), true, 3, '0');
            const rej = format(info.rejected.toString(), true, 3, '0');
            const temp = format(info.temp.toString(), true, 4, ' ');
            const fan = format(info.fan.toString(), true, 4, ' ');
            output += `║ ${ip} │ ${name} │ ${threads} │ ${speed} │ ${avgSpeed} │ ${acc}/${rej} │ ${temp} | ${fan} ║` + "\n";
        });
        if(server.data.infos.length > 1) {
            const ip = format('', false, 15);
            const name = format('', false, 4);
            const threads = format(threadSum.toString(), true, 7);
            const speed = format(server.data.speed + ' H/s', true, 12);
            const acc = format(server.data.accepted.toString(), true, 3, '0');
            const rej = format(server.data.rejected.toString(), true, 3, '0');
            const temp = format('', true, 4, ' ');
            const fan = format('', true, 4, ' ');

            output += `║ ${ip} │ ${name} │ ${threads} │ ${speed} │ ${acc}/${rej} │ ${temp} | ${fan} ║` + "\n";
        }

        if(!server.compact) {
            const uptime = toDuration(server.data.uptime);
            let repeat = Math.abs(server.next - Math.floor(Date.now() / 1000));
            let next = format('.'.repeat(repeat), true, 10);
            if (repeat > 6) {
                next = clc.red(next);
            } else if (repeat > 3) {
                next = clc.blue(next);
            } else {
                next = clc.green(next);
            }

            let msg = format(`Uptime: ${uptime}  ${server.data['stratum.user']}@${server.data['stratum.server']} ${server.data.extrapayload}`, false, 67);
            let msg2 = format("", false, 78);
            output += '║ ' + msg2 + ' ║' + "\n";
            output += '║ ' + clc.yellow(msg) + ' ' + clc.bold(next) + ' ║' + "\n";
        }
        if(server.idx === Object.keys(servers).length - 1) {
            output += "╚════════════════════════════════════════════════════════════════════════════════╝" + "\n";
        } else {
            output += "╟════════════════════════════════════════════════════════════════════════════════╢" + "\n";
        }
    });


    let header = "\n" + ' Av: ' + Object.keys(servers).length + '/' + clc.bgGreen.white(all.good) + '/' + clc.bgRed.white(all.bad);
    header += ' Thr: ' + all.threads;
    header += ' Sp: ' + all.speed + ' H/s';
    header += ' Acc/Rej: ' + all.accepted + '/' + all.rejected;
    header += ' PASC: ' + all.balance;
    header += ' Acc: ' + all.accounts;
    //process.exit();
    output = header + "\n" + output;
    output += format(" Block: " + all.block_count.toString(), false, 20);

    if(all.last_block !== null) {
        output += format(` Last:  ${all.last_block.block} ${all.last_block.payload} - ${all.last_block.hashratekhs} KH/s`, false, 61) + "\n";
    }

    output += ' ────────────────────────────────────────────────────────────────────────────────' + "\n";
    output += " rhmonitor by @techworker";
    output += format("You like what you see? Donate to 3450-25", true, 56) + "\n";


    console.log(output);
}

function format(value, alignRight, maxWidth, pad = ' ') {
    if(value === undefined) {
        value = '';
    }
    if(value.length > maxWidth) {
        value = value.substr(0, maxWidth);
    }
    if(alignRight) {
        value = value.padStart(maxWidth, pad);
    } else {
        value = value.padEnd(maxWidth, pad);
    }

    return value;
}

/**
 * Creates a human readable duration string.
 *
 * @param duration
 * @returns {string}
 */
function toDuration(duration)
{
    var hours   = Math.floor(duration / 3600);
    var minutes = Math.floor((duration - (hours * 3600)) / 60);
    var seconds = duration - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = '0' + hours;}
    if (minutes < 10) {minutes = '0' + minutes;}
    if (seconds < 10) {seconds = '0' + seconds;}
    return `${hours}:${minutes}:${seconds}`;
}

// print loop
setInterval(print, config.print * 1000);

process.stdin.resume();//so the program will not close instantly

function exitHandler(options, exitCode) {
    if (options.cleanup) cleanupAllSockets();
    if (options.exit) process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));