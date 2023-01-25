import {
    ensure_dir,
    expand_path,
    read_file,
    startswith,
    endswith,
    local_path,
} from "../webdav-runner/utils.js"
import Bonjour from "bonjour"
import { execFile as exec_file } from "child_process"
import express from "express"
import fs from "fs"
import httpproxy from "http-proxy"
import https from "https"
import jwt from "jsonwebtoken"
import machine_id from "node-machine-id"
import { v2 as webdav } from "webdav-server"

const PERMISSIONS = {
    read: [
        "canRead",
        "canSource",
        "canGetMimeType",
        "canGetSize",
        "canListLocks",
        "canGetAvailableLocks",
        "canGetLock",
        "canGetChildren",
        "canGetProperty",
        "canGetProperties",
        "canGetCreationDate",
        "canGetLastModifiedDate",
        "canGetWebName",
        "canGetType",
    ],
    write: ["all"],
}

const SERVICES = {
    filesystem: (
        { path, mount, permissions },
        { server, users, privilege_manager }
    ) => {
        server.setFileSystem(path, new webdav.PhysicalFileSystem(mount))
        for (const [username, perm] of Object.entries(permissions || {})) {
            privilege_manager.setRights(
                users[username],
                path,
                PERMISSIONS[perm]
            )
        }
    },
}

function bonjour_advertise(config) {
    const settings = {
        name:
            config("bonjour", "name") ||
            machine_id.machineIdSync({ original: true }),
        type: config("bonjour", "type"),
        port: config("bonjour", "port"),
        txt: {
            platform: process.platform,
            port: config("webdav", "port"),
        },
    }

    Bonjour().publish(settings)

    return settings
}

function get_certificate_path(config, key) {
    const p = expand_path(config("certificates", key))
    return fs.existsSync(p)
        ? p
        : local_path(`../certs/self-signed.${key}.pem`)
}

