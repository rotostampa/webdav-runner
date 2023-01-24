import pem from "pem"
import { get_config, write_file } from "../webdav-runner/utils.js"
import fs from 'fs'



const make_cert = days => new Promise((resolve, reject) => pem.createCertificate({ days: days || 50000, selfSigned: true }, (err, keys) => {
    if (err) {
      reject(err)
    }
    resolve({ key: keys.serviceKey, cert: keys.certificate })
  }))

export const ensure_certs = async config => {

  const cert = {
    key: get_config(config, "webdav", "ssl_key"),
    cert: get_config(config, "webdav", "ssl_cert")
  }

  if (! fs.existsSync(cert.key) || ! fs.existsSync(cert.cert)) {

    const newcert = await make_cert()

    write_file(cert.key, newcert.key)
    write_file(cert.cert, newcert.cert)

  }


  return cert

}