let os = require('os')
let fs = require('fs')
let path = require('path')
let net = require('net')
let JsonSocket = require('json-socket')
let request = require('request')
let tar = require('tar')
let argv = require('yargs').argv
let mkdirp = require('mkdirp')
let nodeify = require('bluebird-nodeify')
let rimraf = require('rimraf')

const CLIENT_DIR = path.resolve(argv.dir || path.join(os.tmpdir(), "nodejs-dropbox-demo-client"))

let socket = new JsonSocket(new net.Socket())
socket.connect(8001, '127.0.0.1', () => {
    console.log(`Connecting ... Client dir: ${CLIENT_DIR}`)
})

socket.on('connect', () => {
    console.log('Connected to server')

    let options = {
        url: 'http://127.0.0.1:8000/',
        headers: { accept: 'application/x-gtar'}
    }
    request.get(options).pipe(tar.Extract({path: CLIENT_DIR}))

    socket.on('message', (message) => {
        async () => {
            console.log('Message: '+ JSON.stringify(message))

            switch(message.action) {
                case 'create':
                    if (message.type == 'dir') {
                        console.log('Creating Dir: '+ path.join(CLIENT_DIR, message.path))
                        mkdirp(path.join(CLIENT_DIR, message.path))
                    }
                    else if (message.type == 'file') {
                        console.log('Creating File: '+ path.join(CLIENT_DIR, message.path))
                        request.get("http://127.0.0.1:8000" + message.path)
                               .pipe(fs.createWriteStream(path.join(CLIENT_DIR, message.path)))
                    }
                    break;
                case 'delete':
                    if (message.type == 'dir') {
                        console.log('Deleting Dir: '+ path.join(CLIENT_DIR, message.path))
                        rimraf(path.join(CLIENT_DIR, message.path), (err) => {
                            console.log('Cannot delete folder: ' + err)
                        })
                    }
                    else if (message.type == 'file') {
                        console.log('Deleting File: '+ path.join(CLIENT_DIR, message.path))
                        fs.unlink(path.join(CLIENT_DIR, message.path), (err) => {
                            console.log('Cannot delete file: ' + err)
                        })
                    }
                    break;
                case 'update':
                    if (message.type == 'file') {
                        console.log('Updating File: '+ path.join(CLIENT_DIR, message.path))
                        request.get("http://127.0.0.1:8000" + message.path)
                            .pipe(fs.createWriteStream(path.join(CLIENT_DIR, message.path)))
                    }
                    break;
            }
        }()
    })

    socket.on('error', function(err) {
        console.log(err)
    })

    socket.on('end', () => {
        console.log("End connection")
    })
})