export default {
  storage: "~/.webdav-runner",
  webdav: {
    port: 1900,
    ssl_key: "../certs/self-signed.key.pem",
    ssl_cert: "../certs/self-signed.cert.pem",
    users: {
      admin: "admin",
      user: "user",
    },
    folders: [
      {
        path: "/",
        mount: "~/Storage",
        type: "filesystem",
        tags: ["session"],
        permissions: {
          admin: "write",
          user: "read",
        },
        cleanup: false,
      },
    ],
  },
  bonjour: {
    port: 1923,
    type: "webdav-runner",
    name: null
  },
  execute: {
    secret: "my-super-secret",
  },
  proxy: {
    domain: 'localtest.me',
    prefix: 'webdav-runner-',
    secure: false
  }
}
