export default {
    configuration: "~/.webdav-runner/config.json",
    storage: "~/.webdav-runner",
    webdav: {
        port: 1900,
        ssl_key: "~/.webdav-runner/ssl.key",
        ssl_cert: "~/.webdav-runner/ssl.cert",
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
        name: null,
    },
    execute: {
        secret: "my-super-secret",
    },
    proxy: {
        domain: "localtest.me",
        prefix: "webdav-",
        secure: false,
    },
    startup: {
        log: "~/.webdav-runner/webdav-runner.log",
        name: "webdav-runner",
    },
}