export default config => {
    const bonjour = bonjour_advertise(config)

    console.info("started bonjour using", bonjour)

    const user_manager = new webdav.SimpleUserManager()

    const users = {}

    for (const [username, password] of Object.entries(
        config("webdav", "users")
    )) {
        users[username] = user_manager.addUser(username, password, false)
    }

    const privilege_manager = new webdav.SimplePathPrivilegeManager()

    const temp = expand_path([
        config("storage"),
        `${config("webdav", "port")}`,
        `${config("bonjour", "port")}`,
    ])

    const ssl_key = get_certificate_path(config, "key")
    const ssl_cert = get_certificate_path(config, "cert")

    const settings = {
        httpAuthentication: new webdav.HTTPBasicAuthentication(
            user_manager,
            "realm"
        ),
        privilegeManager: privilege_manager,
        port: config("webdav", "port"),
        hostname: config("webdav", "hostname"),
        withCredentials: true,
        https: {
            key: read_file(ssl_key),
            cert: read_file(ssl_cert),
        },
        maxRequestDepth: Infinity,
        //headers: {
        //  "Access-Control-Allow-Origin": "*",
        //  "Access-Control-Allow-Methods":
        //    "HEAD, GET, PUT, PROPFIND, DELETE, OPTIONS, MKCOL, MOVE, COPY",
        //  "Access-Control-Allow-Headers":
        //    "Accept, Authorization, Content-Type, Content-Length, Depth",
        //},
    }

    const server = new webdav.WebDAVServer(settings)

    const folders = config("webdav", "folders")
    const context = {
        server,
        users,
        privilege_manager,
        config,
    }

    for (const settings of folders) {
        if (!settings.type) {
            settings.type = "filesystem"
        }
        if (!settings.tags) {
            settings.tags = [settings.type]
        }

        settings.mount = ensure_dir(
            settings.mount
                ? settings.mount
                : [temp, settings.path.replace("/", "-")],
            settings.cleanup
        )

        SERVICES[settings.type](settings, context)

        delete settings.cleanup
    }

    const servers = {}

    Bonjour().find({ type: config("bonjour", "type") }, e => {
        delete e.rawTxt
        servers[e.name] = {
            proxy: `https://${proxyprefix}${e.name}${proxydomain}:${e.txt.port}/`,
            address: e.referer.address,
            ...e.txt,
        }
    })

    const app = express()

    let proxydomain = config("proxy", "domain")
    if (!startswith(proxydomain, ".")) {
        proxydomain = "." + proxydomain
    }
    const proxyprefix = config("proxy", "prefix")
    const proxy = httpproxy.createProxyServer({
        secure: config("proxy", "secure") ? true : false,
        ignorePath: true,
    }) // See (†)

    app.use((req, res, next) => {
        res.set("Access-Control-Allow-Origin", "*")
        res.set(
            "Access-Control-Allow-Methods",
            "HEAD, GET, PUT, PROPFIND, DELETE, OPTIONS, MKCOL, MOVE, COPY"
        )
        res.set(
            "Access-Control-Allow-Headers",
            "Accept, Authorization, Content-Type, Content-Length, Depth"
        )

        // proxy logic
        if (
            endswith(req.socket.servername, proxydomain) &&
            startswith(req.socket.servername, proxyprefix)
        ) {
            const proxyname = req.socket.servername.slice(
                proxyprefix.length,
                -proxydomain.length
            )

            const target = servers[proxyname]

            if (target && proxyname == bonjour.name) {
                console.info("proxy to self, skipping")
            } else if (target) {
                const url = `https://${target.address}:${target.port}${req.path}`
                console.info("forwarding to", url)
                proxy.web(req, res, { target: url }, e => {
                    res.status(502)
                    res.send({
                        success: false,
                        status: 502,
                        error: `${e}`,
                        url: url,
                    })
                })
                return
            } else {
                res.status(404)
                res.send({ success: false, status: 404, servers: servers })
                return
            }
        }

        next()

        console.info(
            "🤖",
            req.method,
            `https://${req.socket.servername}:${settings.port}${req.path}`
        )
    })

    app.get("/manifest", (req, res) => {
        res.send({
            success: true,
            status: 200,
            platform: process.platform,
            name: bonjour.name,
            folders,
            servers,
        })
    })

    const jwt_secret = config("execute", "secret")

    if (jwt_secret) {
        //console.info("sample jwt request")
        //console.info(`curl https://localhost:${settings.port}/execute/${jwt.sign({ command: "/usr/bin/say", arguments: ["hello"] }, jwt_secret)}/ --insecure`)

        app.get("/execute/:jwt", (req, res) => {
            let result
            try {
                result = jwt.verify(req.params.jwt, jwt_secret)
            } catch (e) {
                console.info("invalid jwt", e)
            }

            if (!result) {
                res.status(401)
                res.send({ success: false, status: 401 })
            } else {
                console.info("🚀 running", result.command, ...result.arguments)
                exec_file(
                    result.command || "/bin/hostname",
                    result.arguments || [],
                    (error, stdout, stderr) => {
                        res.status(error ? 422 : 200)
                        res.send({
                            success: error ? false : true,
                            status: error ? 422 : 200,
                            error,
                            stdout,
                            stderr,
                        })

                        console.info(
                            "🚀 running complete:",
                            result.command,
                            ...result.arguments
                        )

                        if (error) console.error(error)
                        if (stderr) console.warn(stderr)
                        if (stdout) console.log(stdout)
                    }
                )
            }
        })
    }

    app.use(webdav.extensions.express("/", server))

    https.createServer(settings.https, app).listen(settings.port, () => {
        console.info("🥷 server listening on:")
        console.info(`   https://localhost:${settings.port}/`)
        console.info(
            `   https://${proxyprefix}${bonjour.name}${proxydomain}:${settings.port}/`
        )

        console.info()
        console.info("   ssl_key:", ssl_key)
        console.info("   ssl_cert:", ssl_cert)
    })
}
