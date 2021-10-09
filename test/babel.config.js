module.exports = {
    presets: [
        [
            "@babel/preset-env",
            {
                targets: {
                    "chrome": "39"
                }
            }
        ],
        "@babel/preset-typescript",
        "@babel/preset-react"
    ],
}