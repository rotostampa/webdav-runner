import pem from "pem"
import { get_config } from "../webdav-runner/utils.js"
import fs from 'fs'

export const ensure_certs = config => {

  const a = {
    key: get_config(config, "webdav", "ssl_key"),
    cert: get_config(config, "webdav", "ssl_cert")
  }


  return a


}