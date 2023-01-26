import {
    write_file,
    expand_path,
    ensure_dir,
    local_path,
} from "../webdav-runner/utils.js"
import fs from "fs"
import path from "path"
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

export const find_existing_certs = config => {
    const certs = {}
    for (const key of ["key", "cert"]) {
        const p = expand_path(config("certificates", key))
        certs[key] = fs.existsSync(p)
            ? p
            : local_path(`../certs/self-signed.${key}.pem`)
    }
    return certs
}

export const renew_certs = async config => {
    const key = expand_path(config("certificates", "key"))
    const cert = expand_path(config("certificates", "cert"))

    const { key: key_string, cert: cert_string } = await make_cert(config)

    ensure_dir(path.dirname(key))
    ensure_dir(path.dirname(cert))

    write_file(key, key_string)
    write_file(cert, cert_string)

    return { key, cert }
}
