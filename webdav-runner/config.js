export default {
  storage: '~/.webdav-server',
  webdav: {
    port: 1922,
    username: "admin",
    password: "admin",
    ssl_key: "../certs/self-signed.key.pem",
    ssl_cert: "../certs/self-signed.cert.pem",
  },
  bonjour: {
    port: 1923,
    type: "webdav-server",
  },
  commands: {
    secret: 'my-super-secret'
  },
  folders: [
    {
      name: '/outfolders',
      path: "~/Storage",
      type: "readwrite",
      tags: ["session"],
      cleanup: false
    }
  ]
}
