// One bot check for the whole server. See lib/captcha.js. Mode comes from CAPTCHA_MODE (off | log | enforce, default log).
module.exports = require('./captcha').createCaptcha();
