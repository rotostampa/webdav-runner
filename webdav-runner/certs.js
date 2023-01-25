import { write_file, expand_path } from "../webdav-runner/utils.js"
import fs from "fs"
import pem from "pem"

const make_alt_names = config => {
    const domains = {}

    for (let d of [
        "localhost",
        "localtest.me",
        "*.localtest.me",
        `${config("proxy", "domain")}`,
        `*.${config("proxy", "domain")}`,
    ]) {
        domains[d] = d
    }

    console.info("generating certificate for:", ...Object.keys(domains))

    return Object.keys(domains)
}

const make_cert = config =>
    new Promise((resolve, reject) =>
        pem.createCertificate(
            {
                days: 50000,
                selfSigned: true,
                altNames: make_alt_names(config),
            },
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
        key: expand_path(config("certificates", "key")),
        cert: expand_path(config("certificates", "cert")),
    }

    console.info("creating certs", cert)

    if (!fs.existsSync(cert.key) || !fs.existsSync(cert.cert) || renew) {
        const newcert = await make_cert(config)

        write_file(cert.key, newcert.key)
        write_file(cert.cert, newcert.cert)
    }

    return cert
}
