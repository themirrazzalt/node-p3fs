var fs = require('fs');
var fsa = require('node:fs/promises');
var P3 = require('./node-p3');
var oldcfg = require('./config.json');
var argv = process.argv.slice(2);
var path = require('path');
var config = JSON.parse(JSON.stringify(
    require('./config.json')
));



if(argv[0] == '-h' || argv[0] == '--help') {
    console.log(
        "P3FS Hosting Service"
        + "\n" + "Usage: node index.js [options]"
        + "\n" + "Options:" + "\n"
        + "-h --help         Shows this help menu" + "\n"
        + "-p --password     Protect mounting with a password" + "\n"
        + "-m --max          Specify a maximum amount of connections",
        + "-l --label        Provide a custom disk label"
    )
}

var maxCon = 0;
if(argv[0] == '-m' || argv[0] == '-max') {
    maxCon = Number(argv[1])
}


var os = require('os');
if(!config.directory) {
    config.directory = os.homedir()
}
var p3;
if(config.secret) {
    p3 = new P3({ secret: config.secret, autoinit: true });
} else {
    console.warn('p3: P3 key not set, generating one for you');
    p3 = new P3({
        autoinit: true
    });
    config.secret = p3.key;
}

p3.on('connect', _ => {
    console.info(`p3fs: connected, and listening on ${p3.adr}:737`)
})

if(
    (config.directory!=oldcfg.directory)||
    (config.secret!=oldcfg.secret)
) {
    fsa.writeFile('./config.json',JSON.stringify(config))
}

var hosting_dir=(
    config.directory.startsWith(os.homedir()+"/") ? `~${config.directory.slice(os.homedir.length)}`
    : (
        config.directory === os.homedir() ? `~` : config.directory
    )
);

console.info(
    'p3fs: preparing to host filesystem in directory ' + hosting_dir
);

var connections = 0;
var diskLabel;
if(argv[0] == '-l' || argv[0] == '--label') {
    diskLabel = argv[1];
}

if(argv[2] == '-l' || argv[2] == '--label') {
    diskLabel = argv[3];
}

if(argv[4] == '-l' || argv[4] == '--label') {
    diskLabel = argv[5];
}

function ui8ToB64(data) {
    for(var sub, i = 0, len = data.length, out = ""; i < len; null) {
        sub = data.subarray(i, Math.min(i + 32768, len));
        out += String.fromCharCode.apply(null, sub);
        i += 32768;
    }
    return btoa(out)
}

p3.listen(737, function (client) {
    if(maxCon) {
        if(connections >= maxCon) {
            return
        }
    }
    console.info(`p3fs: client ${client.peer.adr} connected`);
    connections++;
    client.on('disconnect', _ => {
        console.warn(`p3fs: client ${client.peer.adr} disconnected`);
        connections--;
    });
    var emit=function(a,b) {
        client.emit([a,b])
    }
    client.on('message', async ([cmd, arg]) => {
        switch (cmd) {
            case 'HELLO':
                emit('SUCCESS', {
                    label: diskLabel || p3.adr
                });
                break
            case 'FSFN':
                var fn = arg.type;
                var args = arg.args;
                var reqId = arg.reqId;
                var data;
                var isB64 = false;
                try {
                    switch (fn) {
                        case 'readdir':
                            data = await fsa.readdir(
                                path.join(
                                    config.directory,
                                    args[0]
                                ),
                                {
                                    withFileTypes: args[1]
                                }
                            );
                            if(args[1]) {
                                data.forEach((dirent, i) => {
                                    data[i] = {
                                        filetype: dirent.isDirectory() ? 1 : 0,
                                        path: path.join(args[0],dirent.name)
                                    }
                                });
                            } else {
                                data.forEach((dirent, i) => {
                                    data[i] = path.join(
                                        args[0],
                                        dirent
                                    )
                                })
                            }
                            break
                        case 'readbin':
                            data = ui8ToB64(
                                await fsa.readFile(
                                    path.join(
                                        config.directory,
                                        args[0]
                                    )
                                )
                            );
                            isB64 = true;
                            break
                        case 'readBinChunk':
                            data = ui8ToB64(
                                await fsa.readFile(
                                    path.join(
                                        config.directory,
                                        args[0]
                                    )
                                )
                            );
                            data = data.slice(args[1], args[2]);
                            isB64 = true;
                            break
                        case 'isEmpty':
                            var stats = await fsa.stat(path.join(
                                    config.directory,
                                    args[0]
                                ));
                            if(stats.isDirectory()) {
                                data = ( await fsa.readdir(args[0]) ).length === 0
                            } else {
                                data = ( await fsa.readFile(args[0]) ).length === 0
                            }
                            break
                        case 'filetype':
                            var stats = await fsa.stat(path.join(
                                    config.directory,
                                    args[0]
                                ));
                            data = stats.isDirectory() ? 1 : 0;
                            break
                        case 'stat':
                            var stats = await fsa.stat(path.join(
                                    config.directory,
                                    args[0]
                                ));
                            data = {
                                recordId: '_null_',
                                type: stats.isDirectory() ? 1 : 0,
                                length: stats.isDirectory() ? 0 : ( await fsa.readFile(path.join(
                                    config.directory,args[0]
                                )) ).length,
                                readOnly: false
                            }
                            break
                        case 'readstr':
                            data = await fsa.readFile(
                                path.join(
                                    config.directory,
                                    args[0]
                                ),
                                {
                                    encoding: 'utf-8'
                                }
                            )
                            break
                        case 'readStrChunk':
                            data = await fsa.readFile(
                                path.join(
                                    config.directory,
                                    args[0]
                                ),
                                {
                                    encoding: 'utf-8'
                                }
                            )
                            data = data.slice(args[1],args[2]);
                            break
                        case 'exists':
                            try {
                                await fsa.stat(
                                    path.join(
                                        config.directory,
                                        args[0]
                                    )
                                )
                                data = true
                            } catch (error) {
                                if(error.code=='ENOENT') {
                                    data = false
                                } else {
                                    throw error
                                }
                            }
                            break
                        default:
                            emit('ERR',"Invalid payload | Invalid FS function");
                            return client.peer.disconnect()
                    }
                    emit('RES',{
                        res: data,
                        isB64: isB64,
                        reqId: reqId
                    })
                } catch (globalError) {
                    emit('ERR',{
                        errType: {
                            id: globalError.errno,
                            message: globalError.errno == 2 ? "No such file or directory" : globalError.message
                        },
                        reqId: reqId,
                        path: args[0]
                    })
                }

        }
    });
    emit('HELLO',null);
})