import http from "http"
import https from "https"

import make_app from "../webdav-runner/app.js"
import { find_existing_certs } from "../webdav-runner/certs.js"
import pkg from "../webdav-runner/pkg.js"
import { read_file } from "../webdav-runner/utils.js"

export default config => {
    const certs = find_existing_certs(config)
    const protocol = config.http.secure ? "https" : "http"
    const app = make_app(config)

    const settings = {
        https: config.http.secure
            ? {
                  key: read_file(certs.key),
                  cert: read_file(certs.cert),
              }
            : null,
        port: config.http.port,
        host: config.http.host,
    }

    const s = settings.https
        ? https.createServer(settings.https, app)
        : http.createServer(app)

    s.listen(settings, () => {
        console.info(`🥷 server version ${pkg.version} listening on:`)
        console.info(`   ${protocol}://${settings.host}:${settings.port}/`)
    })
}
