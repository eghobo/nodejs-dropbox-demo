let fs = require('fs')
let path = require('path')
let express = require('express')
let morgan = require('morgan')
let nodeify = require('bluebird-nodeify')
let mime = require('mime-types')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let archiver = require('archiver')
let argv = require('yargs').argv
let chokidar = require('chokidar')
let net = require('net')
let JsonSocket = require('json-socket');

require('songbird')
require('longjohn');

const NODE_ENV = process.env.NODE_ENV || 'development'
const PORT = process.env.PORT || 8000
const ROOT_DIR = path.resolve(argv.dir || process.cwd())
const TCP_PORT = 8002

let app = express()

if (NODE_ENV == 'development') {
    app.use(morgan('dev'))
}

app.listen(PORT, () => console.log(`Listening @ http://127.0.0.1:${PORT}. Root dir: ${ROOT_DIR}`))

let clients = []

var port = 8001
var server = net.createServer()
server.listen(port)
server.on('connection', (socket) => {
    console.log("Connection: " + socket.remoteAddress + ":" + socket.remotePort)
    socket = new JsonSocket(socket)
    clients.push(socket)

    socket.on('message', (message) => {
        console.log('Message: ' + message)
    })

    socket.on('end', () => {
        console.log("End connection")
        clients.splice(clients.indexOf(socket), 1)
    })
})

async function sendMessage(message) {
    clients.forEach((client) => {
        client.sendMessage(message)
    })
}

chokidar.watch(ROOT_DIR, {ignored: /[\/\\]\./, ignoreInitial: true})
        .on('add', (path) => { sendMessage({"action": "create", "path": path.replace(ROOT_DIR, ""),
                                            "type": "file", "updated": (new Date).getTime()}) })
        .on('change', (path) => { sendMessage({"action": "update", "path": path.replace(ROOT_DIR, ""),
                                               "type": "file", "updated": (new Date).getTime()}) })
        .on('unlink', (path) => { sendMessage({"action": "delete", "path": path.replace(ROOT_DIR, ""),
                                               "type": "file", "updated": (new Date).getTime()}) })
        .on('addDir', (path) => { sendMessage({"action": "create", "path": path.replace(ROOT_DIR, ""),
                                               "type": "dir", "updated": (new Date).getTime()}) })
        .on('unlinkDir', (path) => { sendMessage({"action": "delete", "path": path.replace(ROOT_DIR, ""),
                                                  "type": "dir", "updated": (new Date).getTime()}) })


app.get('*', setFileMeta, sendHeaders, (req, res) => {
    if (!req.stat) {
        return res.send(400, 'Invalid path')
    }

    if (res.body) {
        if (req.accepts(['*/*', 'application/json'])) {
            res.setHeader("Content-Length", res.body.length)
            res.json(res.body)
            return
        }

        if (req.accepts('application/x-gtar')) {
            let archive = archiver('tar')
            archive.pipe(res);
            archive.bulk([
                { expand: true, cwd: req.filePath, src: ['**']}
            ])
            archive.finalize()

            archive.on('close', function() {
                res.setHeader("Content-Length", archive.pointer())
            });

            res.setHeader("Content-Type", 'application/x-gtar')

            return
        }
    }

    fs.createReadStream(req.filePath).pipe(res)
})

app.head('*', setFileMeta, sendHeaders, (req, res) => res.end())

app.delete('*', setFileMeta, (req, res, next) => {
    async () => {
        if (!req.stat) {
            return res.send(400, 'Invalid path')
        }
        if (req.stat.isDirectory()) {
            await rimraf.promise(req.filePath)
            sendMessage({"action": "delete", "path": req.filePath.replace(ROOT_DIR, ""),
                         "type": "dir", "updated": (new Date).getTime()})

        }
        else {
            await fs.promise.unlink(req.filePath)
            sendMessage({"action": "delete", "path": req.filePath.replace(ROOT_DIR, ""),
                         "type": "file", "updated": (new Date).getTime()})
        }
        res.end()
    }().catch(next)
})

app.put('*', setFileMeta, setDirMeta, (req, res, next) => {
    async () => {
        if (!req.stat) {
            return res.send(405, 'File does not exists')
        }

        await mkdirp.promise(req.dirPath)

        if (!req.isDir) {
            req.pipe(fs.createWriteStream(req.filePath))
            sendMessage({"action": "update", "path": req.filePath.replace(ROOT_DIR, ""),
                        "type": "file", "updated": (new Date).getTime()})
        }
        res.end()
    }().catch(next)
})

app.post('*', setFileMeta, setDirMeta, (req, res, next) => {
    async () => {
        if (req.stat) {
            return res.send(405, 'File exists')
        }
        if (req.isDir) {
            return res.send(405, 'Path is a directory')
        }

        if (req.stat) {
            await fs.promise.truncate(req.filePath, 0)
        }
        req.pipe(fs.createWriteStream(req.filePath))
        sendMessage({"action": "update", "path": req.filePath.replace(ROOT_DIR, ""),
                     "type": "file", "updated": (new Date).getTime()})
        res.end()
    }().catch(next)
})

function setDirMeta(req, res, next) {
    let endsWithSlash = req.filePath.charAt(req.filePath.length - 1) === path.sep
    let hasExt = path.extname(req.filePath) !== ''
    req.isDir = endsWithSlash || !hasExt
    req.dirPath = req.isDir ? req.filePath : path.dirname(req.filePath)

    next()
}

function setFileMeta(req, res, next) {
    req.filePath = path.resolve(path.join(ROOT_DIR, req.url))
    if (req.filePath.indexOf(ROOT_DIR) != 0) {
        res.send(400, 'Invalid path')
        return
    }
    fs.promise.stat(req.filePath)
              .then(stat => req.stat = stat, () => req.stat = null)
              .nodeify(next)
}

function sendHeaders(req, res, next) {
    nodeify(async () => {
        if (!req.stat) {
            return
        }

        if (req.stat.isDirectory()) {
            let files = await fs.promise.readdir(req.filePath)
            res.body = JSON.stringify(files)
            res.setHeader("Content-Type", 'application/json')
            return
        }

        res.setHeader("Content-Length", req.stat.size)
        res.setHeader("Content-Type", mime.contentType(path.extname(req.filePath)))
    }(), next)
}
