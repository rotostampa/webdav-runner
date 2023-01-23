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
  folders: {
    outfolders: {
      path: "~/Storage",
      type: "readwrite",
      tags: ["session"]
    },
    commands: {
      type: "commands",
      tags: ["commands"],
      cleanup: true
    },
    bonjour: {
      type: "bonjour",
      tags: ["bonjour"],
      cleanup: true
    },
  },
}
