export default {
  storage: '~/.webdav-server',
  webdav: {
    port: 1900,
    username: "admin",
    password: "admin",
    ssl_key: "../certs/self-signed.key.pem",
    ssl_cert: "../certs/self-signed.cert.pem",
  },
  bonjour: {
    port: 1923,
    type: "webdav-server",
  },
  execute: {
    secret: 'my-super-secret'
  },
  folders: [
    {
      path: '/',
      mount: "~/Storage",
      type: "readwrite",
      tags: ["session"],
      cleanup: false
    }
  ]
}
