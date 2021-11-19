// eslint-disable-next-line
const dotenv = require('dotenv').config();

// eslint-disable-next-line no-undef
module.exports = {
    envs: dotenv.parsed,
    configureWebpack: {
        module: {
            unknownContextCritical: false
        }
    },
}
