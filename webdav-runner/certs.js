import { write_file, expand_path } from "../webdav-runner/utils.js"
import fs from "fs"
import pem from "pem"

const make_cert = days =>
    new Promise((resolve, reject) =>
        pem.createCertificate(
            { days: days || 50000, selfSigned: true },
            (err, keys) => {
                if (err) {
                    reject(err)
                }
                resolve({ key: keys.serviceKey, cert: keys.certificate })
            }
        )
    )

export const ensure_certs = async (config, renew) => {
    const cert = {
        key: expand_path(config("webdav", "ssl_key")),
        cert: expand_path(config("webdav", "ssl_cert")),
    }

    console.info("creating certs", cert)

    if (!fs.existsSync(cert.key) || !fs.existsSync(cert.cert) || renew) {
        const newcert = await make_cert()

        write_file(cert.key, newcert.key)
        write_file(cert.cert, newcert.cert)
    }

    return cert
}
